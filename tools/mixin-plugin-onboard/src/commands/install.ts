import { runOpenClawInstall } from "../utils.ts";

export async function runInstall(spec?: string): Promise<number> {
  return runOpenClawInstall(spec?.trim() || "@invago/mixin");
}
