import { runOpenClawInstall } from "../utils.ts";

export async function runUpdate(spec?: string): Promise<number> {
  return runOpenClawInstall(spec?.trim() || "@invago/mixin@latest");
}
