import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getMixinRuntime } from "./runtime.js";

export type MixpayOrderStatus =
  | "unpaid"
  | "pending"
  | "paid_less"
  | "success"
  | "failed"
  | "expired"
  | "unknown";

export type MixpayOrderRecord = {
  orderId: string;
  traceId: string;
  paymentId?: string;
  code?: string;
  paymentUrl?: string;
  accountId: string;
  conversationId: string;
  recipientId?: string;
  creatorId: string;
  quoteAssetId: string;
  quoteAmount: string;
  settlementAssetId?: string;
  memo?: string;
  status: MixpayOrderStatus;
  rawStatus?: string;
  createdAt: string;
  updatedAt: string;
  expireAt?: string;
  lastPolledAt?: string;
  lastNotifyStatus?: string;
  latestError?: string;
};

type MixpayStoreState = {
  loaded: boolean;
  persistChain: Promise<void>;
  orders: MixpayOrderRecord[];
};

const state: MixpayStoreState = {
  loaded: false,
  persistChain: Promise.resolve(),
  orders: [],
};

function resolveFallbackStoreDir(env: NodeJS.ProcessEnv = process.env): string {
  const stateOverride = env.OPENCLAW_STATE_DIR?.trim() || env.CLAWDBOT_STATE_DIR?.trim();
  if (stateOverride) {
    return path.join(stateOverride, "mixin");
  }
  const openClawHome = env.OPENCLAW_HOME?.trim();
  if (openClawHome) {
    return path.join(openClawHome, ".openclaw", "mixin");
  }
  return path.join(os.homedir(), ".openclaw", "mixin");
}

function resolveStoreDir(): string {
  try {
    return path.join(getMixinRuntime().state.resolveStateDir(process.env, os.homedir), "mixin");
  } catch {
    return resolveFallbackStoreDir();
  }
}

function resolveStorePaths(): {
  storeDir: string;
  storeFile: string;
  storeTmpFile: string;
} {
  const storeDir = resolveStoreDir();
  const storeFile = path.join(storeDir, "mixpay-orders.json");
  return {
    storeDir,
    storeFile,
    storeTmpFile: `${storeFile}.tmp`,
  };
}

function normalizeRecord(record: MixpayOrderRecord): MixpayOrderRecord {
  return {
    ...record,
    recipientId: record.recipientId || undefined,
    paymentId: record.paymentId || undefined,
    code: record.code || undefined,
    paymentUrl: record.paymentUrl || undefined,
    settlementAssetId: record.settlementAssetId || undefined,
    memo: record.memo || undefined,
    rawStatus: record.rawStatus || undefined,
    expireAt: record.expireAt || undefined,
    lastPolledAt: record.lastPolledAt || undefined,
    lastNotifyStatus: record.lastNotifyStatus || undefined,
    latestError: record.latestError || undefined,
  };
}

const ORDER_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TERMINAL_STATUSES: MixpayOrderStatus[] = ["success", "failed", "expired"];

async function ensureLoaded(): Promise<void> {
  if (state.loaded) {
    return;
  }
  const { storeFile } = resolveStorePaths();
  try {
    const raw = await readFile(storeFile, "utf8");
    const parsed = JSON.parse(raw) as { orders?: MixpayOrderRecord[] } | MixpayOrderRecord[];
    const orders = Array.isArray(parsed) ? parsed : Array.isArray(parsed.orders) ? parsed.orders : [];
    const cutoff = Date.now() - ORDER_RETENTION_MS;
    state.orders = orders
      .map(normalizeRecord)
      .filter((order) => {
        if (!TERMINAL_STATUSES.includes(order.status)) {
          return true;
        }
        return Date.parse(order.updatedAt) > cutoff;
      });
  } catch {
    state.orders = [];
  }
  state.loaded = true;
}

async function persist(): Promise<void> {
  const { storeDir, storeFile, storeTmpFile } = resolveStorePaths();
  await mkdir(storeDir, { recursive: true });
  const raw = JSON.stringify({ orders: state.orders }, null, 2);
  await writeFile(storeTmpFile, raw, "utf8");
  await rename(storeTmpFile, storeFile);
}

function queuePersist(): Promise<void> {
  state.persistChain = state.persistChain.then(() => persist());
  return state.persistChain;
}

export async function getMixpayStoreSnapshot(): Promise<{
  storeDir: string;
  storeFile: string;
  total: number;
  pending: number;
}> {
  await ensureLoaded();
  const { storeDir, storeFile } = resolveStorePaths();
  const pending = state.orders.filter((order) => order.status === "unpaid" || order.status === "pending").length;
  return {
    storeDir,
    storeFile,
    total: state.orders.length,
    pending,
  };
}

export async function createMixpayOrder(record: MixpayOrderRecord): Promise<MixpayOrderRecord> {
  await ensureLoaded();
  state.orders = [normalizeRecord(record), ...state.orders.filter((item) => item.orderId !== record.orderId)];
  await queuePersist();
  return record;
}

export async function updateMixpayOrder(
  orderId: string,
  updater: (current: MixpayOrderRecord) => MixpayOrderRecord,
): Promise<MixpayOrderRecord | null> {
  await ensureLoaded();
  const index = state.orders.findIndex((item) => item.orderId === orderId);
  if (index < 0) {
    return null;
  }
  const next = normalizeRecord(updater(state.orders[index]!));
  state.orders[index] = next;
  await queuePersist();
  return next;
}

export async function findMixpayOrder(orderId: string): Promise<MixpayOrderRecord | null> {
  await ensureLoaded();
  return state.orders.find((item) => item.orderId === orderId) ?? null;
}

export async function listRecentMixpayOrders(params?: {
  accountId?: string;
  conversationId?: string;
  limit?: number;
}): Promise<MixpayOrderRecord[]> {
  await ensureLoaded();
  const limit = Math.max(1, params?.limit ?? 5);
  return state.orders
    .filter((item) => !params?.accountId || item.accountId === params.accountId)
    .filter((item) => !params?.conversationId || item.conversationId === params.conversationId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);
}

export async function listPendingMixpayOrders(): Promise<MixpayOrderRecord[]> {
  await ensureLoaded();
  return state.orders
    .filter((item) => item.status === "unpaid" || item.status === "pending")
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
}
