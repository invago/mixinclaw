import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getMixinRuntime } from "./runtime.js";

export type MixinGroupAuthPendingRequest = {
  code: string;
  accountId: string;
  conversationId: string;
  userId: string;
  requestedAt: string;
  lastSeenAt: string;
};

export type MixinGroupAuthApprovedEntry = {
  accountId: string;
  conversationId: string;
  userId: string;
  approvedAt: string;
  approvedBy: string;
};

type GroupAuthStore = {
  version: 1;
  pending: MixinGroupAuthPendingRequest[];
  approved: MixinGroupAuthApprovedEntry[];
};

const GROUP_AUTH_CODE_LENGTH = 8;
const GROUP_AUTH_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GROUP_AUTH_PENDING_TTL_MS = 60 * 60 * 1000;

const state: {
  loaded: boolean;
  persistChain: Promise<void>;
  store: GroupAuthStore;
} = {
  loaded: false,
  persistChain: Promise.resolve(),
  store: {
    version: 1,
    pending: [],
    approved: [],
  },
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
  const storeFile = path.join(storeDir, "mixin-group-auth.json");
  return {
    storeDir,
    storeFile,
    storeTmpFile: `${storeFile}.tmp`,
  };
}

function parseTimestamp(value: string | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function prunePending(now = Date.now()): void {
  state.store.pending = state.store.pending.filter((item) => now - parseTimestamp(item.requestedAt) <= GROUP_AUTH_PENDING_TTL_MS);
}

function randomCode(): string {
  let output = "";
  for (let i = 0; i < GROUP_AUTH_CODE_LENGTH; i += 1) {
    output += GROUP_AUTH_CODE_ALPHABET[crypto.randomInt(0, GROUP_AUTH_CODE_ALPHABET.length)];
  }
  return output;
}

function generateUniqueCode(): string {
  const existing = new Set(state.store.pending.map((item) => item.code));
  for (let i = 0; i < 500; i += 1) {
    const code = randomCode();
    if (!existing.has(code)) {
      return code;
    }
  }
  throw new Error("failed to generate unique group auth code");
}

async function ensureLoaded(): Promise<void> {
  if (state.loaded) {
    return;
  }
  const { storeFile } = resolveStorePaths();
  try {
    const raw = await readFile(storeFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<GroupAuthStore>;
    state.store = {
      version: 1,
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
      approved: Array.isArray(parsed.approved) ? parsed.approved : [],
    };
  } catch {
    state.store = {
      version: 1,
      pending: [],
      approved: [],
    };
  }
  prunePending();
  state.loaded = true;
}

async function persist(): Promise<void> {
  const { storeDir, storeFile, storeTmpFile } = resolveStorePaths();
  await mkdir(storeDir, { recursive: true });
  await writeFile(storeTmpFile, JSON.stringify(state.store, null, 2), "utf8");
  await rename(storeTmpFile, storeFile);
}

function queuePersist(): Promise<void> {
  state.persistChain = state.persistChain.then(() => persist());
  return state.persistChain;
}

export async function isGroupAuthApproved(params: {
  accountId: string;
  conversationId: string;
  userId: string;
}): Promise<boolean> {
  await ensureLoaded();
  return state.store.approved.some((item) =>
    item.accountId === params.accountId &&
    item.conversationId === params.conversationId &&
    item.userId === params.userId
  );
}

export async function upsertGroupAuthRequest(params: {
  accountId: string;
  conversationId: string;
  userId: string;
}): Promise<{ code: string; created: boolean }> {
  await ensureLoaded();
  prunePending();
  const now = new Date().toISOString();
  const existing = state.store.pending.find((item) =>
    item.accountId === params.accountId &&
    item.conversationId === params.conversationId &&
    item.userId === params.userId
  );
  if (existing) {
    existing.lastSeenAt = now;
    await queuePersist();
    return {
      code: existing.code,
      created: false,
    };
  }

  const next: MixinGroupAuthPendingRequest = {
    accountId: params.accountId,
    conversationId: params.conversationId,
    userId: params.userId,
    code: generateUniqueCode(),
    requestedAt: now,
    lastSeenAt: now,
  };
  state.store.pending.push(next);
  await queuePersist();
  return {
    code: next.code,
    created: true,
  };
}

export async function approveGroupAuthRequest(params: {
  code: string;
  approvedBy: string;
}): Promise<MixinGroupAuthApprovedEntry | null> {
  await ensureLoaded();
  prunePending();
  const normalizedCode = params.code.trim().toUpperCase();
  const pendingIndex = state.store.pending.findIndex((item) => item.code === normalizedCode);
  if (pendingIndex < 0) {
    return null;
  }
  const pending = state.store.pending[pendingIndex]!;
  state.store.pending.splice(pendingIndex, 1);

  const approved: MixinGroupAuthApprovedEntry = {
    accountId: pending.accountId,
    conversationId: pending.conversationId,
    userId: pending.userId,
    approvedAt: new Date().toISOString(),
    approvedBy: params.approvedBy,
  };

  state.store.approved = state.store.approved.filter((item) =>
    !(item.accountId === approved.accountId && item.conversationId === approved.conversationId && item.userId === approved.userId)
  );
  state.store.approved.push(approved);
  await queuePersist();
  return approved;
}

export async function getGroupAuthStoreSnapshot(): Promise<{
  storeDir: string;
  storeFile: string;
  pending: number;
  approved: number;
}> {
  await ensureLoaded();
  const { storeDir, storeFile } = resolveStorePaths();
  prunePending();
  return {
    storeDir,
    storeFile,
    pending: state.store.pending.length,
    approved: state.store.approved.length,
  };
}
