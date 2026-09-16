import { proto } from '../../WAProto/index.js'
import type {
	MessageRelayOptions,
	SocketConfig,
	StianButton,
	StianButtonsContent,
	StianButtonsOptions,
	WAMediaUploadFunction,
	WAMessage,
	WAMessageContent
} from '../Types'
import { generateWAMessageContent, generateWAMessageFromContent } from '../Utils'
import type { ILogger } from '../Utils/logger'
import type { BinaryNode } from '../WABinary'
import { isJidGroup } from '../WABinary'

/**
 * Interactive (button) messages.
 *
 * Two things are needed beyond an ordinary send. The message must carry an
 * `interactiveMessage.nativeFlowMessage`, and the relay stanza must carry a `biz` node
 * describing the flow. Without the binary nodes WhatsApp accepts the message and renders
 * nothing, which is the usual reason buttons "silently don't work".
 */

/**
 * Flow names that need their own `native_flow` node at version 2 rather than the generic
 * mixed node. These are specialised and frequently ignored outside official clients.
 */
const DEDICATED_FLOW_NAMES = new Set([
	'mpm',
	'cta_catalog',
	'send_location',
	'call_permission_request',
	'wa_payment_transaction_details',
	'automated_greeting_message_view_catalog'
])

/** Flow names that map onto a flat `biz` node carrying `native_flow_name` directly. */
const FLAT_BIZ_FLOWS: Record<string, string> = {
	review_and_pay: 'order_details',
	payment_info: 'payment_info'
}

const isQuickReplyShorthand = (b: StianButton): b is { id: string; text: string } =>
	typeof (b as { id?: unknown }).id === 'string' && typeof (b as { text?: unknown }).text === 'string'

/** Normalises every accepted button shape into the wire form. */
export const normaliseButtons = (
	buttons: StianButton[]
): proto.Message.InteractiveMessage.NativeFlowMessage.INativeFlowButton[] => {
	const out: proto.Message.InteractiveMessage.NativeFlowMessage.INativeFlowButton[] = []

	for (const button of buttons || []) {
		if (!button) {
			continue
		}

		if (isQuickReplyShorthand(button)) {
			out.push({
				name: 'quick_reply',
				buttonParamsJson: JSON.stringify({ display_text: button.text, id: button.id })
			})
			continue
		}

		const { name, params, buttonParamsJson } = button
		if (!name) {
			continue
		}

		out.push({
			name,
			// an explicit json string wins, so callers holding a prebuilt payload are not blocked
			buttonParamsJson: buttonParamsJson ?? JSON.stringify(params ?? {})
		})
	}

	return out
}

/**
 * Builds the binary nodes that make WhatsApp render the flow.
 *
 * The shape is driven by the first button's name, matching what WhatsApp Web sends.
 */
export const buildButtonNodes = (
	buttons: proto.Message.InteractiveMessage.NativeFlowMessage.INativeFlowButton[],
	opts: { isGroup: boolean; botNode: boolean }
): BinaryNode[] => {
	const first = buttons[0]?.name ?? 'mixed'
	const nodes: BinaryNode[] = []

	const flatFlow = FLAT_BIZ_FLOWS[first]
	if (flatFlow) {
		nodes.push({ tag: 'biz', attrs: { native_flow_name: flatFlow } })
	} else {
		// dedicated flows announce themselves at v=2; everything else rides the generic v=9 node
		const inner: BinaryNode = DEDICATED_FLOW_NAMES.has(first)
			? { tag: 'native_flow', attrs: { v: '2', name: first } }
			: { tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }

		nodes.push({
			tag: 'biz',
			attrs: {},
			content: [{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [inner] }]
		})
	}

	// Only meaningful for 1:1 chats; groups need the biz node alone.
	if (botNodeApplies(opts)) {
		nodes.push({ tag: 'bot', attrs: { biz_bot: '1' } })
	}

	return nodes
}

const botNodeApplies = ({ isGroup, botNode }: { isGroup: boolean; botNode: boolean }) => !isGroup && botNode

type StianButtonsDeps = {
	config: SocketConfig
	logger: ILogger
	relayMessage: (jid: string, message: proto.IMessage, options: MessageRelayOptions) => Promise<string>
	waUploadToServer: WAMediaUploadFunction
	getSelfJid: () => string
}

export class StianButtons {
	private readonly deps: StianButtonsDeps

	constructor(deps: StianButtonsDeps) {
		this.deps = deps
	}

	/** Builds the interactive message content without sending it. Useful for inspection. */
	async build(content: StianButtonsContent): Promise<WAMessageContent> {
		const { config, logger, waUploadToServer } = this.deps
		const buttons = normaliseButtons(content.buttons)

		if (!buttons.length) {
			throw new Error('stianButtons: at least one button is required')
		}

		const header: proto.Message.InteractiveMessage.IHeader = {
			title: content.title,
			subtitle: content.subtitle,
			hasMediaAttachment: false
		}

		if (content.image) {
			const media = await generateWAMessageContent(
				{ image: content.image },
				{ upload: waUploadToServer, logger, mediaCache: config.mediaCache, options: config.options }
			)
			header.imageMessage = media.imageMessage
			header.hasMediaAttachment = true
		}

		return {
			interactiveMessage: {
				header: content.title || content.subtitle || content.image ? header : undefined,
				body: content.text ? { text: content.text } : undefined,
				footer: content.footer ? { text: content.footer } : undefined,
				nativeFlowMessage: { buttons, messageVersion: 1 }
			}
		}
	}

	/**
	 * Sends an interactive button message.
	 *
	 * @returns the generated message, matching what `sendMessage` resolves with
	 */
	async send(jid: string, content: StianButtonsContent, options: StianButtonsOptions = {}): Promise<WAMessage> {
		const { relayMessage, getSelfJid, logger } = this.deps
		const { botNode, additionalNodes, ...generationOptions } = options as StianButtonsOptions & {
			additionalNodes?: BinaryNode[]
		}

		const userJid = getSelfJid()
		if (!userJid) {
			throw new Error('stianButtons: cannot send before the socket has authenticated')
		}

		const messageContent = await this.build(content)
		const message = generateWAMessageFromContent(jid, messageContent, { userJid, ...generationOptions })

		const isGroup = !!isJidGroup(jid)
		const nodes = [
			...(additionalNodes ?? []),
			...buildButtonNodes(messageContent.interactiveMessage!.nativeFlowMessage!.buttons!, {
				isGroup,
				botNode: botNode ?? !isGroup
			})
		]

		logger.debug({ jid, isGroup, nodes: nodes.map(n => n.tag) }, 'sending interactive buttons')

		await relayMessage(jid, message.message!, {
			messageId: message.key.id!,
			additionalNodes: nodes
		})

		return message
	}
}
