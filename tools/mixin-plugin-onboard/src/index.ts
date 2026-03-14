import { runDoctor } from "./commands/doctor.ts";
import { runInfo } from "./commands/info.ts";
import { runInstall } from "./commands/install.ts";
import { runUpdate } from "./commands/update.ts";

function printUsage(): void {
  console.log(`mixin-plugin-onboard <command>

Commands:
  info
  doctor
  install [npm-spec]
  update [npm-spec]
`);
}

async function main(): Promise<void> {
  const [, , command, arg] = process.argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    process.exitCode = 0;
    return;
  }

  if (command === "info") {
    process.exitCode = await runInfo();
    return;
  }

  if (command === "doctor") {
    process.exitCode = await runDoctor();
    return;
  }

  if (command === "install") {
    process.exitCode = await runInstall(arg);
    return;
  }

  if (command === "update") {
    process.exitCode = await runUpdate(arg);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

await main();
