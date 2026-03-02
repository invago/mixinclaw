import crypto from "crypto";
import { x25519, ed25519 } from "@noble/curves/ed25519.js";

function uuidToBuffer(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

function aes256CbcDecrypt(key: Buffer, iv: Buffer, ciphertext: Buffer): Buffer {
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  const decrypted = decipher.update(ciphertext);
  const final = Buffer.concat([decrypted, decipher.final()]);
  const padLen = final[final.length - 1];
  if (padLen > 0 && padLen <= 16) {
    return final.slice(0, final.length - padLen);
  }
  return final;
}

export function decryptMixinMessage(
  encryptedBase64: string,
  sessionPrivateKeyHex: string,
  mySessionIdStr: string
): string | null {
  try {
    let b64 = encryptedBase64.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    const encryptedData = Buffer.from(b64, "base64");

    const version = encryptedData[0];
    if (version !== 1) {
      return null;
    }

    const receiversCount = encryptedData.readUInt16LE(1);
    const senderCurve25519Pub = encryptedData.slice(3, 35);

    const seedBytes = Buffer.from(sessionPrivateKeyHex, "hex");
    const myCurve25519Priv = ed25519.utils.toMontgomerySecret(seedBytes);
    const sharedSecret = Buffer.from(x25519.getSharedSecret(myCurve25519Priv, senderCurve25519Pub));

    let cursor = 35;
    const mySessionIdBuffer = mySessionIdStr ? uuidToBuffer(mySessionIdStr) : null;
    let ivForKey: Buffer | null = null;
    let encryptedMessageKey: Buffer | null = null;
    let found = false;

    for (let i = 0; i < receiversCount; i++) {
      if (cursor + 64 > encryptedData.length) break;

      const blockSessionId = encryptedData.slice(cursor, cursor + 16);

      if (!mySessionIdBuffer || blockSessionId.equals(mySessionIdBuffer) || i === 0) {
        ivForKey = encryptedData.slice(cursor + 16, cursor + 32);
        encryptedMessageKey = encryptedData.slice(cursor + 32, cursor + 64);
        found = true;
        if (mySessionIdBuffer && blockSessionId.equals(mySessionIdBuffer)) break;
      }
      cursor += 64;
    }

    if (!found || !ivForKey || !encryptedMessageKey) {
      return null;
    }

    const paddedMessageKey = aes256CbcDecrypt(sharedSecret, ivForKey, encryptedMessageKey);
    const messageKey16 = paddedMessageKey.slice(0, 16);

    cursor = 35 + receiversCount * 64;

    const gcmNonce = encryptedData.slice(cursor, cursor + 12);
    cursor += 12;

    const gcmPayload = encryptedData.slice(cursor);

    if (gcmPayload.length < 16) {
      return null;
    }

    const gcmCiphertext = gcmPayload.slice(0, gcmPayload.length - 16);
    const gcmAuthTag = gcmPayload.slice(gcmPayload.length - 16);

    const decipher = crypto.createDecipheriv("aes-128-gcm", messageKey16, gcmNonce);
    decipher.setAuthTag(gcmAuthTag);

    let decryptedText = decipher.update(gcmCiphertext, undefined, "utf8");
    decryptedText += decipher.final("utf8");

    return decryptedText;
  } catch {
    return null;
  }
}