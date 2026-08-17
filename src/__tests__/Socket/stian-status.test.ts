import type { proto } from '../../../WAProto/index.js'
import { isGroupStatusContent, StianStatus } from '../../Socket/status'
import type { MessageRelayOptions, SocketConfig } from '../../Types'
import { generateWAMessageContent } from '../../Utils'

const SELF_JID = '111111111@s.whatsapp.net'
const GROUP_JID = '999999999999@g.us'
const CONTACT_JID = '222222222@s.whatsapp.net'

type RelayCall = { jid: string; message: proto.IMessage; options: MessageRelayOptions }

const silentLogger = {
	level: 'silent',
	child: () => silentLogger,
	trace: () => {},
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {}
}

const makeHarness = () => {
	const relayCalls: RelayCall[] = []

	const status = new StianStatus({
		config: { mediaCache: undefined, options: {} } as unknown as SocketConfig,
		logger: silentLogger,
		relayMessage: async (jid, message, options) => {
			relayCalls.push({ jid, message, options })
			return options.messageId || 'RELAYED-ID'
		},
		waUploadToServer: async () => ({ mediaUrl: 'https://example.invalid/m', directPath: '/m' }),
		groupMetadata: async () => ({
			participants: [{ id: CONTACT_JID }, { id: '333333333@s.whatsapp.net' }]
		}),
		getSelfJid: () => SELF_JID
	})

	return { status, relayCalls }
}

describe('isGroupStatusContent', () => {
	it('recognises the group status shape', () => {
		expect(isGroupStatusContent({ groupStatusMessage: { text: 'hi' } })).toBe(true)
	})

	it('rejects ordinary message content', () => {
		expect(isGroupStatusContent({ text: 'hi' })).toBe(false)
		expect(isGroupStatusContent({ image: { url: 'x' } })).toBe(false)
	})
})

describe('StianStatus.sendGroupStatus', () => {
	it('wraps the content in a groupStatusMessageV2 envelope addressed to the group', async () => {
		const { status, relayCalls } = makeHarness()

		const msgId = await status.sendGroupStatus(GROUP_JID, { text: 'hello group' })

		expect(relayCalls).toHaveLength(1)
		expect(relayCalls[0]!.jid).toBe(GROUP_JID)

		const inner = relayCalls[0]!.message.groupStatusMessageV2?.message
		expect(inner).toBeDefined()
		expect(inner?.extendedTextMessage?.text ?? inner?.conversation).toBe('hello group')
		expect(msgId).toBe(relayCalls[0]!.options.messageId)
	})

	it('honours a caller-supplied messageId', async () => {
		const { status, relayCalls } = makeHarness()

		await status.sendGroupStatus(GROUP_JID, { text: 'x' }, { messageId: 'MY-ID' })

		expect(relayCalls[0]!.options.messageId).toBe('MY-ID')
	})

	it('strips messageContextInfo, which silently breaks group status media', async () => {
		// positive control: upstream really does attach a random messageSecret here, so the
		// strip below is doing actual work rather than guarding against nothing.
		const untouched = await generateWAMessageContent(
			{ text: 'hello' },
			{ upload: async () => ({ mediaUrl: '', directPath: '' }) }
		)
		expect(untouched.messageContextInfo?.messageSecret).toBeTruthy()

		const { status, relayCalls } = makeHarness()

		await status.sendGroupStatus(GROUP_JID, { text: 'hello' })

		const inner = relayCalls[0]!.message.groupStatusMessageV2?.message
		// protobuf instances fall back to a null prototype default once the own property is gone
		expect(inner?.messageContextInfo).toBeFalsy()
	})
})

describe('StianStatus.sendStatusToGroups', () => {
	it('relays to status@broadcast, expands group members, then notifies each target', async () => {
		const { status, relayCalls } = makeHarness()

		const result = await status.sendStatusToGroups({ text: 'hi everyone' }, [GROUP_JID, CONTACT_JID])

		// 1 status broadcast + 1 group mention + 1 contact mention
		expect(relayCalls).toHaveLength(3)

		const broadcast = relayCalls[0]!
		expect(broadcast.jid).toBe('status@broadcast')

		// self + both group participants + the direct contact, de-duplicated
		expect(broadcast.options.statusJidList).toEqual(
			expect.arrayContaining([SELF_JID, CONTACT_JID, '333333333@s.whatsapp.net'])
		)
		expect(new Set(broadcast.options.statusJidList).size).toBe(broadcast.options.statusJidList!.length)

		const metaChildren = broadcast.options.additionalNodes?.[0]?.content as { tag: string; content: unknown }[]
		expect(metaChildren[0]!.tag).toBe('mentioned_users')
		const mentionedTo = metaChildren[0]!.content as { attrs: { jid: string } }[]
		expect(mentionedTo.map(n => n.attrs.jid)).toEqual([GROUP_JID, CONTACT_JID])

		// group target gets the group-flavoured pointer
		const groupMention = relayCalls[1]!
		expect(groupMention.jid).toBe(GROUP_JID)
		expect(groupMention.message.groupStatusMentionMessage).toBeDefined()
		expect(groupMention.options.additionalNodes?.[0]?.attrs).toEqual({ is_group_status_mention: 'true' })

		// contact target gets the 1:1 pointer
		const contactMention = relayCalls[2]!
		expect(contactMention.jid).toBe(CONTACT_JID)
		expect(contactMention.message.statusMentionMessage).toBeDefined()
		expect(contactMention.options.additionalNodes?.[0]?.attrs).toEqual({ is_status_mention: 'true' })

		expect(result.key.id).toBe(broadcast.options.messageId)
	}, 20_000)

	it('applies a random font and colours to a text status, and honours explicit ones', async () => {
		const { status, relayCalls } = makeHarness()

		await status.sendStatusToGroups({ text: 'styled', font: 3, textColor: '#ffffff', backgroundColor: '#000000' })

		const ext = relayCalls[0]!.message.extendedTextMessage
		expect(ext?.font).toBe(3)
		// #ffffff / #000000 become opaque ARGB, matching upstream's colour handling
		expect(ext?.textArgb).toBe(0xffffffff)
		expect(ext?.backgroundArgb).toBe(0xff000000)
	})

	it('does not leak styling keys into the message content', async () => {
		const { status, relayCalls } = makeHarness()

		await status.sendStatusToGroups({ text: 'clean', font: 2, textColor: '#123456' })

		const serialized = JSON.stringify(relayCalls[0]!.message)
		expect(serialized).not.toContain('textColor')
		expect(serialized).not.toContain('backgroundColor')
	})

	it('throws a clear error when the socket has no identity yet', async () => {
		const { status } = makeHarness()
		// @ts-expect-error deliberately override the stub for this case
		status.deps.getSelfJid = () => ''

		await expect(status.sendStatusToGroups({ text: 'x' })).rejects.toThrow(/authenticated/)
	})
})
