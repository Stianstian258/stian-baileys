import {
	isSignalNoise,
	isSignalNoiseSuppressed,
	LIBSIGNAL_NOISE_PATTERNS,
	suppressSignalNoise
} from '../../Utils/log-filter'

/** Real messages emitted by libsignal@6, taken from its source. */
const LIBSIGNAL_MESSAGES = [
	'WARNING: Expected pubkey of length 33, please report the ST and client that generated the pubkey',
	'Unhandled bucket type (for naming):',
	'Closing open session in favor of incoming prekey bundle',
	'Failed to decrypt message with any known session...',
	'Session error:Error: Bad MAC',
	'Decrypted message with closed session.',
	'V1 session storage migration error: registrationId',
	'Migrating session to:',
	'Session already closed',
	'Session already open',
	'Closing session:',
	'Opening session:',
	'Removing old closed session:'
]

/**
 * Application logs that merely mention session/decrypt/registration wording. A filter based on
 * loose substring matching would eat these; ours must not.
 */
const APPLICATION_MESSAGES = [
	'Session error while saving order #123',
	'User login failed to decrypt payload',
	'registrationId assigned to new customer',
	'Payment succeeded for invoice 42',
	'ERROR: database connection lost',
	'closing session for user dashboard',
	'libsignal upgrade scheduled for next release'
]

describe('isSignalNoise', () => {
	it('matches every libsignal console message', () => {
		for (const message of LIBSIGNAL_MESSAGES) {
			expect(isSignalNoise([message])).toBe(true)
		}
	})

	it('does not match application logs that merely share vocabulary', () => {
		for (const message of APPLICATION_MESSAGES) {
			expect(isSignalNoise([message])).toBe(false)
		}
	})

	it('ignores non-string first arguments', () => {
		expect(isSignalNoise([{ some: 'object' }])).toBe(false)
		expect(isSignalNoise([])).toBe(false)
	})

	it('only matches at the start, so noise cannot be smuggled mid-line', () => {
		expect(isSignalNoise(['order 5 failed: Closing session:'])).toBe(false)
	})

	it('exposes a pattern for each libsignal call site', () => {
		expect(LIBSIGNAL_NOISE_PATTERNS.length).toBeGreaterThanOrEqual(13)
	})
})

describe('suppressSignalNoise', () => {
	afterEach(() => {
		// make sure no test leaves console patched
		if (isSignalNoiseSuppressed()) {
			suppressSignalNoise()()
		}
	})

	it('suppresses libsignal noise but lets application logs through', () => {
		const seen: unknown[][] = []
		const originalWarn = console.warn
		console.warn = (...args: unknown[]) => seen.push(args)

		const restore = suppressSignalNoise()

		console.warn('Closing session:', { id: 1 })
		console.warn('Session error while saving order #123')

		restore()
		console.warn = originalWarn

		expect(seen).toHaveLength(1)
		expect(seen[0]![0]).toBe('Session error while saving order #123')
	})

	it('restores the original console methods', () => {
		const before = { info: console.info, warn: console.warn, error: console.error }

		const restore = suppressSignalNoise()
		expect(console.warn).not.toBe(before.warn)

		restore()

		expect(console.info).toBe(before.info)
		expect(console.warn).toBe(before.warn)
		expect(console.error).toBe(before.error)
	})

	it('never patches process.stdout or process.stderr', () => {
		const stdoutWrite = process.stdout.write
		const stderrWrite = process.stderr.write

		const restore = suppressSignalNoise()

		expect(process.stdout.write).toBe(stdoutWrite)
		expect(process.stderr.write).toBe(stderrWrite)

		restore()
	})

	it('leaves console.log alone, since libsignal does not use it', () => {
		const originalLog = console.log
		const restore = suppressSignalNoise()

		expect(console.log).toBe(originalLog)

		restore()
	})

	it('is idempotent and does not stack patches', () => {
		const restoreA = suppressSignalNoise()
		const patched = console.warn
		const restoreB = suppressSignalNoise()

		expect(console.warn).toBe(patched)
		expect(restoreB).toBe(restoreA)

		restoreA()
		expect(isSignalNoiseSuppressed()).toBe(false)
	})

	it('reports suppressed messages through onSuppressed', () => {
		const suppressed: string[] = []
		const restore = suppressSignalNoise({
			onSuppressed: (_method, args) => suppressed.push(String(args[0]))
		})

		console.warn('Closing session:')

		restore()

		expect(suppressed).toEqual(['Closing session:'])
	})

	it('accepts extra patterns, and can replace the built-ins', () => {
		const seen: unknown[][] = []
		const originalWarn = console.warn
		console.warn = (...args: unknown[]) => seen.push(args)

		const restore = suppressSignalNoise({ patterns: [/^my own noise/], replace: true })

		console.warn('my own noise here')
		console.warn('Closing session:') // no longer suppressed, built-ins were replaced

		restore()
		console.warn = originalWarn

		expect(seen).toHaveLength(1)
		expect(seen[0]![0]).toBe('Closing session:')
	})
})
