import crypto from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getMixinRuntime } from "./runtime.js";

const DEDUP_STORE_VERSION = 1;
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 5000;
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_STALE_MESSAGE_MS = 30 * 60 * 1000;
const PERSIST_DEBOUNCE_MS = 1000;
const CLAIM_STALE_MS = 10 * 60 * 1000;

type MixinInboundDedupStoreEntry = {
  key: string;
  seenAt: number;
};

type MixinInboundDedupStore = {
  version: number;
  entries: MixinInboundDedupStoreEntry[];
};

type MixinInboundDedupState = {
  loaded: boolean;
  seen: Map<string, number>;
  pending: Set<string>;
  persistChain: Promise<void>;
  persistTimer: NodeJS.Timeout | null;
  sweepTimer: NodeJS.Timeout | null;
  dirty: boolean;
  lastSweepAt: number;
  lastLoadedAt: number;
};

type ClaimMixinInboundMessageParams = {
  accountId: string;
  conversationId?: string;
  messageId: string;
  createdAt?: string;
  log?: {
    info: (message: string) => void;
    warn: (message: string) => void;
  };
};

type ClaimMixinInboundMessageResult =
  | { ok: true; dedupeKey: string }
  | { ok: false; dedupeKey: string; reason: "duplicate" | "stale" | "invalid" };

type GlobalWithMixinInboundDedupState = typeof globalThis & {
  __mixinInboundDedupState__?: MixinInboundDedupState;
};

function createDefaultState(): MixinInboundDedupState {
  return {
    loaded: false,
    seen: new Map<string, number>(),
    pending: new Set<string>(),
    persistChain: Promise.resolve(),
    persistTimer: null,
    sweepTimer: null,
    dirty: false,
    lastSweepAt: 0,
    lastLoadedAt: 0,
  };
}

function getState(): MixinInboundDedupState {
  const globalState = globalThis as GlobalWithMixinInboundDedupState;
  if (!globalState.__mixinInboundDedupState__) {
    globalState.__mixinInboundDedupState__ = createDefaultState();
  }
  return globalState.__mixinInboundDedupState__;
}

function resolveFallbackDedupDir(env: NodeJS.ProcessEnv = process.env): string {
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

function resolveDedupDir(): string {
  try {
    return path.join(getMixinRuntime().state.resolveStateDir(process.env, os.homedir), "mixin");
  } catch {
    return resolveFallbackDedupDir();
  }
}

function resolveDedupPaths(): {
  dedupDir: string;
  dedupFile: string;
  dedupTmpFile: string;
  claimsDir: string;
} {
  const dedupDir = resolveDedupDir();
  const dedupFile = path.join(dedupDir, "mixin-inbound-dedup.json");
  return {
    dedupDir,
    dedupFile,
    dedupTmpFile: `${dedupFile}.tmp`,
    claimsDir: path.join(dedupDir, "claims"),
  };
}

function hashDedupeKey(dedupeKey: string): string {
  return crypto.createHash("sha1").update(dedupeKey).digest("hex");
}

function resolveClaimFilePath(dedupeKey: string): string {
  const { claimsDir } = resolveDedupPaths();
  return path.join(claimsDir, `${hashDedupeKey(dedupeKey)}.lock`);
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const timestamp = Math.max(0, Math.floor(value));
  return timestamp > 0 ? timestamp : null;
}

function buildDedupeScopeKey(params: {
  accountId: string;
  conversationId?: string;
  messageId: string;
}): string {
  const accountId = params.accountId.trim().toLowerCase();
  const conversationId = (params.conversationId ?? "").trim().toLowerCase();
  const messageId = params.messageId.trim().toLowerCase();
  return `${accountId}:${conversationId}:${messageId}`;
}

function parseCreatedAt(createdAt?: string): number | null {
  if (!createdAt) {
    return null;
  }
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return timestamp;
}

function pruneSeenEntries(now: number): boolean {
  const state = getState();
  let changed = false;
  const cutoff = now - DEFAULT_TTL_MS;

  for (const [key, seenAt] of state.seen) {
    if (seenAt <= cutoff) {
      state.seen.delete(key);
      changed = true;
    }
  }

  while (state.seen.size > DEFAULT_MAX_ENTRIES) {
    const oldestKey = state.seen.keys().next().value;
    if (!oldestKey) {
      break;
    }
    state.seen.delete(oldestKey);
    changed = true;
  }

  if (changed) {
    state.dirty = true;
  }
  state.lastSweepAt = now;
  return changed;
}

function ensureSweepTimer(log?: { warn: (message: string) => void }): void {
  const state = getState();
  if (state.sweepTimer) {
    return;
  }
  state.sweepTimer = setInterval(() => {
    const now = Date.now();
    const changed = pruneSeenEntries(now);
    if (changed || state.dirty) {
      void persistState(log);
    }
  }, DEFAULT_SWEEP_INTERVAL_MS);
  state.sweepTimer.unref?.();
}

function schedulePersist(log?: { warn: (message: string) => void }): void {
  const state = getState();
  state.dirty = true;
  if (state.persistTimer) {
    return;
  }
  state.persistTimer = setTimeout(() => {
    state.persistTimer = null;
    void persistState(log);
  }, PERSIST_DEBOUNCE_MS);
  state.persistTimer.unref?.();
}

async function persistState(log?: { warn: (message: string) => void }): Promise<void> {
  const state = getState();
  if (!state.loaded || !state.dirty) {
    return;
  }

  const now = Date.now();
  pruneSeenEntries(now);
  const { dedupDir, dedupFile, dedupTmpFile } = resolveDedupPaths();
  const payload: MixinInboundDedupStore = {
    version: DEDUP_STORE_VERSION,
    entries: Array.from(state.seen.entries()).map(([key, seenAt]) => ({ key, seenAt })),
  };

  state.dirty = false;
  state.persistChain = state.persistChain
    .catch(() => {})
    .then(async () => {
      try {
        await mkdir(dedupDir, { recursive: true });
        await writeFile(dedupTmpFile, JSON.stringify(payload), "utf-8");
        try {
          await rename(dedupTmpFile, dedupFile);
        } catch {
          await writeFile(dedupFile, JSON.stringify(payload), "utf-8");
        }
      } catch (err) {
        state.dirty = true;
        log?.warn(
          `[mixin] failed to persist inbound dedup store: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });

  await state.persistChain;
}

async function loadStateFromDisk(log?: { warn: (message: string) => void }): Promise<void> {
  const state = getState();
  const { dedupFile } = resolveDedupPaths();
  state.seen.clear();
  try {
    const raw = await readFile(dedupFile, "utf-8");
    const parsed = JSON.parse(raw) as Partial<MixinInboundDedupStore>;
    if (parsed.version === DEDUP_STORE_VERSION && Array.isArray(parsed.entries)) {
      for (const entry of parsed.entries) {
        if (!entry || typeof entry.key !== "string") {
          continue;
        }
        const key = entry.key.trim();
        const seenAt = normalizeTimestamp(entry.seenAt);
        if (!key || seenAt === null) {
          continue;
        }
        state.seen.set(key, seenAt);
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
      log?.warn(
        `[mixin] failed to load inbound dedup store: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  state.loaded = true;
  state.lastLoadedAt = Date.now();
  pruneSeenEntries(Date.now());
  ensureSweepTimer(log);
}

async function ensureLoaded(log?: { warn: (message: string) => void }): Promise<void> {
  const state = getState();
  if (state.loaded) {
    return;
  }
  await loadStateFromDisk(log);
}

async function refreshStateFromDisk(log?: { warn: (message: string) => void }): Promise<void> {
  const state = getState();
  const { dedupFile } = resolveDedupPaths();
  try {
    const fileStat = await stat(dedupFile);
    if (!state.loaded || fileStat.mtimeMs > state.lastLoadedAt) {
      await loadStateFromDisk(log);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      if (!state.loaded) {
        state.loaded = true;
        state.lastLoadedAt = Date.now();
        ensureSweepTimer(log);
      }
      return;
    }
    log?.warn(
      `[mixin] failed to refresh inbound dedup store: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function shouldSweep(now: number): boolean {
  const state = getState();
  return now - state.lastSweepAt >= DEFAULT_SWEEP_INTERVAL_MS;
}

async function claimCrossProcessLock(
  dedupeKey: string,
  log?: { warn: (message: string) => void },
): Promise<boolean> {
  const { claimsDir } = resolveDedupPaths();
  const claimFile = resolveClaimFilePath(dedupeKey);
  await mkdir(claimsDir, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(claimFile, "wx");
      try {
        await handle.writeFile(JSON.stringify({ dedupeKey, claimedAt: Date.now(), pid: process.pid }), "utf-8");
      } finally {
        await handle.close();
      }
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "EEXIST") {
        log?.warn(
          `[mixin] failed to create inbound dedup claim file: ${err instanceof Error ? err.message : String(err)}`,
        );
        return false;
      }
      try {
        const claimStat = await stat(claimFile);
        if (Date.now() - claimStat.mtimeMs < CLAIM_STALE_MS) {
          return false;
        }
        await rm(claimFile, { force: true });
      } catch {
        return false;
      }
    }
  }

  return false;
}

async function releaseCrossProcessLock(dedupeKey: string): Promise<void> {
  const claimFile = resolveClaimFilePath(dedupeKey);
  try {
    await rm(claimFile, { force: true });
  } catch (err) {
    void err;
  }
}

export async function claimMixinInboundMessage(params: ClaimMixinInboundMessageParams): Promise<ClaimMixinInboundMessageResult> {
  const dedupeKey = buildDedupeScopeKey(params);
  if (!dedupeKey.trim()) {
    return {
      ok: false,
      dedupeKey,
      reason: "invalid",
    };
  }

  await ensureLoaded(params.log);
  await refreshStateFromDisk(params.log);
  const now = Date.now();
  if (shouldSweep(now)) {
    pruneSeenEntries(now);
  }

  const createdAtTs = parseCreatedAt(params.createdAt);
  if (createdAtTs !== null && now - createdAtTs >= DEFAULT_STALE_MESSAGE_MS) {
    return {
      ok: false,
      dedupeKey,
      reason: "stale",
    };
  }

  const state = getState();
  const seenAt = state.seen.get(dedupeKey);
  if (seenAt !== undefined && now - seenAt < DEFAULT_TTL_MS) {
    return {
      ok: false,
      dedupeKey,
      reason: "duplicate",
    };
  }

  if (state.pending.has(dedupeKey)) {
    return {
      ok: false,
      dedupeKey,
      reason: "duplicate",
    };
  }

  const claimed = await claimCrossProcessLock(dedupeKey, params.log);
  if (!claimed) {
    return {
      ok: false,
      dedupeKey,
      reason: "duplicate",
    };
  }

  state.pending.add(dedupeKey);
  return {
    ok: true,
    dedupeKey,
  };
}

export async function commitMixinInboundMessage(dedupeKey: string, log?: { warn: (message: string) => void }): Promise<void> {
  const normalizedKey = dedupeKey.trim();
  if (!normalizedKey) {
    return;
  }

  await ensureLoaded(log);
  const state = getState();
  state.pending.delete(normalizedKey);
  state.seen.delete(normalizedKey);
  state.seen.set(normalizedKey, Date.now());
  pruneSeenEntries(Date.now());
  schedulePersist(log);
  await persistState(log);
}

export async function releaseMixinInboundMessage(dedupeKey: string): Promise<void> {
  const normalizedKey = dedupeKey.trim();
  if (!normalizedKey) {
    return;
  }
  const state = getState();
  state.pending.delete(normalizedKey);
  await releaseCrossProcessLock(normalizedKey);
}

export function buildMixinInboundDedupeKey(params: {
  accountId: string;
  conversationId?: string;
  messageId: string;
}): string {
  return buildDedupeScopeKey(params);
}

export async function flushMixinInboundDedup(log?: { warn: (message: string) => void }): Promise<void> {
  await ensureLoaded(log);
  await persistState(log);
}
