# Changelog

## 0.3.0

### Added

- **`sock.stianButtons` — interactive (native flow) button messages.** Upstream can encode the
  `interactiveMessage` proto, but it never attaches the binary nodes WhatsApp requires, so
  buttons sent through plain `sendMessage` are accepted by the server and render as nothing.
  This adds the `biz > interactive > native_flow` node chain that makes them display.

  ```ts
  await sock.stianButtons.send(jid, {
  	title: 'Order #1042',
  	text: 'Ready when you are.',
  	buttons: [
  		{ id: 'confirm', text: 'Confirm' },
  		{ id: 'cancel', text: 'Cancel' }
  	]
  })
  ```

  - `{ id, text }` is shorthand for a `quick_reply`.
  - Otherwise name the flow and pass `params` as an object; it's serialised into
    `buttonParamsJson` for you. A prebuilt `buttonParamsJson` string still wins if you pass one.
  - `quick_reply`, `single_select`, `cta_url`, `cta_copy` and `cta_call` are typed, being the
    names that reliably render for ordinary bots. Other names are accepted as strings but
    WhatsApp commonly ignores them outside official or business clients.
  - An optional header `image` is uploaded and attached as `header.imageMessage`.
  - Dedicated flows (`mpm`, `cta_catalog`, `send_location`, `call_permission_request`,
    `wa_payment_transaction_details`, `automated_greeting_message_view_catalog`) emit a
    `native_flow` node at `v=2` under their own name; everything else rides the generic
    `v=9`/`mixed` node. `review_and_pay` and `payment_info` flatten onto a `biz` node carrying
    `native_flow_name`.
  - `build()` returns the content without sending. An empty `buttons` array throws rather than
    sending a message that renders blank.

- **`botNode` option on `stianButtons.send`.** Attaches `{ tag: 'bot', attrs: { biz_bot: '1' } }`
  to the relay stanza for 1:1 chats. This appears to be what allows interactive flows to render
  in private chats, and also marks the message as coming from a business bot, which may be what
  surfaces a bot/AI label. Defaults to `true` for 1:1 and `false` for groups; the `bot` node is
  never sent to groups regardless. This default is the best reading of undocumented behaviour
  rather than a verified fact — the reference implementation documents this node both as
  automatic-and-required and as an opt-in AI flag. Set it explicitly to opt out.

- `StianButtons`, `normaliseButtons` and `buildButtonNodes` are exported for direct use, along
  with the `StianButton`, `StianButtonsContent`, `StianButtonsOptions`, `StianNativeFlowButton`,
  `StianQuickReplyButton`, `StianSelectRow` and `StianStableButtonName` types.

- 25 tests covering button normalisation, node construction per flow type, the `botNode` matrix,
  header and media handling, and a proto encode/decode round-trip.

## 0.2.2

### Fixed

- **The socket no longer announces itself online on every `creds.update`.** The handler sent a
  presence node whenever `creds.me?.name !== update.me?.name`, without checking that a name was
  present. Most creds updates carry no `me` at all — key rotation, prekey consumption, every
  decrypt — so the incoming name was `undefined` and the comparison was true almost every time.
  Since the binary encoder drops undefined attributes, the node went out as a bare `<presence/>`
  with no `type`, which the server reads as `available`. The account appeared permanently online,
  announced in the background, regardless of configuration.

  The decision now lives in `shouldAnnouncePushName()`, declared as a type predicate so the caller
  narrows without a non-null assertion. That `!` is what allowed the bug to typecheck; removing it
  means the compiler rejects the same mistake in future.

### Changed

- **Publishing a push name no longer changes availability.** Even with the guard above, a genuine
  name change — which happens once, just after login — still sent a typeless presence implying
  `available`, so a socket configured with `markOnlineOnConnect: false` got one online blip anyway.
  The node now states its type explicitly:

  ```ts
  attrs: { name, type: config.markOnlineOnConnect ? 'available' : 'unavailable' }
  ```

  `@` is also stripped from the name, matching what `sendPresenceUpdate` already does.

  If you relied on login implicitly marking you online while setting `markOnlineOnConnect: false`,
  that no longer happens. Call `sendPresenceUpdate('available')` yourself.

Both changes are to code that was byte-identical to upstream Baileys 7.0.0-rc14.

## 0.2.1

### Fixed

- **A malformed group participant event no longer aborts a whole notification batch.**
  `messageStubParameters` are usually JSON participant objects, but WhatsApp also sends bare JID
  strings. `params.map(a => JSON.parse(a))` threw
  `SyntaxError: Unexpected non-whitespace character after JSON at position 15`, which escaped
  `processMessage` and surfaced as `unexpected error in 'processing offline notification'`. Every
  event in that batch was lost, not just the malformed one, so group participant updates went
  missing. Parsing is now tolerant: JSON objects are used as-is, bare JIDs become
  `{ id, phoneNumber }` or `{ id, lid }`, and anything unrecognised is skipped at debug level.

### Changed

- Two log lines that fire during normal operation are no longer warnings:
  - `invalid mex newsletter notification content` → `debug`, renamed to
    `unhandled mex newsletter notification content`. Notifications such as
    `xwa2_notify_newsletter_milestone` are simply shapes the library does not model, not malformed
    input, and they fire on every channel milestone.
  - `Buffer timeout reached, auto-flushing` → `debug`. The safety flush is expected behaviour, so a
    healthy socket was logging warnings continuously.

  Both are still visible at `LOG_LEVEL=debug`.

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
