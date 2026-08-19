import { mkdtemp, readdir, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { useMultiFileAuthState } from '../../Utils/use-multi-file-auth-state'

/**
 * Regression cover for the failure that produced "failed to commit mutations" on a real
 * account: keys.set() received thousands of lid-mapping entries at once, the unbounded
 * Promise.all exhausted file descriptors, and writes truncated to zero bytes.
 */
describe('useMultiFileAuthState under a large batch', () => {
	let folder: string

	beforeEach(async () => {
		folder = await mkdtemp(join(tmpdir(), 'stian-auth-'))
	})

	afterEach(async () => {
		await rm(folder, { recursive: true, force: true })
	})

	it('writes a large lid-mapping batch without truncating any file', async () => {
		const { state } = await useMultiFileAuthState(folder)

		const COUNT = 3000
		const batch: Record<string, unknown> = {}
		for (let i = 0; i < COUNT; i++) {
			batch[`${100000000000000 + i}_reverse`] = `${200000000000000 + i}`
		}

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await state.keys.set({ 'lid-mapping': batch } as any)

		const files = (await readdir(folder)).filter(f => f.startsWith('lid-mapping-'))
		expect(files).toHaveLength(COUNT)

		// the original bug produced 0-byte files; assert none are empty
		const empties: string[] = []
		for (const f of files) {
			const content = await readFile(join(folder, f), 'utf-8')
			if (content.length === 0) {
				empties.push(f)
			}
		}

		expect(empties).toEqual([])
	}, 120_000)

	it('round-trips every value in a large batch', async () => {
		const { state } = await useMultiFileAuthState(folder)

		const ids = Array.from({ length: 500 }, (_, i) => `${900000000000000 + i}_reverse`)
		const batch: Record<string, unknown> = {}
		for (const [i, id] of ids.entries()) {
			batch[id] = `mapped-${i}`
		}

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await state.keys.set({ 'lid-mapping': batch } as any)

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const read = await state.keys.get('lid-mapping' as any, ids)

		expect(Object.keys(read)).toHaveLength(ids.length)
		expect(read[ids[0]!]).toBe('mapped-0')
		expect(read[ids[499]!]).toBe('mapped-499')
	}, 120_000)

	it('deletes entries when the value is null, without leaving empty files', async () => {
		const { state } = await useMultiFileAuthState(folder)

		const ids = Array.from({ length: 200 }, (_, i) => `${800000000000000 + i}`)
		const write: Record<string, unknown> = {}
		for (const id of ids) {
			write[id] = 'x'
		}

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await state.keys.set({ 'lid-mapping': write } as any)
		expect((await readdir(folder)).filter(f => f.startsWith('lid-mapping-'))).toHaveLength(200)

		const remove: Record<string, unknown> = {}
		for (const id of ids) {
			remove[id] = null
		}

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await state.keys.set({ 'lid-mapping': remove } as any)
		expect((await readdir(folder)).filter(f => f.startsWith('lid-mapping-'))).toHaveLength(0)
	}, 120_000)
})
