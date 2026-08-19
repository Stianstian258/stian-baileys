import { platform, release } from 'os'
import { proto } from '../../WAProto/index.js'
import type { BrowsersMap } from '../Types'

const PLATFORM_MAP = {
	aix: 'AIX',
	darwin: 'Mac OS',
	win32: 'Windows',
	android: 'Android',
	freebsd: 'FreeBSD',
	openbsd: 'OpenBSD',
	sunos: 'Solaris',
	linux: undefined,
	haiku: undefined,
	cygwin: undefined,
	netbsd: undefined
}

/**
 * Device name shown in WhatsApp's linked-devices list when using {@link Browsers.stian}.
 * This is the `DeviceProps.os` field, which WhatsApp renders as the device label.
 */
export const STIAN_DEVICE_NAME = 'Stian'

/** Version reported alongside {@link STIAN_DEVICE_NAME}. */
export const STIAN_DEVICE_VERSION = '1.0.0'

export const Browsers: BrowsersMap = {
	ubuntu: browser => ['Ubuntu', browser, '22.04.4'],
	macOS: browser => ['Mac OS', browser, '14.4.1'],
	baileys: browser => ['Baileys', browser, '6.5.0'],
	windows: browser => ['Windows', browser, '10.0.22631'],
	android: browser => [browser, 'Android', ''],
	/**
	 * stian-baileys branding: the linked device appears as "Stian" in WhatsApp.
	 *
	 * ```ts
	 * const sock = makeWASocket({ auth: state, browser: Browsers.stian() })
	 * ```
	 *
	 * Note: `syncFullHistory` only requests the full history when the OS field is `Mac OS` or
	 * `Windows` and the second field is `Desktop`. Using this branded identifier therefore
	 * trades full history sync for the custom device name — use {@link Browsers.macOS} with
	 * `'Desktop'` if you need the former.
	 */
	stian: (browser = 'Chrome') => [STIAN_DEVICE_NAME, browser, STIAN_DEVICE_VERSION],
	/** The appropriate browser based on your OS & release */
	appropriate: browser => [PLATFORM_MAP[platform()] || 'Ubuntu', browser, release()]
}

export const getPlatformId = (browser: string) => {
	const platformType =
		proto.DeviceProps.PlatformType[browser.toUpperCase() as keyof typeof proto.DeviceProps.PlatformType]
	return platformType ? platformType.toString() : '1' //chrome
}
