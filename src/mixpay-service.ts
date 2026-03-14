import crypto from "node:crypto";
import axios from "axios";
import type { MixinMixpayConfig } from "./config-schema.js";
import type { MixpayOrderStatus } from "./mixpay-store.js";

const DEFAULT_API_BASE_URL = "https://api.mixpay.me/v1";

export type CreateMixpayPaymentInput = {
  config: MixinMixpayConfig;
  orderId?: string;
  quoteAmount: string;
  quoteAssetId: string;
  settlementAssetId?: string;
  memo?: string;
  expireMinutes?: number;
};

export type MixpayCreateResult = {
  orderId: string;
  traceId: string;
  paymentId?: string;
  code?: string;
  paymentUrl?: string;
  createdAt: string;
  expireAt?: string;
  raw: Record<string, unknown>;
};

export type MixpayPaymentResult = {
  orderId: string;
  traceId?: string;
  payeeId?: string;
  quoteAssetId?: string;
  quoteAmount?: string;
  settlementAssetId?: string;
  status: MixpayOrderStatus;
  rawStatus: string;
  settleStatus?: string;
  raw: Record<string, unknown>;
};

function resolveApiBaseUrl(config: MixinMixpayConfig): string {
  return (config.apiBaseUrl?.trim() || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

function generateShortId(): string {
  return crypto.randomBytes(5).toString("hex");
}

export function createMixpayOrderId(): string {
  return `mixpay_${Date.now()}_${generateShortId()}`;
}

export function createMixpayTraceId(): string {
  return crypto.randomUUID();
}

function normalizeAmount(value: string): string {
  const normalized = value.trim();
  if (!normalized || !/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("invalid MixPay quote amount");
  }
  return normalized;
}

function mapMixpayStatus(rawStatus: string, settleStatus?: string, quoteAmount?: string, paidAmount?: string): MixpayOrderStatus {
  const status = rawStatus.trim().toLowerCase();
  if (status === "success" && settleStatus?.trim().toLowerCase() === "success") {
    return "success";
  }
  if (status === "success") {
    return "pending";
  }
  if (status === "pending") {
    return "pending";
  }
  if (status === "unpaid") {
    return "unpaid";
  }
  if (status === "failed" || status === "fail") {
    return "failed";
  }
  if (status === "expired") {
    return "expired";
  }
  if (quoteAmount && paidAmount) {
    const expected = Number.parseFloat(quoteAmount);
    const actual = Number.parseFloat(paidAmount);
    if (Number.isFinite(expected) && Number.isFinite(actual) && actual < expected) {
      return "paid_less";
    }
  }
  return "unknown";
}

function extractString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function extractDataRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const nested = record.data;
    if (nested && typeof nested === "object") {
      return nested as Record<string, unknown>;
    }
    return record;
  }
  return {};
}

export async function createMixpayPayment(input: CreateMixpayPaymentInput): Promise<MixpayCreateResult> {
  if (!input.config.enabled) {
    throw new Error("MixPay is disabled");
  }
  if (!input.config.payeeId?.trim()) {
    throw new Error("MixPay payeeId is not configured");
  }

  const orderId = input.orderId?.trim() || createMixpayOrderId();
  const traceId = createMixpayTraceId();
  const quoteAmount = normalizeAmount(input.quoteAmount);
  const quoteAssetId = input.quoteAssetId.trim();
  if (!quoteAssetId) {
    throw new Error("MixPay quoteAssetId is not configured");
  }
  const settlementAssetId = input.settlementAssetId?.trim() || input.config.defaultSettlementAssetId?.trim();
  const expireMinutes = Math.max(1, Math.floor(input.expireMinutes ?? input.config.expireMinutes ?? 15));
  const expiredTimestamp = Date.now() + expireMinutes * 60 * 1000;

  const body = new URLSearchParams();
  body.set("payeeId", input.config.payeeId.trim());
  body.set("orderId", orderId);
  body.set("traceId", traceId);
  body.set("quoteAssetId", quoteAssetId);
  body.set("quoteAmount", quoteAmount);
  body.set("expiredTimestamp", String(expiredTimestamp));
  if (settlementAssetId) {
    body.set("settlementAssetId", settlementAssetId);
  }
  if (input.memo?.trim()) {
    body.set("memo", input.memo.trim());
  }

  const response = await axios.post(`${resolveApiBaseUrl(input.config)}/one_time_payment`, body, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    timeout: 20_000,
  });

  const data = extractDataRecord(response.data);
  const code = extractString(data, "code");
  const paymentId = extractString(data, "paymentId", "payment_id", "id");
  const paymentUrl = code ? `https://mixpay.me/code/${code}` : extractString(data, "paymentUrl", "payment_url", "url");
  const createdAt = new Date().toISOString();

  return {
    orderId,
    traceId,
    paymentId,
    code,
    paymentUrl,
    createdAt,
    expireAt: new Date(expiredTimestamp).toISOString(),
    raw: data,
  };
}

export async function getMixpayPaymentResult(params: {
  config: MixinMixpayConfig;
  orderId: string;
  traceId?: string;
}): Promise<MixpayPaymentResult> {
  if (!params.config.enabled) {
    throw new Error("MixPay is disabled");
  }

  const response = await axios.get(`${resolveApiBaseUrl(params.config)}/payments_result`, {
    params: {
      orderId: params.orderId,
      traceId: params.traceId,
    },
    timeout: 20_000,
  });

  const data = extractDataRecord(response.data);
  const rawStatus = extractString(data, "status") ?? "unknown";
  const settleStatus = extractString(data, "settleStatus", "settle_status");
  const quoteAmount = extractString(data, "quoteAmount", "quote_amount");
  const paidAmount = extractString(data, "baseAmount", "base_amount", "paidAmount", "paid_amount");

  return {
    orderId: extractString(data, "orderId", "order_id") ?? params.orderId,
    traceId: extractString(data, "traceId", "trace_id") ?? params.traceId,
    payeeId: extractString(data, "payeeId", "payee_id"),
    quoteAssetId: extractString(data, "quoteAssetId", "quote_asset_id"),
    quoteAmount,
    settlementAssetId: extractString(data, "settlementAssetId", "settlement_asset_id"),
    status: mapMixpayStatus(rawStatus, settleStatus, quoteAmount, paidAmount),
    rawStatus,
    settleStatus,
    raw: data,
  };
}
