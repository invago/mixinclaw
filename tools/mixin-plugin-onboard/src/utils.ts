import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type OpenClawContext = {
  homeDir: string;
  stateDir: string;
  extensionsDir: string;
  configPath: string | null;
  config: Record<string, unknown> | null;
  outboxDir: string;
  outboxFile: string;
};

export function resolveHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.OPENCLAW_HOME?.trim();
  if (configured) {
    return configured;
  }
  return path.join(os.homedir(), ".openclaw");
}

export function resolveStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.OPENCLAW_STATE_DIR?.trim() || env.CLAWDBOT_STATE_DIR?.trim();
  if (configured) {
    return configured;
  }
  return path.join(resolveHomeDir(env), "state");
}

export function resolveExtensionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveHomeDir(env), "extensions");
}

export function resolveOutboxPaths(env: NodeJS.ProcessEnv = process.env): {
  outboxDir: string;
  outboxFile: string;
} {
  const outboxDir = path.join(resolveStateDir(env), "mixin");
  return {
    outboxDir,
    outboxFile: path.join(outboxDir, "mixin-outbox.json"),
  };
}

export function resolveMixpayStorePaths(env: NodeJS.ProcessEnv = process.env): {
  storeDir: string;
  storeFile: string;
} {
  const storeDir = path.join(resolveStateDir(env), "mixin");
  return {
    storeDir,
    storeFile: path.join(storeDir, "mixpay-orders.json"),
  };
}

export async function readConfig(env: NodeJS.ProcessEnv = process.env): Promise<{
  path: string | null;
  config: Record<string, unknown> | null;
}> {
  const explicit = env.OPENCLAW_CONFIG?.trim();
  const candidates = [
    explicit,
    path.join(resolveHomeDir(env), "openclaw.json"),
    path.join(process.cwd(), "openclaw.json"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, "utf8");
      return {
        path: candidate,
        config: parseLooseConfig(raw),
      };
    } catch {
      continue;
    }
  }

  return {
    path: null,
    config: null,
  };
}

function parseLooseConfig(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const relaxed = raw
      .replace(/^\uFEFF/, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(relaxed) as Record<string, unknown>;
  }
}

export async function buildContext(env: NodeJS.ProcessEnv = process.env): Promise<OpenClawContext> {
  const config = await readConfig(env);
  const outbox = resolveOutboxPaths(env);
  return {
    homeDir: resolveHomeDir(env),
    stateDir: resolveStateDir(env),
    extensionsDir: resolveExtensionsDir(env),
    configPath: config.path,
    config: config.config,
    outboxDir: outbox.outboxDir,
    outboxFile: outbox.outboxFile,
  };
}

export async function findMixinPluginDirs(extensionsDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(extensionsDir, { withFileTypes: true });
    const matched: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const dirPath = path.join(extensionsDir, entry.name);
      const openclawPluginPath = path.join(dirPath, "openclaw.plugin.json");
      const packageJsonPath = path.join(dirPath, "package.json");
      try {
        const pluginRaw = await fs.readFile(openclawPluginPath, "utf8");
        if (pluginRaw.includes("\"mixin\"")) {
          matched.push(dirPath);
          continue;
        }
      } catch {
      }
      try {
        const packageRaw = await fs.readFile(packageJsonPath, "utf8");
        if (packageRaw.includes("\"@invago/mixin\"") || packageRaw.includes("\"id\":\"mixin\"")) {
          matched.push(dirPath);
        }
      } catch {
      }
    }
    return matched;
  } catch {
    return [];
  }
}

export async function checkWritableDir(dirPath: string): Promise<boolean> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    const testPath = path.join(dirPath, `.write-test-${Date.now()}`);
    await fs.writeFile(testPath, "ok", "utf8");
    await fs.rm(testPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function runOpenClawInstall(spec: string): number {
  const result = spawnSync("openclaw", ["plugins", "install", spec], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return result.status ?? 1;
}

export function runFfprobeCheck(): boolean {
  const result = spawnSync(process.platform === "win32" ? "ffprobe.exe" : "ffprobe", ["-version"], {
    stdio: "ignore",
    shell: false,
  });
  return result.status === 0;
}

export function readMixinConfig(config: Record<string, unknown> | null): Record<string, unknown> | null {
  const channels = config?.channels;
  if (!channels || typeof channels !== "object") {
    return null;
  }
  const mixin = (channels as Record<string, unknown>).mixin;
  return mixin && typeof mixin === "object" ? (mixin as Record<string, unknown>) : null;
}

export function isPluginEnabled(config: Record<string, unknown> | null): boolean {
  const plugins = config?.plugins;
  if (!plugins || typeof plugins !== "object") {
    return false;
  }
  const allow = Array.isArray((plugins as Record<string, unknown>).allow)
    ? ((plugins as Record<string, unknown>).allow as unknown[]).map(String)
    : [];
  const entries = (plugins as Record<string, unknown>).entries;
  const mixinEntry = entries && typeof entries === "object"
    ? (entries as Record<string, unknown>).mixin
    : null;
  const enabled = mixinEntry && typeof mixinEntry === "object"
    ? (mixinEntry as Record<string, unknown>).enabled !== false
    : false;
  return allow.includes("mixin") && enabled;
}
