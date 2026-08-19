import { proto } from '../../../WAProto/index.js'
import { Browsers, getPlatformId, STIAN_DEVICE_NAME, STIAN_DEVICE_VERSION } from '../../Utils/browser-utils'

describe('Browsers.stian', () => {
	it('puts the branded name in the OS slot, which is what WhatsApp displays', () => {
		const [os, browser, version] = Browsers.stian()
		expect(os).toBe('Stian')
		expect(browser).toBe('Chrome')
		expect(version).toBe(STIAN_DEVICE_VERSION)
	})

	it('accepts an explicit browser while keeping the branded OS', () => {
		expect(Browsers.stian('Firefox')).toEqual([STIAN_DEVICE_NAME, 'Firefox', STIAN_DEVICE_VERSION])
		expect(Browsers.stian('Safari')[0]).toBe('Stian')
	})

	it('resolves to a valid platform type, so pairing is unaffected', () => {
		// unknown browser names fall back to CHROME (1) rather than failing
		expect(getPlatformId(Browsers.stian()[1])).toBe(proto.DeviceProps.PlatformType.CHROME.toString())
	})

	it('leaves the other browser identifiers untouched', () => {
		expect(Browsers.baileys('Chrome')[0]).toBe('Baileys')
		expect(Browsers.macOS('Desktop')[0]).toBe('Mac OS')
		expect(Browsers.windows('Desktop')[0]).toBe('Windows')
		expect(Browsers.ubuntu('Chrome')[0]).toBe('Ubuntu')
	})
})

describe('DeviceProps.os is the field carrying the device name', () => {
	it('round-trips "Stian" through the protobuf WhatsApp receives', () => {
		const [os, browserName, version] = Browsers.stian()

		const companion: proto.IDeviceProps = {
			os,
			platformType: proto.DeviceProps.PlatformType[browserName.toUpperCase() as 'CHROME'],
			version: {
				primary: Number(version.split('.')[0]),
				secondary: Number(version.split('.')[1]),
				tertiary: Number(version.split('.')[2])
			},
			requireFullSync: false
		}

		const encoded = proto.DeviceProps.encode(companion).finish()
		const decoded = proto.DeviceProps.decode(encoded)

		expect(decoded.os).toBe('Stian')
		expect(decoded.platformType).toBe(proto.DeviceProps.PlatformType.CHROME)
	})
})

describe('full history sync caveat is real and documented', () => {
	// getWebInfo only upgrades the sub-platform when os is Mac OS/Windows and browser is Desktop.
	const PLATFORM_MAP: Record<string, number> = {
		'Mac OS': proto.ClientPayload.WebInfo.WebSubPlatform.DARWIN,
		Windows: proto.ClientPayload.WebInfo.WebSubPlatform.WIN_HYBRID
	}

	const qualifiesForFullHistory = (browser: [string, string, string]) =>
		!!PLATFORM_MAP[browser[0]] && browser[1] === 'Desktop'

	it('Browsers.stian does not qualify for the desktop full-history path', () => {
		expect(qualifiesForFullHistory(Browsers.stian())).toBe(false)
		expect(qualifiesForFullHistory(Browsers.stian('Desktop'))).toBe(false)
	})

	it('Browsers.macOS("Desktop") does qualify, as the docs state', () => {
		expect(qualifiesForFullHistory(Browsers.macOS('Desktop'))).toBe(true)
		expect(qualifiesForFullHistory(Browsers.windows('Desktop'))).toBe(true)
	})
})
