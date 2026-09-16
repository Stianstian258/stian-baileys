import { proto } from '../../../WAProto/index.js'
import { buildButtonNodes, normaliseButtons, StianButtons } from '../../Socket/buttons'
import type { MessageRelayOptions, SocketConfig } from '../../Types'
import type { BinaryNode } from '../../WABinary'

const SELF = '111111111@s.whatsapp.net'
const DM = '222222222@s.whatsapp.net'
const GROUP = '999999999999@g.us'

const silentLogger = {
	level: 'silent',
	child: () => silentLogger,
	trace: () => {},
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {}
}

type RelayCall = { jid: string; message: proto.IMessage; options: MessageRelayOptions }

const makeHarness = () => {
	const relayCalls: RelayCall[] = []
	const buttons = new StianButtons({
		config: { mediaCache: undefined, options: {} } as unknown as SocketConfig,
		logger: silentLogger,
		relayMessage: async (jid, message, options) => {
			relayCalls.push({ jid, message, options })
			return options.messageId || 'ID'
		},
		waUploadToServer: async () => ({ mediaUrl: 'https://example.invalid/m', directPath: '/m' }),
		getSelfJid: () => SELF
	})

	return { buttons, relayCalls }
}

const tags = (nodes: BinaryNode[] | undefined) => (nodes ?? []).map(n => n.tag)

const findNode = (nodes: BinaryNode[] | undefined, tag: string) => (nodes ?? []).find(n => n.tag === tag)

describe('normaliseButtons', () => {
	it('turns the { id, text } shorthand into a quick_reply', () => {
		const [b] = normaliseButtons([{ id: 'yes', text: 'Yes' }])
		expect(b?.name).toBe('quick_reply')
		expect(JSON.parse(b!.buttonParamsJson!)).toEqual({ display_text: 'Yes', id: 'yes' })
	})

	it('serialises params so callers never touch JSON.stringify', () => {
		const [b] = normaliseButtons([{ name: 'cta_url', params: { display_text: 'Docs', url: 'https://x.dev' } }])
		expect(b?.name).toBe('cta_url')
		expect(JSON.parse(b!.buttonParamsJson!)).toEqual({ display_text: 'Docs', url: 'https://x.dev' })
	})

	it('lets an explicit buttonParamsJson win over params', () => {
		const [b] = normaliseButtons([
			{ name: 'cta_copy', params: { ignored: true }, buttonParamsJson: '{"display_text":"Copy","copy_code":"A1"}' }
		])
		expect(JSON.parse(b!.buttonParamsJson!)).toEqual({ display_text: 'Copy', copy_code: 'A1' })
	})

	it('defaults params to an empty object rather than emitting undefined', () => {
		const [b] = normaliseButtons([{ name: 'send_location' }])
		expect(b!.buttonParamsJson).toBe('{}')
	})

	it('skips nameless and empty entries instead of producing junk buttons', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(normaliseButtons([null as any, undefined as any, { name: '' } as any])).toEqual([])
	})

	it('preserves order across mixed shapes', () => {
		const out = normaliseButtons([
			{ id: 'a', text: 'A' },
			{ name: 'cta_url', params: { url: 'u' } },
			{ id: 'b', text: 'B' }
		])
		expect(out.map(b => b.name)).toEqual(['quick_reply', 'cta_url', 'quick_reply'])
	})
})

describe('buildButtonNodes', () => {
	const q = normaliseButtons([{ id: 'a', text: 'A' }])

	it('wraps generic buttons in biz > interactive > native_flow v=9 mixed', () => {
		const [biz] = buildButtonNodes(q, { isGroup: true, botNode: false })
		expect(biz?.tag).toBe('biz')
		const interactive = (biz!.content as BinaryNode[])[0]!
		expect(interactive.tag).toBe('interactive')
		expect(interactive.attrs).toEqual({ type: 'native_flow', v: '1' })
		const flow = (interactive.content as BinaryNode[])[0]!
		expect(flow.tag).toBe('native_flow')
		expect(flow.attrs).toEqual({ v: '9', name: 'mixed' })
	})

	it('uses native_flow v=2 with the real name for dedicated flows', () => {
		const nodes = buildButtonNodes(normaliseButtons([{ name: 'cta_catalog' }]), { isGroup: true, botNode: false })
		const interactive = (nodes[0]!.content as BinaryNode[])[0]!
		const flow = (interactive.content as BinaryNode[])[0]!
		expect(flow.attrs).toEqual({ v: '2', name: 'cta_catalog' })
	})

	it('flattens review_and_pay onto biz native_flow_name=order_details', () => {
		const nodes = buildButtonNodes(normaliseButtons([{ name: 'review_and_pay' }]), { isGroup: true, botNode: false })
		expect(nodes[0]).toEqual({ tag: 'biz', attrs: { native_flow_name: 'order_details' } })
	})

	it('flattens payment_info the same way', () => {
		const nodes = buildButtonNodes(normaliseButtons([{ name: 'payment_info' }]), { isGroup: true, botNode: false })
		expect(nodes[0]).toEqual({ tag: 'biz', attrs: { native_flow_name: 'payment_info' } })
	})

	it('adds the bot node only for 1:1 chats when enabled', () => {
		expect(tags(buildButtonNodes(q, { isGroup: false, botNode: true }))).toEqual(['biz', 'bot'])
		expect(tags(buildButtonNodes(q, { isGroup: false, botNode: false }))).toEqual(['biz'])
		// never in groups, even if asked
		expect(tags(buildButtonNodes(q, { isGroup: true, botNode: true }))).toEqual(['biz'])
	})

	it('sets biz_bot=1 on the bot node', () => {
		const bot = findNode(buildButtonNodes(q, { isGroup: false, botNode: true }), 'bot')
		expect(bot?.attrs).toEqual({ biz_bot: '1' })
	})

	it('keys the flow off the first button when several are mixed', () => {
		const mixed = normaliseButtons([{ name: 'cta_catalog' }, { id: 'a', text: 'A' }])
		const interactive = (buildButtonNodes(mixed, { isGroup: true, botNode: false })[0]!.content as BinaryNode[])[0]!
		expect((interactive.content as BinaryNode[])[0]!.attrs.name).toBe('cta_catalog')
	})
})

describe('StianButtons.build', () => {
	it('puts text and footer in body and footer', async () => {
		const { buttons } = makeHarness()
		const content = await buttons.build({ text: 'Pick one', footer: 'Footer', buttons: [{ id: 'a', text: 'A' }] })
		expect(content.interactiveMessage?.body?.text).toBe('Pick one')
		expect(content.interactiveMessage?.footer?.text).toBe('Footer')
	})

	it('omits the header entirely when nothing header-ish is given', async () => {
		const { buttons } = makeHarness()
		const content = await buttons.build({ text: 'x', buttons: [{ id: 'a', text: 'A' }] })
		expect(content.interactiveMessage?.header).toBeFalsy()
	})

	it('builds a header with title and no media attachment', async () => {
		const { buttons } = makeHarness()
		const content = await buttons.build({ title: 'Header', buttons: [{ id: 'a', text: 'A' }] })
		expect(content.interactiveMessage?.header?.title).toBe('Header')
		expect(content.interactiveMessage?.header?.hasMediaAttachment).toBe(false)
	})

	it('attaches an uploaded image and flags the media attachment', async () => {
		const { buttons } = makeHarness()
		// a real 1x1 jpeg, so nothing has to be fetched over the network
		const jpeg = Buffer.from(
			'/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDc0NP/AABEIAAEAAQMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscHRFVLR4SMzUuFy8RVTk6OzwtLi8vX2/9oADAMBAAIRAxEAPwD3+iiigD//2Q==',
			'base64'
		)

		const content = await buttons.build({
			title: 'Look',
			image: jpeg,
			buttons: [{ id: 'a', text: 'A' }]
		})

		expect(content.interactiveMessage?.header?.hasMediaAttachment).toBe(true)
		expect(content.interactiveMessage?.header?.imageMessage).toBeTruthy()
		// sharp's first call in a cold process can take several seconds, well past jest's 5s default
	}, 30_000)

	it('refuses to build with no buttons', async () => {
		const { buttons } = makeHarness()
		await expect(buttons.build({ text: 'x', buttons: [] })).rejects.toThrow(/at least one button/)
	})
})

describe('StianButtons.send', () => {
	it('relays an interactiveMessage with the biz and bot nodes for a DM', async () => {
		const { buttons, relayCalls } = makeHarness()
		const msg = await buttons.send(DM, { text: 'hi', buttons: [{ id: 'a', text: 'A' }] })

		expect(relayCalls).toHaveLength(1)
		expect(relayCalls[0]!.jid).toBe(DM)
		expect(relayCalls[0]!.message.interactiveMessage?.nativeFlowMessage?.buttons).toHaveLength(1)
		expect(tags(relayCalls[0]!.options.additionalNodes)).toEqual(['biz', 'bot'])
		expect(msg.key.id).toBe(relayCalls[0]!.options.messageId)
	})

	it('omits the bot node in a group', async () => {
		const { buttons, relayCalls } = makeHarness()
		await buttons.send(GROUP, { text: 'hi', buttons: [{ id: 'a', text: 'A' }] })
		expect(tags(relayCalls[0]!.options.additionalNodes)).toEqual(['biz'])
	})

	it('honours botNode: false in a DM', async () => {
		const { buttons, relayCalls } = makeHarness()
		await buttons.send(DM, { text: 'hi', buttons: [{ id: 'a', text: 'A' }] }, { botNode: false })
		expect(tags(relayCalls[0]!.options.additionalNodes)).toEqual(['biz'])
	})

	it('honours botNode: true in a DM explicitly', async () => {
		const { buttons, relayCalls } = makeHarness()
		await buttons.send(DM, { text: 'hi', buttons: [{ id: 'a', text: 'A' }] }, { botNode: true })
		expect(tags(relayCalls[0]!.options.additionalNodes)).toEqual(['biz', 'bot'])
	})

	it('prepends caller-supplied additionalNodes before the generated ones', async () => {
		const { buttons, relayCalls } = makeHarness()
		await buttons.send(DM, { text: 'hi', buttons: [{ id: 'a', text: 'A' }] }, {
			additionalNodes: [{ tag: 'custom', attrs: { a: '1' } }]
		} as never)
		expect(tags(relayCalls[0]!.options.additionalNodes)).toEqual(['custom', 'biz', 'bot'])
	})

	it('throws before relaying when unauthenticated', async () => {
		const { buttons, relayCalls } = makeHarness()
		// @ts-expect-error replace the stub for this case
		buttons.deps.getSelfJid = () => ''
		await expect(buttons.send(DM, { text: 'x', buttons: [{ id: 'a', text: 'A' }] })).rejects.toThrow(/authenticated/)
		expect(relayCalls).toHaveLength(0)
	})

	it('survives an encode round-trip with the buttons intact', async () => {
		const { buttons, relayCalls } = makeHarness()
		await buttons.send(DM, {
			text: 'Pick',
			buttons: [
				{ id: 'a', text: 'A' },
				{ name: 'cta_url', params: { display_text: 'Docs', url: 'https://x.dev' } }
			]
		})

		const encoded = proto.Message.encode(relayCalls[0]!.message).finish()
		const decoded = proto.Message.decode(encoded)
		const out = decoded.interactiveMessage?.nativeFlowMessage?.buttons ?? []
		expect(out.map(b => b.name)).toEqual(['quick_reply', 'cta_url'])
		expect(JSON.parse(out[1]!.buttonParamsJson!).url).toBe('https://x.dev')
	})
})
