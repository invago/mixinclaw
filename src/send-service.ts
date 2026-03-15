import crypto from "crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { MixinApi } from "@mixin.dev/mixin-node-sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { MixinAccountConfig } from "./config-schema.js";
import { getAccountConfig } from "./config.js";
import { buildRequestConfig } from "./proxy.js";
import { getMixinBlazeSender, getMixinRuntime } from "./runtime.js";

const BASE_DELAY = 1000;
const MAX_DELAY = 60_000;
const MULTIPLIER = 1.5;
const MAX_ERROR_LENGTH = 500;
const MAX_OUTBOX_FILE_BYTES = 10 * 1024 * 1024;

type SendLog = {
  info: (msg: string) => void;
  error: (msg: string, err?: unknown) => void;
  warn: (msg: string) => void;
};

export type MixinSupportedMessageCategory =
  | "PLAIN_TEXT"
  | "PLAIN_POST"
  | "PLAIN_AUDIO"
  | "PLAIN_DATA"
  | "APP_BUTTON_GROUP"
  | "APP_CARD";

export interface MixinButton {
  label: string;
  color?: string;
  action: string;
}

export interface MixinCard {
  title: string;
  description: string;
  action?: string;
  actions?: MixinButton[];
  coverUrl?: string;
  iconUrl?: string;
  shareable?: boolean;
}

export interface MixinFile {
  filePath: string;
  fileName?: string;
  mimeType?: string;
}

export interface MixinAudio {
  filePath: string;
  mimeType?: string;
  duration: number;
  waveForm?: string;
}

interface FileOutboxBody {
  kind: "file";
  filePath: string;
  fileName: string;
  mimeType: string;
}

interface AudioOutboxBody {
  kind: "audio";
  filePath: string;
  mimeType: string;
  duration: number;
  waveForm?: string;
}

interface OutboxEntry {
  jobId: string;
  accountId: string;
  conversationId: string;
  recipientId?: string;
  category: MixinSupportedMessageCategory;
  body: string;
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

export interface OutboxPurgeResult {
  removed: number;
  removedJobIds: string[];
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
  outboxPathLogged: boolean;
  entries: OutboxEntry[];
  persistChain: Promise<void>;
  wakeRequested: boolean;
  wakeResolver: (() => void) | null;
} = {
  cfg: null,
  log: fallbackLog,
  loaded: false,
  started: false,
  outboxPathLogged: false,
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

function guessMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case ".txt":
      return "text/plain";
    case ".md":
      return "text/markdown";
    case ".json":
      return "application/json";
    case ".pdf":
      return "application/pdf";
    case ".zip":
      return "application/zip";
    case ".csv":
      return "text/csv";
    case ".ogg":
      return "audio/ogg";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    default:
      return "application/octet-stream";
  }
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

function resolveFallbackOutboxDir(env: NodeJS.ProcessEnv = process.env): string {
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

function resolveOutboxDir(): string {
  try {
    return path.join(getMixinRuntime().state.resolveStateDir(process.env, os.homedir), "mixin");
  } catch (err) {
    const fallbackDir = resolveFallbackOutboxDir();
    state.log.warn(
      `[mixin] failed to resolve OpenClaw state dir, falling back to ${fallbackDir}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return fallbackDir;
  }
}

function resolveOutboxPaths(): {
  outboxDir: string;
  outboxFile: string;
  outboxTmpFile: string;
} {
  const outboxDir = resolveOutboxDir();
  const outboxFile = path.join(outboxDir, "mixin-outbox.json");
  return {
    outboxDir,
    outboxFile,
    outboxTmpFile: `${outboxFile}.tmp`,
  };
}

export function getOutboxPathsSnapshot(): {
  outboxDir: string;
  outboxFile: string;
} {
  const { outboxDir, outboxFile } = resolveOutboxPaths();
  return {
    outboxDir,
    outboxFile,
  };
}

function normalizeErrorMessage(message: string): string {
  if (message.length <= MAX_ERROR_LENGTH) {
    return message;
  }
  return `${message.slice(0, MAX_ERROR_LENGTH)}...`;
}

function isPermanentInvalidEntry(entry: OutboxEntry): boolean {
  if (entry.category !== "APP_CARD" && entry.category !== "APP_BUTTON_GROUP") {
    return false;
  }

  const error = (entry.lastError ?? "").toLowerCase();
  return error.includes("code: 10002") && error.includes("invalid field");
}

function normalizeEntry(entry: OutboxEntry): OutboxEntry {
  const legacyText = "text" in entry && typeof (entry as OutboxEntry & { text?: unknown }).text === "string"
    ? String((entry as OutboxEntry & { text?: unknown }).text)
    : "";
  const category = typeof entry.category === "string" ? entry.category : "PLAIN_TEXT";
  const body = typeof entry.body === "string" ? entry.body : legacyText;

  return {
    ...entry,
    category,
    body,
    attempts: typeof entry.attempts === "number" ? entry.attempts : 0,
    nextAttemptAt: typeof entry.nextAttemptAt === "number" ? entry.nextAttemptAt : Date.now(),
    updatedAt: entry.updatedAt ?? entry.createdAt ?? new Date().toISOString(),
    createdAt: entry.createdAt ?? new Date().toISOString(),
    status: "pending",
    lastError: entry.lastError ? normalizeErrorMessage(entry.lastError) : undefined,
  };
}

function isStructuredBody(body: string): body is string {
  return body.trim().startsWith("{");
}

function parseFileBody(body: string): FileOutboxBody {
  const parsed = JSON.parse(body) as Partial<FileOutboxBody>;
  if (parsed.kind !== "file" || !parsed.filePath || !parsed.fileName || !parsed.mimeType) {
    throw new Error("invalid file outbox body");
  }
  return {
    kind: "file",
    filePath: String(parsed.filePath),
    fileName: String(parsed.fileName),
    mimeType: String(parsed.mimeType),
  };
}

async function buildAttachmentPayload(
  client: ReturnType<typeof buildClient>,
  filePath: string,
  fileName: string,
  mimeType: string,
): Promise<string> {
  const buffer = await readFile(filePath);
  const file = new File([buffer], fileName, { type: mimeType });
  const uploaded = await client.attachment.upload(file);
  const fileInfo = await stat(filePath);

  return JSON.stringify({
    attachment_id: uploaded.attachment_id,
    mime_type: mimeType,
    size: fileInfo.size,
    name: fileName,
  });
}

async function buildAudioAttachmentPayload(
  client: ReturnType<typeof buildClient>,
  body: AudioOutboxBody,
): Promise<string> {
  const fileName = path.basename(body.filePath);
  const buffer = await readFile(body.filePath);
  const file = new File([buffer], fileName, { type: body.mimeType });
  const uploaded = await client.attachment.upload(file);
  const fileInfo = await stat(body.filePath);

  return JSON.stringify({
    attachment_id: uploaded.attachment_id,
    mime_type: body.mimeType,
    size: fileInfo.size,
    duration: body.duration,
    wave_form: body.waveForm,
  });
}

async function cleanupOutboxTmpFile(): Promise<void> {
  const { outboxTmpFile } = resolveOutboxPaths();
  try {
    await rm(outboxTmpFile, { force: true });
  } catch (err) {
    state.log.warn(`[mixin] failed to remove stale outbox tmp file: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function warnIfOutboxFileTooLarge(): Promise<void> {
  const { outboxFile } = resolveOutboxPaths();
  try {
    const info = await stat(outboxFile);
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

  const { outboxDir, outboxFile } = resolveOutboxPaths();
  if (!state.outboxPathLogged) {
    state.log.info(`[mixin] outbox path: dir=${outboxDir}, file=${outboxFile}`);
    state.outboxPathLogged = true;
  }
  await mkdir(outboxDir, { recursive: true });
  await cleanupOutboxTmpFile();

  try {
    const raw = await readFile(outboxFile, "utf-8");
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
    const { outboxDir, outboxFile, outboxTmpFile } = resolveOutboxPaths();
    await mkdir(outboxDir, { recursive: true });
    const payload = JSON.stringify(state.entries, null, 2);
    await writeFile(outboxTmpFile, payload, "utf-8");
    await rename(outboxTmpFile, outboxFile);
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
  let payloadBody = entry.body;
  if (entry.category === "PLAIN_DATA" && isStructuredBody(entry.body)) {
    const body = parseFileBody(entry.body);
    payloadBody = await buildAttachmentPayload(client, body.filePath, body.fileName, body.mimeType);
  } else if (entry.category === "PLAIN_AUDIO" && isStructuredBody(entry.body)) {
    const body = JSON.parse(entry.body) as AudioOutboxBody;
    payloadBody = await buildAudioAttachmentPayload(client, body);
  }

  const dataBase64 = Buffer.from(payloadBody).toString("base64");
  if (!entry.recipientId) {
    const blazeSender = getMixinBlazeSender(entry.accountId);
    if (!blazeSender) {
      throw new Error("group send failed: blaze sender unavailable");
    }
    state.log.info(
      `[mixin] attempt send: transport=blaze, jobId=${entry.jobId}, messageId=${entry.messageId}, conversation=${entry.conversationId}, recipient=none, category=${entry.category}`,
    );
    await blazeSender({
      conversationId: entry.conversationId,
      messageId: entry.messageId,
      category: entry.category,
      dataBase64,
    });
    return;
  }

  const messagePayload: {
    conversation_id: string;
    message_id: string;
    category: MixinSupportedMessageCategory;
    data_base64: string;
    recipient_id?: string;
  } = {
    conversation_id: entry.conversationId,
    message_id: entry.messageId,
    category: entry.category,
    data_base64: dataBase64,
  };

  if (entry.recipientId) {
    messagePayload.recipient_id = entry.recipientId;
  }

  state.log.info(
    `[mixin] attempt send: transport=rest, jobId=${entry.jobId}, messageId=${entry.messageId}, conversation=${entry.conversationId}, recipient=${messagePayload.recipient_id ?? "none"}, category=${entry.category}`,
  );

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

export async function purgePermanentInvalidOutboxEntries(): Promise<OutboxPurgeResult> {
  await ensureOutboxLoaded();

  const removedEntries = state.entries.filter((entry) => isPermanentInvalidEntry(entry));
  if (removedEntries.length === 0) {
    return { removed: 0, removedJobIds: [] };
  }

  const removedJobIds = removedEntries.map((entry) => entry.jobId);
  state.entries = state.entries.filter((entry) => !isPermanentInvalidEntry(entry));
  await persistEntries();

  return {
    removed: removedEntries.length,
    removedJobIds,
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
  return sendMixinMessage(cfg, accountId, conversationId, recipientId, "PLAIN_TEXT", text, log);
}

export async function sendPostMessage(
  cfg: OpenClawConfig,
  accountId: string,
  conversationId: string,
  recipientId: string | undefined,
  text: string,
  log?: SendLog,
): Promise<SendResult> {
  return sendMixinMessage(cfg, accountId, conversationId, recipientId, "PLAIN_POST", text, log);
}

export async function sendFileMessage(
  cfg: OpenClawConfig,
  accountId: string,
  conversationId: string,
  recipientId: string | undefined,
  file: MixinFile,
  log?: SendLog,
): Promise<SendResult> {
  const fileName = file.fileName?.trim() || path.basename(file.filePath);
  const mimeType = file.mimeType?.trim() || guessMimeType(fileName);
  const body = JSON.stringify({
    kind: "file",
    filePath: file.filePath,
    fileName,
    mimeType,
  } satisfies FileOutboxBody);

  return sendMixinMessage(cfg, accountId, conversationId, recipientId, "PLAIN_DATA", body, log);
}

export async function sendAudioMessage(
  cfg: OpenClawConfig,
  accountId: string,
  conversationId: string,
  recipientId: string | undefined,
  audio: MixinAudio,
  log?: SendLog,
): Promise<SendResult> {
  const mimeType = audio.mimeType?.trim() || guessMimeType(audio.filePath);
  const body = JSON.stringify({
    kind: "audio",
    filePath: audio.filePath,
    mimeType,
    duration: audio.duration,
    waveForm: audio.waveForm,
  } satisfies AudioOutboxBody);

  return sendMixinMessage(cfg, accountId, conversationId, recipientId, "PLAIN_AUDIO", body, log);
}

export async function sendButtonGroupMessage(
  cfg: OpenClawConfig,
  accountId: string,
  conversationId: string,
  recipientId: string | undefined,
  buttons: MixinButton[],
  log?: SendLog,
): Promise<SendResult> {
  const lines = buttons.map((button, index) => `${index + 1}. ${button.label}: ${button.action}`);
  return sendPostMessage(cfg, accountId, conversationId, recipientId, lines.join("\n"), log);
}

export async function sendCardMessage(
  cfg: OpenClawConfig,
  accountId: string,
  conversationId: string,
  recipientId: string | undefined,
  card: MixinCard,
  log?: SendLog,
): Promise<SendResult> {
  const lines = [card.title, "", card.description];

  if (card.action) {
    lines.push("", `Open: ${card.action}`);
  }

  if (card.actions && card.actions.length > 0) {
    lines.push("", ...card.actions.map((button, index) => `${index + 1}. ${button.label}: ${button.action}`));
  }

  return sendPostMessage(cfg, accountId, conversationId, recipientId, lines.join("\n"), log);
}

async function sendMixinMessage(
  cfg: OpenClawConfig,
  accountId: string,
  conversationId: string,
  recipientId: string | undefined,
  category: MixinSupportedMessageCategory,
  body: string,
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
    category,
    body,
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
    `[mixin] outbox enqueued: jobId=${entry.jobId}, messageId=${entry.messageId}, category=${category}, accountId=${accountId}, conversation=${conversationId}`,
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
  } catch (err) {
    void err;
  }
}
