# Mixin Plugin Onboarding CLI

This CLI is bundled inside [`@invago/mixin`](https://www.npmjs.com/package/@invago/mixin). It helps inspect local OpenClaw installation state, verify key paths, and automate plugin install or update commands.

## Commands

### `info`

Prints the current local OpenClaw and Mixin plugin context:

- OpenClaw home, state, and extensions directories
- detected `openclaw.json` path
- detected Mixin plugin directories
- whether the plugin looks enabled in config
- current outbox path
- whether `ffprobe` is available

Run:

```bash
npx -y @invago/mixin info
```

### `doctor`

Runs a basic local diagnosis and returns a non-zero exit code when required checks fail.

Current checks:

- config file found
- `channels.mixin` present
- plugin enabled in config
- plugin installed in extensions
- outbox directory writable
- `ffprobe` available

It also reports leftover `.openclaw-install-stage-*` directories if any are detected.

Run:

```bash
npx -y @invago/mixin doctor
```

### `install`

Runs:

```bash
openclaw plugins install @invago/mixin
```

You can also pass a custom npm spec:

```bash
npx -y @invago/mixin install @invago/mixin@latest
```

### `update`

Runs:

```bash
openclaw plugins install @invago/mixin@latest
```

Run:

```bash
npx -y @invago/mixin update
```

## Local Development

From this repository:

```bash
node --import jiti/register.js tools/mixin-plugin-onboard/src/index.ts info
node --import jiti/register.js tools/mixin-plugin-onboard/src/index.ts doctor
```

Or from the tool directory:

```bash
cd tools/mixin-plugin-onboard
npm run info
npm run doctor
```

## Publish

This CLI is published together with the main `@invago/mixin` package from the repository root.

## Notes

- This CLI is intentionally read-mostly right now.
- `install` and `update` delegate to the local `openclaw` command.
- `doctor` currently treats missing `ffprobe` as a failed check because native outbound audio-as-voice depends on it.
