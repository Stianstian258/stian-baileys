import type { AnyRegularMessageContent, MiscMessageGenerationOptions } from './Message'

/**
 * Content for a status/story posted to a group's members.
 *
 * Accepts the same shapes as a regular message (text, image, video, audio, sticker, ...).
 */
export type StianGroupStatusContent = AnyRegularMessageContent

/**
 * The `{ groupStatusMessage: ... }` shape.
 *
 * Not accepted by `sendMessage()` — group statuses are posted through `sock.stianStatus`:
 *
 * ```ts
 * await sock.stianStatus.sendGroupStatus(groupJid, { text: 'hello group' })
 * ```
 */
export type StianGroupStatusMessageContent = {
	groupStatusMessage: StianGroupStatusContent
}

/** Styling options WhatsApp applies to text-only and audio statuses. */
export type StianStatusStyleOptions = {
	/** font index (0-8); randomised when omitted on a text status */
	font?: number
	/** hex colour, e.g. `#ff0044`; randomised when omitted on a text status */
	textColor?: string
	/** hex colour, e.g. `#001133`; randomised when omitted on a text or audio status */
	backgroundColor?: string
	/** send an audio status as a voice note; defaults to `true` for audio */
	ptt?: boolean
}

/** Content accepted by `stianStatus.sendStatusToGroups()`. */
export type StianStatusToGroupsContent = AnyRegularMessageContent & StianStatusStyleOptions

export type StianSendGroupStatusOptions = MiscMessageGenerationOptions
