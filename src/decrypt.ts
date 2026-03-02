import crypto from 'crypto';

/**
 * 将 Mixin 的 Ed25519 seed 转换为 Curve25519 私钥，并与对端公钥协商出共享密钥
 * @param seedHex 64 字符的 Hex 字符串，对应 session_private_key
 * @param peerPublicKey 32 字节的对端 Curve25519 公钥
 */
export function x25519KeyAgreement(seedHex: string, peerPublicKey: Buffer): Buffer {
  // 1. 将 64 字符的 Hex 转换为 32 字节的 seed
  const seedBytes = Buffer.from(seedHex, 'hex');
  if (seedBytes.length !== 32) {
    throw new Error('Invalid Ed25519 seed length, expected 32 bytes.');
  }

  // 2. SHA-512 散列
  const hash = crypto.createHash('sha512').update(seedBytes).digest();
  
  // 3. 提取前 32 字节并进行 Curve25519 位截断 (Clamping)
  const privateKeyX25519 = Buffer.from(hash.slice(0, 32));
  privateKeyX25519[0] &= 248;
  privateKeyX25519[31] &= 127;
  privateKeyX25519[31] |= 64;

  const ecdh = crypto.createECDH('x25519');
  ecdh.setPrivateKey(privateKeyX25519);
  
  return ecdh.computeSecret(peerPublicKey);
}

/**
 * 解密 Mixin ENCRYPTED_TEXT 消息 (对应 Go SDK DecryptMessageData)
 * @param data Base64 编码的加密数据
 * @param sessionId 机器人的 session_id
 * @param privateKey 机器人的 ed25519 私钥（hex 格式，实为 seed）
 * @returns 解密后的明文，失败返回 null
 */
export function decryptMessageData(
  data: string,
  sessionId: string,
  privateKey: string
): string | null {
  try {
    // 1. Base64 解码，处理可能的 URL-safe Base64
    let base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const encryptedBytes = Buffer.from(base64, 'base64');

    // 验证最小长度: version(1) + sessionCount(2) + senderPubKey(32) + nonce(12)
    if (encryptedBytes.length < 1 + 2 + 32 + 12) {
      console.error('[mixin decrypt] data too short:', encryptedBytes.length);
      return null;
    }

    // 解析消息结构
    const version = encryptedBytes[0];
    if (version !== 1) {
      console.error('[mixin decrypt] unsupported version:', version);
      return null;
    }

    const sessionCount = encryptedBytes.readUInt16LE(1);
    let offset = 3;

    // 2. 提取发送者公钥 (已经是 Curve25519)
    const senderPublicKey = encryptedBytes.slice(offset, offset + 32);
    offset += 32;

    // 查找匹配的 session
    const sessionIdBuffer = Buffer.from(sessionId.replace(/-/g, ''), 'hex');

    let sessionData: Buffer | null = null;
    for (let i = 0; i < sessionCount; i++) {
      const sessionIdInMsg = encryptedBytes.slice(offset, offset + 16);

      if (sessionIdInMsg.equals(sessionIdBuffer)) {
        sessionData = encryptedBytes.slice(offset + 16, offset + 64);
        break; // 暂不中断读取，只取我们自己的 session 块
      }
      offset += 64;
    }

    if (!sessionData) {
      console.error('[mixin decrypt] session not found');
      return null;
    }

    // 3. 计算 Shared Secret
    const sharedSecret = x25519KeyAgreement(privateKey, senderPublicKey);
    
    // 4. 解密 Message Key (AES-256-CBC)
    // sessionData 的前 16 字节为 IV，后 32 字节为加密后的 key
    const sessionIv = sessionData.slice(0, 16);
    const encryptedKey = sessionData.slice(16, 48);
    
    const decipherKey = crypto.createDecipheriv('aes-256-cbc', sharedSecret, sessionIv);
    // Mixin SDK 这里加了 padding 处理。如果后续失败，尝试 decipherKey.setAutoPadding(false);
    let rawMessageKey = Buffer.concat([decipherKey.update(encryptedKey), decipherKey.final()]);
    
    // 取前 16 字节！
    const messageKey = rawMessageKey.slice(0, 16);

    // 5. 获取 Nonce 和 密文
    const prefixSize = 3 + 32 + sessionCount * 64;
    const nonce = encryptedBytes.slice(prefixSize, prefixSize + 12); // 注意这里是 12 字节!!!
    const encryptedText = encryptedBytes.slice(prefixSize + 12);

    // 6. 解密消息体 (AES-128-GCM)
    // 对于 GCM，还需要分离出 authentication tag (后 16 字节)
    const tag = encryptedText.slice(-16);
    const ciphertext = encryptedText.slice(0, -16);

    const decipherGcm = crypto.createDecipheriv('aes-128-gcm', messageKey, nonce);
    decipherGcm.setAuthTag(tag);
    
    let decryptedText = decipherGcm.update(ciphertext);
    decryptedText = Buffer.concat([decryptedText, decipherGcm.final()]);

    return decryptedText.toString('utf8');

  } catch (error) {
    console.error('[mixin decrypt] error:', error);
    return null;
  }
}
