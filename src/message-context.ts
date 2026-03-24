type MixinMessageDirection = "inbound" | "outbound";

export type MixinMessageContext = {
  accountId: string;
  conversationId: string;
  messageId: string;
  senderId?: string;
  senderName?: string;
  body: string;
  timestamp: string;
  direction: MixinMessageDirection;
  quoteMessageId?: string;
};

export type ResolvedMixinReplyContext = {
  id: string;
  body?: string;
  sender?: string;
  senderId?: string;
  timestamp?: string;
  direction?: MixinMessageDirection;
  found: boolean;
};

const MAX_MESSAGE_CONTEXTS = 4000;
const recentMessages = new Map<string, MixinMessageContext>();

function normalizeKeyPart(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function buildMessageContextKey(params: {
  accountId: string;
  conversationId: string;
  messageId: string;
}): string {
  return [
    normalizeKeyPart(params.accountId),
    normalizeKeyPart(params.conversationId),
    normalizeKeyPart(params.messageId),
  ].join(":");
}

function pruneRecentMessages(): void {
  while (recentMessages.size > MAX_MESSAGE_CONTEXTS) {
    const first = recentMessages.keys().next().value;
    if (!first) {
      break;
    }
    recentMessages.delete(first);
  }
}

export function rememberMixinMessage(context: MixinMessageContext): void {
  const accountId = context.accountId.trim();
  const conversationId = context.conversationId.trim();
  const messageId = context.messageId.trim();
  if (!accountId || !conversationId || !messageId) {
    return;
  }

  recentMessages.set(
    buildMessageContextKey({ accountId, conversationId, messageId }),
    {
      accountId,
      conversationId,
      messageId,
      senderId: context.senderId?.trim() || undefined,
      senderName: context.senderName?.trim() || undefined,
      body: context.body ?? "",
      timestamp: context.timestamp,
      direction: context.direction,
      quoteMessageId: context.quoteMessageId?.trim() || undefined,
    },
  );

  pruneRecentMessages();
}

export function resolveMixinReplyContext(params: {
  accountId: string;
  conversationId: string;
  quoteMessageId?: string | null;
}): ResolvedMixinReplyContext | null {
  const quoteMessageId = params.quoteMessageId?.trim();
  if (!quoteMessageId) {
    return null;
  }

  const message = recentMessages.get(
    buildMessageContextKey({
      accountId: params.accountId,
      conversationId: params.conversationId,
      messageId: quoteMessageId,
    }),
  );

  if (!message) {
    return {
      id: quoteMessageId,
      found: false,
    };
  }

  return {
    id: message.messageId,
    body: message.body || undefined,
    sender: message.senderName || message.senderId,
    senderId: message.senderId,
    timestamp: message.timestamp,
    direction: message.direction,
    found: true,
  };
}
