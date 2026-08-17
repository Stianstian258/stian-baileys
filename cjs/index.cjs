/**
 * CommonJS entry point for stian-baileys.
 *
 * The library itself is ESM (upstream Baileys 7.x is ESM-only, and two of its runtime
 * dependencies — `p-queue` and `whatsapp-rust-bridge` — publish no CommonJS build at all).
 * Rather than transpile, this shim leans on Node's native `require(esm)` support, which
 * landed in Node 20.19.0 and 22.12.0.
 *
 * That makes this a *synchronous* require returning the real module namespace — not a
 * Proxy that fills in later. If your Node is too old you get a clear error here instead
 * of an object that is mysteriously empty.
 */
'use strict'

const [major, minor] = process.versions.node.split('.').map(Number)
const supportsRequireEsm = major > 22 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19)

if (!supportsRequireEsm) {
	throw new Error(
		`stian-baileys: loading this package from CommonJS needs Node 20.19+ or 22.12+ ` +
			`(you are on ${process.versions.node}), because Node only supports require() of ES modules ` +
			`from those versions.\n\n` +
			`Either upgrade Node, or load the package from ESM instead:\n` +
			`  import makeWASocket from 'stian-baileys'\n\n` +
			`or with a dynamic import from CommonJS:\n` +
			`  const { default: makeWASocket } = await import('stian-baileys')\n`
	)
}

const mod = require('../lib/index.js')

// An ES module namespace object is sealed with non-writable properties, so copy the
// bindings onto a plain object rather than mutating (or re-exporting) the namespace.
const exported = { __esModule: true }

for (const key of Object.keys(mod)) {
	exported[key] = mod[key]
}

// Keep the default export reachable both ways, so that
// `require('stian-baileys').makeWASocket` and `require('stian-baileys').default` both work.
exported.default = mod.default
exported.makeWASocket = mod.makeWASocket || mod.default

module.exports = exported
