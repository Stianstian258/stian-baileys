# Changelog

## 0.2.0

### Breaking

- **Group statuses can no longer be sent with `sendMessage()`.** Passing
  `{ groupStatusMessage: ... }` now throws `StianApiError` naming the supported call, instead of
  being handled silently. Use `sock.stianStatus` instead:

  ```diff
  - await sock.sendMessage(groupJid, { groupStatusMessage: { text: 'hi' } })
  + await sock.stianStatus.sendGroupStatus(groupJid, { text: 'hi' })
  ```

  For ordinary messages `sendMessage()` is unchanged and matches upstream exactly, including its
  signature and return type.

### Fixed

- **Auth state no longer corrupts on large accounts.** `useMultiFileAuthState` fanned every key out
  through an unbounded `Promise.all`. Since Baileys 7 stores one LID mapping per contact, a single
  `keys.set()` could attempt thousands of concurrent writes, exhaust the file-descriptor limit and
  leave truncated zero-byte key files. The visible symptoms were repeating
  `failed to commit mutations, retries left=N` warnings and a socket that connected but could not
  decrypt messages. Writes are now capped at 32 concurrent operations.

  Measured over a 9,000-entry batch: unbounded produced `EMFILE` and 811 zero-byte files, bounded
  produced none and ran marginally faster.

- `failed to commit mutations` now logs the underlying error and affected key categories. Upstream
  logged only the message, making a failing auth store undiagnosable.

### Added

- **`Browsers.stian([browser])`** — reports the linked device as `Stian` in WhatsApp's Linked
  devices list. Opt-in; the default browser is unchanged. Note that `syncFullHistory` only requests
  full history when the OS field is `Mac OS`/`Windows` and the browser field is `Desktop`, so a
  custom device name and full history sync are mutually exclusive.

- `StianApiError` is exported from the package root so callers can catch it specifically.

- `isGroupStatusContent()` now accepts `unknown`, making it usable as a runtime guard.

### Internal

- Removed unused upstream tooling: `Example/`, `proto-extract/`, `scripts/`, `typedoc.json`, and an
  empty `.npmignore`, along with the `typedoc`, `typedoc-plugin-markdown` and `tsx` devDependencies.
- `.gitattributes` marks generated protobuf output as `linguist-generated` and `Media/` as vendored.
- `eslint.config.mts` gained a `files` pattern; without it, `eslint src` linted no TypeScript at all.

## 0.1.0

Initial release. Fork of Baileys 7.0.0-rc14 adding group statuses via `sock.stianStatus`, a scoped
libsignal console filter, a CommonJS entry point, and the `isJidUser` back-compat alias.
