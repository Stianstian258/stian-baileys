import { proto } from '../../../WAProto/index.js'
import { WAMessageStubType } from '../../Types'
import processMessage from '../../Utils/process-message'

/**
 * Regression cover for the SyntaxError that aborted whole offline-notification batches.
 *
 * messageStubParameters are usually JSON participant objects, but WhatsApp also sends bare
 * JID strings. The original `params.map(a => JSON.parse(a))` threw
 * `Unexpected non-whitespace character after JSON at position 15`, which escaped
 * processMessage and dropped every event in the batch.
 */
const silentLogger = {
	level: 'silent',
	child: () => silentLogger,
	trace: () => {},
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {}
}

const ME = '111111111@s.whatsapp.net'
const GROUP = '999999999999@g.us'

const makeCtx = (events: { name: string; arg: unknown }[]) => ({
	shouldProcessHistoryMsg: false,
	placeholderResendCache: undefined,
	ev: {
		emit: (name: string, arg: unknown) => {
			events.push({ name, arg })
			return true
		},
		on: () => {},
		off: () => {},
		removeAllListeners: () => {}
	},
	creds: { me: { id: ME } },
	keyStore: {
		get: async () => ({}),
		set: async () => {},
		transaction: async (work: () => Promise<void>) => work()
	},
	logger: silentLogger,
	signalRepository: {
		lidMapping: {
			getLIDForPN: async () => undefined,
			getPNForLID: async () => undefined,
			storeLIDPNMappings: async () => {}
		}
	},
	options: {}
})

const stubMessage = (stubType: number, params: string[]) =>
	({
		key: { remoteJid: GROUP, fromMe: false, id: 'STUB1', participant: '222222222@s.whatsapp.net' },
		messageStubType: stubType,
		messageStubParameters: params,
		messageTimestamp: 1700000000
	}) as unknown as proto.IWebMessageInfo

const run = async (stubType: number, params: string[]) => {
	const events: { name: string; arg: unknown }[] = []
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await processMessage(stubMessage(stubType, params) as any, makeCtx(events) as any)
	return events
}

const participantsFrom = (events: { name: string; arg: unknown }[]) => {
	const ev = events.find(e => e.name === 'group-participants.update')
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (ev?.arg as any)?.participants as { id?: string; phoneNumber?: string; lid?: string }[] | undefined
}

describe('group participant stub parameters', () => {
	it('does not throw on a bare phone JID, the case that aborted batches', async () => {
		await expect(
			run(WAMessageStubType.GROUP_PARTICIPANT_ADD, ['123456789012345@s.whatsapp.net'])
		).resolves.toBeDefined()
	})

	it('maps a bare phone JID onto phoneNumber', async () => {
		const parts = participantsFrom(await run(WAMessageStubType.GROUP_PARTICIPANT_ADD, ['254705615631@s.whatsapp.net']))
		expect(parts).toHaveLength(1)
		expect(parts?.[0]?.id).toBe('254705615631@s.whatsapp.net')
		expect(parts?.[0]?.phoneNumber).toBe('254705615631@s.whatsapp.net')
	})

	it('maps a bare LID onto lid', async () => {
		const parts = participantsFrom(await run(WAMessageStubType.GROUP_PARTICIPANT_REMOVE, ['34355913191494@lid']))
		expect(parts).toHaveLength(1)
		expect(parts?.[0]?.lid).toBe('34355913191494@lid')
	})

	it('still accepts proper JSON participant objects', async () => {
		const json = JSON.stringify({ id: '5@s.whatsapp.net', phoneNumber: '5@s.whatsapp.net', lid: '6@lid' })
		const parts = participantsFrom(await run(WAMessageStubType.GROUP_PARTICIPANT_PROMOTE, [json]))
		expect(parts).toHaveLength(1)
		expect(parts?.[0]?.lid).toBe('6@lid')
	})

	it('handles a mixed batch without losing the valid entries', async () => {
		const json = JSON.stringify({ id: '7@s.whatsapp.net', phoneNumber: '7@s.whatsapp.net' })
		const parts = participantsFrom(
			await run(WAMessageStubType.GROUP_PARTICIPANT_ADD, [json, '888888888888@s.whatsapp.net', '99999@lid'])
		)
		expect(parts).toHaveLength(3)
	})

	it('drops values that are neither JSON nor a JID, rather than throwing', async () => {
		const parts = participantsFrom(await run(WAMessageStubType.GROUP_PARTICIPANT_ADD, ['120363411620682016', '']))
		expect(parts).toEqual([])
	})

	it('survives a null parameter list', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await expect(run(WAMessageStubType.GROUP_PARTICIPANT_ADD, null as any)).resolves.toBeDefined()
	})

	it('a numeric-looking JID does not get parsed as a number and dropped', async () => {
		// JSON.parse('123456789012345@s.whatsapp.net') throws at position 15 — the original bug
		const parts = participantsFrom(
			await run(WAMessageStubType.GROUP_PARTICIPANT_ADD, ['123456789012345@s.whatsapp.net'])
		)
		expect(parts?.[0]?.phoneNumber).toBe('123456789012345@s.whatsapp.net')
	})
})
