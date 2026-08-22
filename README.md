# stian-baileys

A fork of [Baileys](https://github.com/WhiskeySockets/Baileys) (v7.0.0-rc14) that adds group
statuses, scoped log filtering, and a CommonJS entry point.

Everything else â€” the socket, the protocol, the types â€” is upstream Baileys, unmodified.

> **Disclaimer:** not affiliated with, authorized by, or connected to WhatsApp or Meta. Don't use
> it to spam people.

## What this fork adds

Six things. That's the whole list.

### 1. Group statuses / stories

Post a status visible to a group's members. `sock.stianStatus` is the only supported route:

```ts
// post a status to a single group's members
const msgId = await sock.stianStatus.sendGroupStatus(groupJid, { text: 'hello group' })

await sock.stianStatus.sendGroupStatus(groupJid, {
	image: { url: './photo.jpg' },
	caption: 'nice view'
})

// post to status@broadcast and notify several groups/contacts about it
const status = await sock.stianStatus.sendStatusToGroups({ text: 'hi everyone' }, [groupJid1, groupJid2, contactJid])
```

`sendMessage()` deliberately does **not** accept group-status content. Passing it throws a
`StianApiError` naming the correct API, rather than silently relaying something WhatsApp will not
render:

```ts
// throws StianApiError
await sock.sendMessage(groupJid, { groupStatusMessage: { text: 'hello group' } })
```

For ordinary messages `sendMessage()` is untouched and behaves exactly as upstream Baileys.

`sendStatusToGroups` randomises the font and colours for text statuses unless you set them:

```ts
await sock.stianStatus.sendStatusToGroups(
	{ text: 'styled', font: 3, textColor: '#ffffff', backgroundColor: '#075e54' },
	[groupJid]
)
```

Media statuses move `text` onto `caption` automatically, and audio statuses default to `ptt: true`.

### 2. Scoped libsignal log filtering

The `Closing session:` / `Bad MAC` / `Session error:` chatter does not come from Baileys â€” it comes
from the `libsignal` dependency writing straight to `console`. This filter silences exactly those
messages:

```ts
import { suppressSignalNoise } from 'stian-baileys'

const restore = suppressSignalNoise()
// ... and to undo it
restore()
```

Deliberate design choices, because this is the easiest thing in a fork to get wrong:

- `process.stdout` and `process.stderr` are **never** patched. Patching them silences every write
  in your process, including your own application logs.
- Patterns are **anchored to the start** of the first argument and derived from libsignal's actual
  source, so your own `"Session error while saving order #123"` is never swallowed.
- Only `console.info`, `console.warn` and `console.error` are wrapped â€” the three methods libsignal
  uses.
- You get a real `restore()` function back.

Want to see what's being dropped? Route it into your own logger:

```ts
suppressSignalNoise({
	onSuppressed: (method, args) => logger.trace({ method, args }, 'libsignal noise')
})
```

For Baileys' own logging, no patching is needed â€” it uses pino, so just set the level:

```ts
const sock = makeWASocket({ auth: state, logger: pino({ level: 'warn' }) })
```

### 3. CommonJS entry point

Upstream Baileys 7.x is ESM-only. This fork adds a `require()` entry:

```js
const { makeWASocket, useMultiFileAuthState } = require('stian-baileys')
```

It relies on Node's native `require(esm)`, so it needs **Node 20.19+ or 22.12+**. On older Node you
get an explicit error telling you to upgrade or use ESM, rather than a silently empty object.

Why not transpile a real CJS build? Because two runtime dependencies â€” `p-queue` and
`whatsapp-rust-bridge` â€” ship no CommonJS build at all, and `whatsapp-rust-bridge` is a native
binding used synchronously in the crypto path. Transpiling would produce something that throws
`ERR_REQUIRE_ESM` at runtime. ESM remains the primary, best-supported entry point.

### 4. Branded linked-device name

`Browsers.stian()` makes the session appear as **Stian** in WhatsApp's _Linked devices_ list,
instead of "Chrome (Mac OS)":

```ts
import makeWASocket, { Browsers } from 'stian-baileys'

const sock = makeWASocket({
	auth: state,
	browser: Browsers.stian() // defaults to Chrome
})

// or pick the browser yourself
makeWASocket({ auth: state, browser: Browsers.stian('Firefox') })
```

This works because the first element of the browser tuple becomes `DeviceProps.os`, which is the
field WhatsApp renders as the device label — the same mechanism behind the existing
`Browsers.baileys()`.

> **Tradeoff:** `syncFullHistory` only requests the full history when the OS field is `Mac OS` or
> `Windows` **and** the browser field is `Desktop`. A custom device name cannot satisfy that, so
> `Browsers.stian()` and full history sync are mutually exclusive. If you need the full history,
> use `Browsers.macOS('Desktop')` and forgo the branding.

It is opt-in — the default browser is unchanged, so existing bots behave exactly as before.

### 5. Auth state that survives large accounts

`useMultiFileAuthState` writes one file per key, and Baileys 7 stores a LID mapping per contact.
On a large account a single `keys.set()` call therefore tries to write thousands of files at once
through an unbounded `Promise.all`, which exhausts the process file-descriptor limit. The symptom
is a loop of `failed to commit mutations, retries left=N`, truncated zero-byte key files, and a bot
that connects but cannot decrypt messages.

Measured on a 9,000-entry batch:

|                      | result                                             |
| -------------------- | -------------------------------------------------- |
| unbounded (upstream) | `EMFILE`, **811 zero-byte files**                  |
| bounded to 32 (here) | no error, **0 zero-byte files**, marginally faster |

Writes now go through a concurrency-capped queue, so throughput is unchanged and nothing truncates.

The `failed to commit mutations` warning also now includes the underlying error and the affected
key categories. Upstream logged only the message, which made a failing auth store impossible to
diagnose from the outside.

Nothing to configure — this is just how the auth store behaves here.

### 6. `isJidUser` back-compat alias

Baileys 6.x had `isJidUser`; 7.x renamed it to `isPnUser`. The old name is re-exported as a
deprecated alias so 6.x-era code keeps working.

## Install

```bash
npm install stian-baileys
```

Requires Node 20+ (Node 20.19+ or 22.12+ if you're loading it from CommonJS).

## Versioning

This package is `0.x` on purpose. It tracks upstream Baileys **7.0.0-rc14**, a release candidate,
so the API underneath it can still change. Per semver, `0.x` means the public API is not yet
declared stable, and breaking changes land in the **minor** slot — `0.1.0` → `0.2.0`, not `2.0.0`.

Pin accordingly if you need stability:

```bash
npm install stian-baileys@~0.1.0   # patch updates only
```

Once upstream ships 7.0.0 final and this API settles, it moves to `1.0.0` and normal semver
guarantees apply from there.

## Usage

Identical to upstream Baileys â€” see the
[Baileys documentation](https://github.com/WhiskeySockets/Baileys). Only the four additions above
differ.

```ts
import makeWASocket, { useMultiFileAuthState, suppressSignalNoise } from 'stian-baileys'

suppressSignalNoise()

const { state, saveCreds } = await useMultiFileAuthState('./auth')
const sock = makeWASocket({ auth: state })

sock.ev.on('creds.update', saveCreds)
```

## Relationship to upstream

Kept deliberately thin so upstream releases are easy to absorb. Ten upstream files are touched, by
67 added and 6 removed lines:

| Upstream file                            | Delta  | Change                                                        |
| ---------------------------------------- | ------ | ------------------------------------------------------------- |
| `src/Utils/browser-utils.ts`             | +24 −1 | the `Browsers.stian` identifier, plus an `as any` type fix    |
| `src/Utils/use-multi-file-auth-state.ts` | +18 −1 | bounded write concurrency                                     |
| `src/WABinary/jid-utils.ts`              | +5     | the `isJidUser` alias and its doc comment                     |
| `src/Socket/messages-send.ts`            | +4     | one `getMediaType` branch to resolve group-status inner media |
| `eslint.config.mts`                      | +4     | add a `files` pattern so linting TypeScript actually runs     |
| `src/Utils/auth-utils.ts`                | +3 −1  | log the cause when committing auth mutations fails            |
| `src/index.ts`                           | +3     | re-export the status layer                                    |
| `src/Types/index.ts`                     | +3     | re-export `./Stian`, add `stian` to `BrowsersMap`             |
| `src/Socket/index.ts`                    | +2 −2  | use `makeStatusSocket` as the outermost socket layer          |
| `src/Utils/index.ts`                     | +1     | re-export `./log-filter`                                      |

Everything else is purely additive:

| New file                                             | Purpose                       |
| ---------------------------------------------------- | ----------------------------- |
| `src/Socket/status.ts`                               | the group status socket layer |
| `src/Types/Stian.ts`                                 | public types for the above    |
| `src/Utils/log-filter.ts`                            | the libsignal console filter  |
| `src/__tests__/Socket/stian-status.test.ts`          | 12 tests                      |
| `src/__tests__/Utils/log-filter.test.ts`             | 12 tests                      |
| `src/__tests__/Utils/auth-state-concurrency.test.ts` | 3 tests                       |
| `src/__tests__/Utils/stian-browser.test.ts`          | 7 tests                       |
| `cjs/index.cjs`                                      | CommonJS entry point          |

To pull in a new upstream release:

```bash
git fetch upstream
git merge upstream/master
```

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit, must be clean
npm run build       # emits lib/ with .js + .d.ts
npm run test:cjs    # verifies the CommonJS entry
npm run verify      # all of the above
```

`lib/` is **never** hand-edited â€” it is always generated from `src/`.
That's what keeps the types, the sourcemaps, and the ability to rebase.

## Credits

Built on [Baileys](https://github.com/WhiskeySockets/Baileys) by Rajeh Taher and the WhiskeySockets
contributors, MIT licensed.

Licensed under MIT. See [LICENSE](./LICENSE).
