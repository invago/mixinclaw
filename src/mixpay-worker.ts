import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { getMixpayConfig } from "./config.js";
import type { MixinMixpayConfig } from "./config-schema.js";
import { createMixpayPayment, getMixpayPaymentResult, type MixpayPaymentResult } from "./mixpay-service.js";
import {
  createMixpayOrder,
  findMixpayOrder,
  getMixpayStoreSnapshot,
  listPendingMixpayOrders,
  listRecentMixpayOrders,
  type MixpayOrderRecord,
  type MixpayOrderStatus,
  updateMixpayOrder,
} from "./mixpay-store.js";
import { sendTextMessage } from "./send-service.js";
import { sleep, type SendLog } from "./shared.js";

export type MixinCollectRequest = {
  amount: string;
  assetId?: string;
  settlementAssetId?: string;
  memo?: string;
  orderId?: string;
  expireMinutes?: number;
};

const state: {
  started: boolean;
  cfg: OpenClawConfig | null;
  log: SendLog | null;
} = {
  started: false,
  cfg: null,
  log: null,
};

function getPendingPollDelayMs(cfg: OpenClawConfig): number {
  const configured = Object.values((cfg.channels?.mixin as { accounts?: Record<string, { mixpay?: MixinMixpayConfig }> } | undefined)?.accounts ?? {})
    .map((account) => account?.mixpay?.pollIntervalSec)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  const topLevel = (cfg.channels?.mixin as { mixpay?: MixinMixpayConfig } | undefined)?.mixpay?.pollIntervalSec;
  if (typeof topLevel === "number" && Number.isFinite(topLevel) && topLevel > 0) {
    configured.push(topLevel);
  }
  return Math.max(5_000, Math.min(...(configured.length > 0 ? configured : [30])) * 1000);
}

function formatStatusLabel(status: MixpayOrderStatus): string {
  switch (status) {
    case "unpaid":
      return "unpaid";
    case "pending":
      return "pending";
    case "paid_less":
      return "paid less";
    case "success":
      return "success";
    case "failed":
      return "failed";
    case "expired":
      return "expired";
    default:
      return "unknown";
  }
}

export function formatMixpayOrderSummary(order: MixpayOrderRecord): string {
  const lines = [
    `MixPay order: ${order.orderId}`,
    `Status: ${formatStatusLabel(order.status)}`,
    `Amount: ${order.quoteAmount} ${order.quoteAssetId}`,
  ];
  if (order.paymentUrl) {
    lines.push(`Pay: ${order.paymentUrl}`);
  }
  if (order.memo) {
    lines.push(`Memo: ${order.memo}`);
  }
  if (order.expireAt) {
    lines.push(`Expires: ${order.expireAt}`);
  }
  if (order.latestError) {
    lines.push(`Latest error: ${order.latestError}`);
  }
  return lines.join("\n");
}

function shouldNotifyStatus(config: MixinMixpayConfig, status: MixpayOrderStatus): boolean {
  if (status === "success" || status === "failed" || status === "expired") {
    return true;
  }
  if (status === "pending") {
    return config.notifyOnPending === true;
  }
  if (status === "paid_less") {
    return config.notifyOnPaidLess !== false;
  }
  return false;
}

function validateMixpayResult(
  order: MixpayOrderRecord,
  payment: MixpayPaymentResult,
  config: MixinMixpayConfig,
): string | null {
  if (config.payeeId?.trim() && payment.payeeId?.trim() && config.payeeId.trim() !== payment.payeeId.trim()) {
    return "MixPay payeeId mismatch";
  }
  if (payment.quoteAssetId?.trim() && payment.quoteAssetId.trim() !== order.quoteAssetId.trim()) {
    return "MixPay quoteAssetId mismatch";
  }
  if (payment.quoteAmount?.trim() && payment.quoteAmount.trim() !== order.quoteAmount.trim()) {
    return "MixPay quoteAmount mismatch";
  }
  return null;
}

async function notifyOrderStatus(
  cfg: OpenClawConfig,
  order: MixpayOrderRecord,
  nextStatus: MixpayOrderStatus,
  log: SendLog,
): Promise<void> {
  const recipientId = order.recipientId || undefined;
  const message = [
    `MixPay order update: ${order.orderId}`,
    `Status: ${formatStatusLabel(nextStatus)}`,
    `Amount: ${order.quoteAmount} ${order.quoteAssetId}`,
  ];
  if (order.paymentUrl) {
    message.push(`Pay: ${order.paymentUrl}`);
  }
  const result = await sendTextMessage(cfg, order.accountId, order.conversationId, recipientId, message.join("\n"), log);
  if (!result.ok) {
    throw new Error(result.error ?? "failed to notify MixPay order status");
  }
}

async function pollPendingOrders(): Promise<void> {
  const cfg = state.cfg;
  const log = state.log;
  if (!cfg || !log) {
    return;
  }

  const pendingOrders = await listPendingMixpayOrders();
  for (const order of pendingOrders) {
    const mixpayConfig = getMixpayConfig(cfg, order.accountId);
    if (!mixpayConfig?.enabled) {
      continue;
    }

    try {
      const payment = await getMixpayPaymentResult({ config: mixpayConfig, orderId: order.orderId, traceId: order.traceId });
      const mismatch = validateMixpayResult(order, payment, mixpayConfig);
      if (mismatch) {
        throw new Error(mismatch);
      }
      const nextStatus = payment.status;
      const updated = await updateMixpayOrder(order.orderId, (current) => ({
        ...current,
        paymentId: current.paymentId ?? payment.raw.id as string | undefined,
        rawStatus: payment.rawStatus,
        status: nextStatus,
        lastPolledAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      if (!updated) {
        continue;
      }

      if (updated.lastNotifyStatus !== nextStatus && shouldNotifyStatus(mixpayConfig, nextStatus)) {
        await notifyOrderStatus(cfg, updated, nextStatus, log);
        await updateMixpayOrder(order.orderId, (current) => ({
          ...current,
          lastNotifyStatus: nextStatus,
          updatedAt: new Date().toISOString(),
        }));
      }
    } catch (err) {
      log.warn(`[mixin] MixPay poll failed: orderId=${order.orderId}, error=${err instanceof Error ? err.message : String(err)}`);
      await updateMixpayOrder(order.orderId, (current) => ({
        ...current,
        latestError: err instanceof Error ? err.message : String(err),
        lastPolledAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
    }
  }
}

export async function startMixpayWorker(cfg: OpenClawConfig, log: SendLog): Promise<void> {
  state.cfg = cfg;
  state.log = log;
  if (state.started) {
    return;
  }
  state.started = true;

  void (async () => {
    while (true) {
      try {
        await pollPendingOrders();
      } catch (err) {
        log.error("[mixin] MixPay worker loop failed", err);
      }
      await sleep(getPendingPollDelayMs(state.cfg ?? cfg));
    }
  })();
}

export async function createMixinCollectOrder(params: {
  cfg: OpenClawConfig;
  accountId: string;
  conversationId: string;
  recipientId?: string;
  creatorId: string;
  request: MixinCollectRequest;
}): Promise<MixpayOrderRecord> {
  const mixpayConfig = getMixpayConfig(params.cfg, params.accountId);
  if (!mixpayConfig?.enabled) {
    throw new Error("MixPay is not enabled for this Mixin account");
  }

  const normalizedCreatorId = params.creatorId.trim().toLowerCase();
  const allowedCreators = (mixpayConfig.allowedCreators ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (allowedCreators.length > 0 && !allowedCreators.includes(normalizedCreatorId)) {
    throw new Error("MixPay collect creation is not allowed for this sender");
  }

  const created = await createMixpayPayment({
    config: mixpayConfig,
    orderId: params.request.orderId,
    quoteAmount: params.request.amount,
    quoteAssetId: params.request.assetId?.trim() || mixpayConfig.defaultQuoteAssetId?.trim() || "",
    settlementAssetId: params.request.settlementAssetId,
    memo: params.request.memo,
    expireMinutes: params.request.expireMinutes,
  });

  const quoteAssetId = params.request.assetId?.trim() || mixpayConfig.defaultQuoteAssetId?.trim();
  if (!quoteAssetId) {
    throw new Error("MixPay quote asset is not configured");
  }

  const record: MixpayOrderRecord = {
    orderId: created.orderId,
    traceId: created.traceId,
    paymentId: created.paymentId,
    code: created.code,
    paymentUrl: created.paymentUrl,
    accountId: params.accountId,
    conversationId: params.conversationId,
    recipientId: params.recipientId,
    creatorId: params.creatorId,
    quoteAssetId,
    quoteAmount: params.request.amount,
    settlementAssetId: params.request.settlementAssetId,
    memo: params.request.memo,
    status: "unpaid",
    createdAt: created.createdAt,
    updatedAt: created.createdAt,
    expireAt: created.expireAt,
  };

  await createMixpayOrder(record);
  return record;
}

export async function getMixpayOrderStatusText(orderId: string): Promise<string> {
  const order = await findMixpayOrder(orderId);
  if (!order) {
    return `MixPay order not found: ${orderId}`;
  }
  return formatMixpayOrderSummary(order);
}

export async function refreshMixpayOrderStatus(params: {
  cfg: OpenClawConfig;
  accountId: string;
  orderId: string;
}): Promise<MixpayOrderRecord | null> {
  const order = await findMixpayOrder(params.orderId);
  if (!order || order.accountId !== params.accountId) {
    return order;
  }

  const mixpayConfig = getMixpayConfig(params.cfg, params.accountId);
  if (!mixpayConfig?.enabled) {
    return order;
  }

  try {
    const payment = await getMixpayPaymentResult({
      config: mixpayConfig,
      orderId: order.orderId,
      traceId: order.traceId,
    });
    const mismatch = validateMixpayResult(order, payment, mixpayConfig);
    if (mismatch) {
      throw new Error(mismatch);
    }
    return await updateMixpayOrder(order.orderId, (current) => ({
      ...current,
      rawStatus: payment.rawStatus,
      status: payment.status,
      lastPolledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      latestError: undefined,
    }));
  } catch (err) {
    return await updateMixpayOrder(order.orderId, (current) => ({
      ...current,
      latestError: err instanceof Error ? err.message : String(err),
      lastPolledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  }
}

export async function getRecentMixpayOrdersText(params: {
  accountId: string;
  conversationId: string;
  limit?: number;
}): Promise<string> {
  const items = await listRecentMixpayOrders({
    accountId: params.accountId,
    conversationId: params.conversationId,
    limit: params.limit ?? 5,
  });

  if (items.length === 0) {
    return "No MixPay orders found for this conversation.";
  }

  return items
    .map((item) => `${item.orderId} | ${formatStatusLabel(item.status)} | ${item.quoteAmount} ${item.quoteAssetId}`)
    .join("\n");
}

export async function getMixpayStatusSnapshot(): Promise<{
  pendingOrders: number;
  storeDir: string;
  storeFile: string;
}> {
  const snapshot = await getMixpayStoreSnapshot();
  return {
    pendingOrders: snapshot.pending,
    storeDir: snapshot.storeDir,
    storeFile: snapshot.storeFile,
  };
}
