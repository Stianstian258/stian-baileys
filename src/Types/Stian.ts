import type { AnyRegularMessageContent, MiscMessageGenerationOptions, WAMediaUpload } from './Message'

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

/**
 * Native flow button names WhatsApp is known to render for ordinary bots.
 *
 * The wider set (payments, catalogs, product lists) is accepted as a plain string, but
 * WhatsApp commonly ignores those outside official or business clients.
 */
export type StianStableButtonName = 'quick_reply' | 'single_select' | 'cta_url' | 'cta_copy' | 'cta_call'

/** A button in its explicit native-flow form. `params` is serialised for you. */
export type StianNativeFlowButton = {
	name: StianStableButtonName | (string & {})
	/** Serialised to `buttonParamsJson`. Forgetting to stringify is the usual mistake. */
	params?: Record<string, unknown>
	/** Escape hatch when you already hold a serialised payload. Wins over `params`. */
	buttonParamsJson?: string
}

/** Shorthand for the common case, normalised to a `quick_reply`. */
export type StianQuickReplyButton = {
	id: string
	text: string
}

export type StianButton = StianNativeFlowButton | StianQuickReplyButton

/** A row inside a `single_select` picker. */
export type StianSelectRow = {
	id: string
	title: string
	description?: string
	header?: string
}

export type StianButtonsContent = {
	/** Header title. */
	title?: string
	/** Header subtitle. */
	subtitle?: string
	/** Body text. */
	text?: string
	/** Footer text. */
	footer?: string
	/** Optional header image. Uploaded and attached as `header.imageMessage`. */
	image?: WAMediaUpload
	buttons: StianButton[]
}

export type StianButtonsOptions = MiscMessageGenerationOptions & {
	/**
	 * Attach `{ tag: 'bot', attrs: { biz_bot: '1' } }` to the relay stanza.
	 *
	 * Defaults to true for 1:1 chats and false for groups. This marks the message as coming
	 * from a business bot; it appears to be what lets interactive flows render in private
	 * chats, but it may also be what surfaces a bot/AI label on the message. Set it
	 * explicitly if you would rather not advertise that.
	 */
	botNode?: boolean
}
