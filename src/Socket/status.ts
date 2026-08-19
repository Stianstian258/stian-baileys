import { randomBytes } from 'crypto'
import { proto } from '../../WAProto/index.js'
import type {
	AnyMessageContent,
	AnyRegularMessageContent,
	MessageRelayOptions,
	MiscMessageGenerationOptions,
	SocketConfig,
	StianGroupStatusContent,
	StianStatusToGroupsContent,
	WAMediaUploadFunction,
	WAMessage,
	WAMessageContent
} from '../Types'
import {
	delay,
	generateMessageID,
	generateWAMessage,
	generateWAMessageContent,
	generateWAMessageFromContent
} from '../Utils'
import { getUrlInfo } from '../Utils/link-preview'
import type { ILogger } from '../Utils/logger'
import { isJidGroup, isPnUser, jidNormalizedUser, STORIES_JID } from '../WABinary'
import { makeCommunitiesSocket } from './communities'

/** `protocolMessage.type` used by WhatsApp to point at a status/story. */
const STATUS_MENTION_PROTOCOL_TYPE = 25

/** delay between the individual status-mention notifications, to avoid tripping rate limits */
const MENTION_FANOUT_DELAY_MS = 2000

/** Mirrors upstream's private `assertColor`, so `#rrggbb` / `0xaarrggbb` both work. */
const assertColor = (color: string | number): number => {
	if (typeof color === 'number') {
		return color > 0 ? color : 0xffffffff + Number(color) + 1
	}

	let hex = color.trim().replace('#', '')
	if (hex.length <= 6) {
		hex = 'FF' + hex.padStart(6, '0')
	}

	return parseInt(hex, 16)
}

const randomHexColor = () =>
	'#' +
	Math.floor(Math.random() * 0xffffff)
		.toString(16)
		.padStart(6, '0')

/**
 * `true` when the value carries a `groupStatusMessage` key.
 *
 * Used to reject group-status content passed to `sendMessage()`, which is not a supported
 * route. Post group statuses through `sock.stianStatus` instead.
 */
export const isGroupStatusContent = (content: unknown): content is { groupStatusMessage: unknown } =>
	typeof content === 'object' &&
	content !== null &&
	'groupStatusMessage' in content &&
	!!(content as { groupStatusMessage?: unknown }).groupStatusMessage

type StianStatusDeps = {
	config: SocketConfig
	logger: ILogger
	relayMessage: (jid: string, message: proto.IMessage, options: MessageRelayOptions) => Promise<string>
	waUploadToServer: WAMediaUploadFunction
	groupMetadata: (jid: string) => Promise<{ participants: { id: string }[] }>
	getSelfJid: () => string
}

/**
 * Group statuses / stories.
 *
 * WhatsApp models a "group status" as a `groupStatusMessageV2` envelope wrapping an ordinary
 * message, relayed to the group JID. A status posted to `status@broadcast` can additionally
 * notify groups and contacts via `groupStatusMentionMessage` / `statusMentionMessage` pointers.
 */
export class StianStatus {
	private readonly deps: StianStatusDeps

	constructor(deps: StianStatusDeps) {
		this.deps = deps
	}

	/**
	 * Build the inner message for a group status envelope.
	 *
	 * NOTE: upstream attaches `messageContextInfo.messageSecret` to non-reaction messages via
	 * `shouldIncludeReportingToken`. That random secret is invalid inside
	 * `groupStatusMessageV2.message` — WhatsApp tries to verify against it, fails, and silently
	 * drops the media with no error. Strip it here.
	 */
	private async buildInnerMessage(content: StianGroupStatusContent): Promise<WAMessageContent> {
		const { config, logger, waUploadToServer } = this.deps

		// callers may hand us an already-generated message content
		if (typeof content === 'object' && content !== null && 'message' in content) {
			return (content as { message: WAMessageContent }).message
		}

		const innerMessage = await generateWAMessageContent(content, {
			upload: waUploadToServer,
			logger,
			mediaCache: config.mediaCache,
			options: config.options
		})

		if (innerMessage.messageContextInfo) {
			delete innerMessage.messageContextInfo
		}

		return innerMessage
	}

	/**
	 * Post a status/story visible to the members of a single group.
	 *
	 * @returns the relayed message ID
	 */
	async sendGroupStatus(
		groupJid: string,
		content: StianGroupStatusContent,
		options: MiscMessageGenerationOptions = {}
	): Promise<string> {
		const innerMessage = await this.buildInnerMessage(content)

		return this.deps.relayMessage(
			groupJid,
			{ groupStatusMessageV2: { message: innerMessage } },
			{
				...options,
				messageId: options.messageId || generateMessageID()
			}
		)
	}

	/**
	 * Post a status to `status@broadcast` and notify the given groups and/or contacts about it.
	 *
	 * Text statuses get a randomised font/colour scheme unless you supply one. Media statuses
	 * move `text` onto `caption`, matching how WhatsApp renders them.
	 *
	 * @returns the generated status message
	 */
	async sendStatusToGroups(content: StianStatusToGroupsContent, jids: string[] = []): Promise<WAMessage> {
		const { config, logger, relayMessage, waUploadToServer, groupMetadata, getSelfJid } = this.deps

		const userJid = getSelfJid()
		if (!userJid) {
			throw new Error('cannot send a status before the socket has authenticated')
		}

		const recipients = new Set<string>([userJid])
		for (const id of jids) {
			if (isJidGroup(id)) {
				try {
					const metadata = await groupMetadata(id)
					for (const participant of metadata.participants) {
						recipients.add(jidNormalizedUser(participant.id))
					}
				} catch (error) {
					logger.error({ jid: id, error }, 'failed to fetch group metadata for status fanout')
				}
			} else if (isPnUser(id)) {
				recipients.add(jidNormalizedUser(id))
			}
		}

		// Styling lives in the generation options rather than the content, so peel it off a copy.
		// The union-typed content makes property surgery awkward; a loose view is the pragmatic way.
		const draft = { ...content } as Record<string, unknown>
		const isAudio = !!draft.audio
		const isMedia = !!draft.image || !!draft.video || isAudio

		if (isMedia && !isAudio) {
			if (typeof draft.text === 'string') {
				draft.caption = draft.text
				delete draft.text
			}

			delete draft.ptt
		}

		if (isAudio) {
			delete draft.text
			delete draft.caption
		}

		delete draft.font
		delete draft.textColor
		delete draft.backgroundColor

		const font = !isMedia ? (content.font ?? Math.floor(Math.random() * 9)) : undefined
		const textColor = !isMedia ? (content.textColor ?? randomHexColor()) : undefined
		const backgroundColor = !isMedia || isAudio ? (content.backgroundColor ?? randomHexColor()) : undefined
		const ptt = isAudio ? (typeof content.ptt === 'boolean' ? content.ptt : true) : undefined

		const statusMessage = await generateWAMessage(
			STORIES_JID,
			{ ...(draft as unknown as AnyRegularMessageContent), ...(ptt === undefined ? {} : { ptt }) },
			{
				logger,
				userJid,
				getUrlInfo: text =>
					getUrlInfo(text, {
						thumbnailWidth: config.linkPreviewImageThumbnailWidth,
						fetchOpts: { timeout: 3_000, ...(config.options || {}) },
						logger,
						uploadImage: config.generateHighQualityLinkPreview ? waUploadToServer : undefined
					}),
				upload: waUploadToServer,
				mediaCache: config.mediaCache,
				options: config.options,
				font,
				backgroundColor
			}
		)

		// upstream applies backgroundArgb + font but has no textColor support; set it ourselves
		if (textColor && statusMessage.message?.extendedTextMessage) {
			statusMessage.message.extendedTextMessage.textArgb = assertColor(textColor)
		}

		await relayMessage(STORIES_JID, statusMessage.message!, {
			messageId: statusMessage.key.id!,
			statusJidList: Array.from(recipients),
			additionalNodes: [
				{
					tag: 'meta',
					attrs: {},
					content: [
						{
							tag: 'mentioned_users',
							attrs: {},
							content: jids.map(jid => ({ tag: 'to', attrs: { jid: jidNormalizedUser(jid) } }))
						}
					]
				}
			]
		})

		for (const id of jids) {
			try {
				await this.sendStatusMention(id, statusMessage)
				await delay(MENTION_FANOUT_DELAY_MS)
			} catch (error) {
				logger.error({ jid: id, error }, 'failed to send status mention')
			}
		}

		return statusMessage
	}

	/** Notify a single group or contact that they were mentioned in a status. */
	private async sendStatusMention(jid: string, statusMessage: WAMessage): Promise<void> {
		const normalizedJid = jidNormalizedUser(jid)
		const isPrivate = isPnUser(normalizedJid)
		const pointer: WAMessageContent = {
			[isPrivate ? 'statusMentionMessage' : 'groupStatusMentionMessage']: {
				message: {
					protocolMessage: {
						key: statusMessage.key,
						type: STATUS_MENTION_PROTOCOL_TYPE
					}
				}
			},
			messageContextInfo: {
				messageSecret: randomBytes(32)
			}
		}

		const mentionMessage = generateWAMessageFromContent(normalizedJid, pointer, {
			userJid: this.deps.getSelfJid()
		})

		await this.deps.relayMessage(normalizedJid, mentionMessage.message!, {
			messageId: mentionMessage.key.id!,
			additionalNodes: [
				{
					tag: 'meta',
					attrs: isPrivate ? { is_status_mention: 'true' } : { is_group_status_mention: 'true' }
				}
			]
		})
	}
}

/**
 * Thrown when group-status content is passed to `sendMessage()` instead of going through
 * `sock.stianStatus`.
 */
export class StianApiError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'StianApiError'
	}
}

/**
 * Final socket layer. Adds `sock.stianStatus`, the only supported entry point for group
 * statuses. `sendMessage()` keeps its exact upstream signature and behaviour for ordinary
 * messages, but rejects group-status content rather than handling it.
 */
export const makeStatusSocket = (config: SocketConfig) => {
	const sock = makeCommunitiesSocket(config)
	const { logger } = config

	const stianStatus = new StianStatus({
		config,
		logger,
		relayMessage: sock.relayMessage,
		waUploadToServer: sock.waUploadToServer,
		groupMetadata: sock.groupMetadata,
		getSelfJid: () => jidNormalizedUser(sock.authState.creds.me?.id)
	})

	/**
	 * Upstream `sendMessage`, with one guard: group statuses must be posted through
	 * `sock.stianStatus`, so passing `{ groupStatusMessage }` here fails loudly instead of
	 * silently relaying something WhatsApp will not render.
	 *
	 * The signature and return type are unchanged from upstream.
	 */
	const sendMessage = async (
		jid: string,
		content: AnyMessageContent,
		options: MiscMessageGenerationOptions = {}
	): Promise<WAMessage | undefined> => {
		if (isGroupStatusContent(content)) {
			throw new StianApiError(
				'group statuses cannot be sent with sendMessage(). Use sock.stianStatus instead:\n' +
					'  await sock.stianStatus.sendGroupStatus(groupJid, { text: "hello group" })\n' +
					'  await sock.stianStatus.sendStatusToGroups({ text: "hi all" }, [groupJid])'
			)
		}

		return sock.sendMessage(jid, content, options)
	}

	return {
		...sock,
		stianStatus,
		sendMessage
	}
}
