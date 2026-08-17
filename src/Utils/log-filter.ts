/**
 * Optional filter for the console noise emitted by the `libsignal` dependency.
 *
 * Baileys' own logger is pino-based and respects `logger.level`, so it needs no patching.
 * The chatter people actually complain about ("Closing session:", "Bad MAC", ...) comes from
 * `libsignal`, which writes straight to `console`. This module silences exactly those calls.
 *
 * Design constraints, learned from other forks that got this wrong:
 *   - `process.stdout` / `process.stderr` are never touched. Patching them swallows every
 *     write in the process, including your own application output.
 *   - patterns are anchored to the START of the first string argument, so an application log
 *     that merely happens to contain the word "session" is never dropped.
 *   - only the console methods libsignal actually uses are wrapped (`info`, `warn`, `error`).
 *   - returns a restore function that genuinely puts the originals back.
 */

/**
 * Anchored prefixes of every `console.*` message emitted by `libsignal@6`.
 * Derived from its source: `src/curve.js`, `src/queue_job.js`, `src/session_builder.js`,
 * `src/session_cipher.js`, `src/session_record.js`.
 */
export const LIBSIGNAL_NOISE_PATTERNS: readonly RegExp[] = [
	/^WARNING: Expected pubkey of length 33/,
	/^Unhandled bucket type \(for naming\):/,
	/^Closing open session in favor of incoming prekey bundle/,
	/^Closing stale open session for new outgoing prekey bundle/,
	/^Failed to decrypt message with any known session/,
	/^Session error:/,
	/^Decrypted message with closed session\./,
	/^V1 session storage migration error: registrationId/,
	/^Migrating session to:/,
	/^Session already closed/,
	/^Session already open/,
	/^Closing session:/,
	/^Opening session:/,
	/^Removing old closed session:/
]

/** Console methods libsignal writes to. */
const PATCHED_METHODS = ['info', 'warn', 'error'] as const

type PatchedMethod = (typeof PATCHED_METHODS)[number]

export type SuppressSignalNoiseOptions = {
	/**
	 * Extra anchored patterns to suppress, matched against the first argument.
	 * Merged with {@link LIBSIGNAL_NOISE_PATTERNS} unless `replace` is set.
	 */
	patterns?: readonly RegExp[]
	/** replace the built-in pattern list instead of extending it */
	replace?: boolean
	/** called with each suppressed message, e.g. to forward it to your own logger at trace level */
	onSuppressed?: (method: PatchedMethod, args: unknown[]) => void
}

/** `true` when `args` is a libsignal noise message that should be dropped. */
export const isSignalNoise = (args: unknown[], patterns: readonly RegExp[] = LIBSIGNAL_NOISE_PATTERNS): boolean => {
	const first = args[0]
	if (typeof first !== 'string') {
		return false
	}

	return patterns.some(pattern => pattern.test(first))
}

let activeRestore: (() => void) | undefined

/**
 * Silence libsignal's console noise.
 *
 * ```ts
 * import { suppressSignalNoise } from 'stian-baileys'
 *
 * const restore = suppressSignalNoise()
 * // ... later, if you want the noise back
 * restore()
 * ```
 *
 * Idempotent: calling it twice does not stack patches, and returns the same restore function.
 *
 * @returns a function that restores the original console methods
 */
export const suppressSignalNoise = (options: SuppressSignalNoiseOptions = {}): (() => void) => {
	if (activeRestore) {
		return activeRestore
	}

	const patterns = options.replace
		? (options.patterns ?? LIBSIGNAL_NOISE_PATTERNS)
		: [...LIBSIGNAL_NOISE_PATTERNS, ...(options.patterns ?? [])]

	const originals = {} as Record<PatchedMethod, (...args: unknown[]) => void>

	for (const method of PATCHED_METHODS) {
		// keep the original reference itself, un-bound, so restore() is an exact rollback
		const original = console[method] as (...args: unknown[]) => void
		originals[method] = original

		console[method] = (...args: unknown[]) => {
			if (isSignalNoise(args, patterns)) {
				options.onSuppressed?.(method, args)
				return
			}

			original.apply(console, args)
		}
	}

	activeRestore = () => {
		for (const method of PATCHED_METHODS) {
			console[method] = originals[method]
		}

		activeRestore = undefined
	}

	return activeRestore
}

/** `true` while {@link suppressSignalNoise} is active. */
export const isSignalNoiseSuppressed = () => !!activeRestore
