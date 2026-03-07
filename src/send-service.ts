import { MixinApi } from "@mixin.dev/mixin-node-sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { MixinAccountConfig } from "./config-schema.js";
import { getAccountConfig } from "./config.js";
import { buildRequestConfig } from "./proxy.js";
import crypto from "crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "fs/promises";
import path from "path";

const BASE_DELAY = 1000;
const MAX_DELAY = 60_000;
const MULTIPLIER = 1.5;
const OUTBOX_DIR = path.join(process.cwd(), "data");
const OUTBOX_FILE = path.join(OUTBOX_DIR, "mixin-outbox.json");
const OUTBOX_TMP_FILE = `${OUTBOX_FILE}.tmp`;
const MAX_ERROR_LENGTH = 500;
const MAX_OUTBOX_FILE_BYTES = 10 * 1024 * 1024;

type SendLog = {
  info: (msg: string) => void;
  error: (msg: string, err?: unknown) => void;
  warn: (msg: string) => void;
};

interface OutboxEntry {
  jobId: string;
  accountId: string;
  conversationId: string;
  recipientId?: string;
  text: string;
  messageId: string;
  attempts: number;
  nextAttemptAt: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  status: "pending" | "sending";
}

export interface OutboxStatus {
  totalPending: number;
  pendingByAccount: Array<{
    accountId: string;
    pending: number;
  }>;
  oldestPendingAt?: string;
  nextAttemptAt?: string;
  latestError?: string;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

const fallbackLog: SendLog = {
  info: (msg: string) => console.log(msg),
  warn: (msg: string) => console.warn(msg),
  error: (msg: string, err?: unknown) => console.error(msg, err),
};

const state: {
  cfg: OpenClawConfig | null;
  log: SendLog;
  loaded: boolean;
  started: boolean;
  entries: OutboxEntry[];
  persistChain: Promise<void>;
  wakeRequested: boolean;
  wakeResolver: (() => void) | null;
} = {
  cfg: null,
  log: fallbackLog,
  loaded: false,
  started: false,
  entries: [],
  persistChain: Promise.resolve(),
  wakeRequested: false,
  wakeResolver: null,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildClient(config: MixinAccountConfig) {
  return MixinApi({
    keystore: {
      app_id: config.appId!,
      session_id: config.sessionId!,
      server_public_key: config.serverPublicKey!,
      session_private_key: config.sessionPrivateKey!,
    },
    requestConfig: buildRequestConfig(config.proxy),
  });
}

function computeNextDelay(attempts: number): number {
  return Math.min(BASE_DELAY * Math.pow(MULTIPLIER, Math.max(0, attempts)), MAX_DELAY);
}

function updateRuntime(cfg: OpenClawConfig, log?: SendLog): void {
  state.cfg = cfg;
  if (log) {
    state.log = log;
  }
}

function normalizeErrorMessage(message: string): string {
  if (message.length <= MAX_ERROR_LENGTH) {
    return message;
  }
  return `${message.slice(0, MAX_ERROR_LENGTH)}...`;
}

function normalizeEntry(entry: OutboxEntry): OutboxEntry {
  return {
    ...entry,
    attempts: typeof entry.attempts === "number" ? entry.attempts : 0,
    nextAttemptAt: typeof entry.nextAttemptAt === "number" ? entry.nextAttemptAt : Date.now(),
    updatedAt: entry.updatedAt ?? entry.createdAt ?? new Date().toISOString(),
    createdAt: entry.createdAt ?? new Date().toISOString(),
    status: "pending",
    lastError: entry.lastError ? normalizeErrorMessage(entry.lastError) : undefined,
  };
}

async function cleanupOutboxTmpFile(): Promise<void> {
  try {
    await rm(OUTBOX_TMP_FILE, { force: true });
  } catch (err) {
    state.log.warn(`[mixin] failed to remove stale outbox tmp file: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function warnIfOutboxFileTooLarge(): Promise<void> {
  try {
    const info = await stat(OUTBOX_FILE);
    if (info.size > MAX_OUTBOX_FILE_BYTES) {
      state.log.warn(`[mixin] outbox file is large: bytes=${info.size}, pending=${state.entries.length}`);
    }
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
    if (code !== "ENOENT") {
      state.log.warn(`[mixin] failed to stat outbox file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function ensureOutboxLoaded(): Promise<void> {
  if (state.loaded) {
    return;
  }

  await mkdir(OUTBOX_DIR, { recursive: true });
  await cleanupOutboxTmpFile();

  try {
    const raw = await readFile(OUTBOX_FILE, "utf-8");
    const parsed = JSON.parse(raw) as OutboxEntry[];
    state.entries = Array.isArray(parsed)
      ? parsed.map((entry) => normalizeEntry(entry))
      : [];
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
    if (code !== "ENOENT") {
      state.log.error("[mixin] failed to load outbox", err);
    }
    state.entries = [];
  }

  state.loaded = true;
  await persistEntries();
  await warnIfOutboxFileTooLarge();
}

function queuePersist(task: () => Promise<void>): Promise<void> {
  const next = state.persistChain.then(task);
  state.persistChain = next.catch(() => {});
  return next;
}

async function persistEntries(): Promise<void> {
  await queuePersist(async () => {
    await mkdir(OUTBOX_DIR, { recursive: true });
    const payload = JSON.stringify(state.entries, null, 2);
    await writeFile(OUTBOX_TMP_FILE, payload, "utf-8");
    await rename(OUTBOX_TMP_FILE, OUTBOX_FILE);
    await warnIfOutboxFileTooLarge();
  });
}

function wakeWorker(): void {
  state.wakeRequested = true;
  if (state.wakeResolver) {
    const resolve = state.wakeResolver;
    state.wakeResolver = null;
    resolve();
  }
}

async function waitForWake(delayMs: number): Promise<void> {
  if (state.wakeRequested) {
    state.wakeRequested = false;
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      state.wakeResolver = null;
      resolve();
    }, delayMs);

    state.wakeResolver = () => {
      clearTimeout(timeout);
      state.wakeResolver = null;
      resolve();
    };
  });

  state.wakeRequested = false;
}

function getNextWakeDelay(): number {
  const next = state.entries.reduce<number | null>((min, entry) => {
    if (entry.status !== "pending") {
      return min;
    }
    if (min === null || entry.nextAttemptAt < min) {
      return entry.nextAttemptAt;
    }
    return min;
  }, null);

  if (next === null) {
    return 5000;
  }

  return Math.max(0, next - Date.now());
}

async function attemptSend(entry: OutboxEntry): Promise<void> {
  if (!state.cfg) {
    throw new Error("send worker config not initialized");
  }

  const config = getAccountConfig(state.cfg, entry.accountId);
  if (!config.appId || !config.sessionId || !config.serverPublicKey || !config.sessionPrivateKey) {
    throw new Error(`account ${entry.accountId} is not fully configured`);
  }

  const client = buildClient(config);
  const messagePayload: {
    conversation_id: string;
    message_id: string;
    category: "PLAIN_TEXT";
    data_base64: string;
    recipient_id?: string;
  } = {
    conversation_id: entry.conversationId,
    message_id: entry.messageId,
    category: "PLAIN_TEXT",
    data_base64: Buffer.from(entry.text).toString("base64"),
  };

  if (entry.recipientId) {
    messagePayload.recipient_id = entry.recipientId;
  }

  await client.message.sendOne(messagePayload);
}

async function processEntry(entry: OutboxEntry): Promise<void> {
  entry.status = "sending";
  entry.updatedAt = new Date().toISOString();
  await persistEntries();

  try {
    await attemptSend(entry);
    state.entries = state.entries.filter((item) => item.jobId !== entry.jobId);
    await persistEntries();
    state.log.info(
      `[mixin] outbox sent: jobId=${entry.jobId}, messageId=${entry.messageId}, attempts=${entry.attempts + 1}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    entry.status = "pending";
    entry.attempts += 1;
    entry.lastError = normalizeErrorMessage(msg);
    entry.nextAttemptAt = Date.now() + computeNextDelay(entry.attempts);
    entry.updatedAt = new Date().toISOString();
    await persistEntries();
    state.log.warn(
      `[mixin] outbox retry scheduled: jobId=${entry.jobId}, messageId=${entry.messageId}, attempts=${entry.attempts}, delayMs=${Math.max(0, entry.nextAttemptAt - Date.now())}, error=${msg}`,
    );
  }
}

async function processDueEntries(): Promise<void> {
  const now = Date.now();
  const dueEntries = state.entries
    .filter((entry) => entry.status === "pending" && entry.nextAttemptAt <= now)
    .sort((a, b) => {
      if (a.nextAttemptAt !== b.nextAttemptAt) {
        return a.nextAttemptAt - b.nextAttemptAt;
      }
      return a.createdAt.localeCompare(b.createdAt);
    });

  for (const entry of dueEntries) {
    await processEntry(entry);
  }
}

async function runWorkerLoop(): Promise<void> {
  while (true) {
    try {
      await ensureOutboxLoaded();
      await processDueEntries();
    } catch (err) {
      state.log.error("[mixin] outbox worker error", err);
      await sleep(BASE_DELAY);
    }

    await waitForWake(getNextWakeDelay());
  }
}

export async function startSendWorker(cfg: OpenClawConfig, log?: SendLog): Promise<void> {
  updateRuntime(cfg, log);
  await ensureOutboxLoaded();

  if (!state.started) {
    state.started = true;
    void runWorkerLoop();
  } else {
    wakeWorker();
  }
}

export async function getOutboxStatus(): Promise<OutboxStatus> {
  await ensureOutboxLoaded();

  const sorted = [...state.entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const oldest = sorted[0];
  const nextAttempt = state.entries.reduce<number | null>((min, entry) => {
    if (entry.status !== "pending") {
      return min;
    }
    if (min === null || entry.nextAttemptAt < min) {
      return entry.nextAttemptAt;
    }
    return min;
  }, null);

  const latestErrorEntry = [...state.entries]
    .filter((entry) => entry.lastError)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  const pendingByAccount = Array.from(
    state.entries.reduce<Map<string, number>>((map, entry) => {
      map.set(entry.accountId, (map.get(entry.accountId) ?? 0) + 1);
      return map;
    }, new Map<string, number>()),
  )
    .map(([accountId, pending]) => ({ accountId, pending }))
    .sort((a, b) => a.accountId.localeCompare(b.accountId));

  return {
    totalPending: state.entries.length,
    pendingByAccount,
    oldestPendingAt: oldest?.createdAt,
    nextAttemptAt: nextAttempt ? new Date(nextAttempt).toISOString() : undefined,
    latestError: latestErrorEntry?.lastError,
  };
}

export async function sendTextMessage(
  cfg: OpenClawConfig,
  accountId: string,
  conversationId: string,
  recipientId: string | undefined,
  text: string,
  log?: SendLog,
): Promise<SendResult> {
  updateRuntime(cfg, log);
  await startSendWorker(cfg, log);

  const now = new Date().toISOString();
  const entry: OutboxEntry = {
    jobId: crypto.randomUUID(),
    accountId,
    conversationId,
    recipientId,
    text,
    messageId: crypto.randomUUID(),
    attempts: 0,
    nextAttemptAt: Date.now(),
    createdAt: now,
    updatedAt: now,
    status: "pending",
  };

  state.entries.push(entry);
  await persistEntries();
  wakeWorker();

  state.log.info(
    `[mixin] outbox enqueued: jobId=${entry.jobId}, messageId=${entry.messageId}, accountId=${accountId}, conversation=${conversationId}`,
  );

  return { ok: true, messageId: entry.messageId };
}

export async function acknowledgeMessage(
  cfg: OpenClawConfig,
  accountId: string,
  messageId: string,
): Promise<void> {
  try {
    const config = getAccountConfig(cfg, accountId);
    if (!config.appId || !config.sessionId || !config.serverPublicKey || !config.sessionPrivateKey) {
      return;
    }
    const client = buildClient(config);
    await client.message.sendAcknowledgement(
      { message_id: messageId, status: "READ" },
    );
  } catch {
  }
}
