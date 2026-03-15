declare module "openclaw" {
  export function loadSessionStore(
    storePath: string,
    opts?: { skipCache?: boolean },
  ): Record<string, Record<string, unknown>>;

  export function saveSessionStore(
    storePath: string,
    store: Record<string, Record<string, unknown>>,
    opts?: { activeSessionKey?: string },
  ): Promise<void>;
}
