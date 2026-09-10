import type { BinaryNode } from '../../WABinary'
import { decodeBinaryNode, encodeBinaryNode } from '../../WABinary'
import { shouldAnnouncePushName } from '../../Utils/generics'

/**
 * Regression cover for the socket announcing itself online continuously.
 *
 * `creds.update` fired a presence node whenever `creds.me?.name !== update.me?.name`.
 * Most creds updates carry no `me`, so the incoming name was undefined and the comparison
 * was true almost every time. The encoder drops undefined attributes, so the node went out
 * as a bare `<presence/>` with no type — which reads as "available".
 */
describe('shouldAnnouncePushName', () => {
	it('does not announce when the update carries no name at all', () => {
		// the dominant case: key rotation, prekey consumption, every decrypt
		expect(shouldAnnouncePushName('Stian', undefined)).toBe(false)
		expect(shouldAnnouncePushName('Stian', null)).toBe(false)
		expect(shouldAnnouncePushName('Stian', '')).toBe(false)
	})

	it('does not announce when the name is unchanged', () => {
		expect(shouldAnnouncePushName('Stian', 'Stian')).toBe(false)
	})

	it('announces when a name arrives for the first time', () => {
		expect(shouldAnnouncePushName(undefined, 'Stian')).toBe(true)
		expect(shouldAnnouncePushName(null, 'Stian')).toBe(true)
	})

	it('announces when the name genuinely changes', () => {
		expect(shouldAnnouncePushName('Stian', 'Stian 2')).toBe(true)
	})

	it('never announces on an empty update, whatever the current name is', () => {
		for (const current of ['Stian', '', null, undefined]) {
			expect(shouldAnnouncePushName(current, undefined)).toBe(false)
		}
	})
})

describe('presence node encoding', () => {
	const roundTrip = async (node: BinaryNode) => decodeBinaryNode(Buffer.from(encodeBinaryNode(node)))

	it('drops an undefined name, which is how the bare <presence/> was produced', async () => {
		const decoded = await roundTrip({
			tag: 'presence',
			attrs: { name: undefined } as unknown as BinaryNode['attrs']
		})

		expect(decoded.tag).toBe('presence')
		// no attributes survive: on the wire this is a typeless presence
		expect(Object.keys(decoded.attrs)).toEqual([])
		expect(decoded.attrs.type).toBeUndefined()
	})

	it('keeps both attributes when a name and an explicit type are set', async () => {
		const decoded = await roundTrip({
			tag: 'presence',
			attrs: { name: 'Stian', type: 'unavailable' }
		})

		expect(decoded.attrs.name).toBe('Stian')
		expect(decoded.attrs.type).toBe('unavailable')
	})

	it('carries type=available through unchanged', async () => {
		const decoded = await roundTrip({
			tag: 'presence',
			attrs: { name: 'Stian', type: 'available' }
		})

		expect(decoded.attrs.type).toBe('available')
	})
})
