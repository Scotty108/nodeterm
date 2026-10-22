import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { PATCH_MARKER, SIMD_FLAGS, VARIANT_TARGET, patchSmartWhisper } from '../../../scripts/patch-smart-whisper.mjs'
import { WHISPER_SIMD_FLAGS } from './speech-service'
import { testTmpDir } from '../test-tmp'

/**
 * scripts/patch-smart-whisper.mjs builds an AVX2 variant of whisper.cpp beside the baseline on
 * linux x64 and lets the loader pick per CPU (issue #1267). These tests run the patch over a pristine
 * fixture of the package and the patched loader against fake binaries; the first test asserts the
 * installed sources carry the patch, so an install that skipped it fails loudly.
 */
const PKG = path.resolve(__dirname, '../../../node_modules/smart-whisper')
const installed = fs.existsSync(path.join(PKG, 'binding.gyp'))
/** Pristine smart-whisper 0.8.1 binding.gyp + the loader lines of its dist/index.js (dist-index.js). */
const FIXTURE = path.resolve(__dirname, '__fixtures__/smart-whisper-0.8.1')

function copyPackage(): string {
  const dir = testTmpDir('sw-patch-')
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true })
  fs.copyFileSync(path.join(FIXTURE, 'binding.gyp'), path.join(dir, 'binding.gyp'))
  // Stored flat: the repo's .gitignore drops every dist/ directory.
  fs.copyFileSync(path.join(FIXTURE, 'dist-index.js'), path.join(dir, 'dist', 'index.js'))
  return dir
}

describe('patch-smart-whisper', () => {
  it.skipIf(!installed)('is applied to the installed smart-whisper', () => {
    const howto = 'node_modules is unpatched — run `npm run rebuild`.'
    expect(fs.readFileSync(path.join(PKG, 'binding.gyp'), 'utf8'), howto).toContain(PATCH_MARKER)
    expect(fs.readFileSync(path.join(PKG, 'dist', 'index.js'), 'utf8'), howto).toContain(PATCH_MARKER)
  })

  it('builds for exactly the CPU flags the runtime checks', () => {
    // A flag compiled in but not checked at load time is a SIGILL on the CPU that lacks it.
    expect(SIMD_FLAGS.map((f: string) => f.replace(/^-m/, '')).sort()).toEqual([...WHISPER_SIMD_FLAGS].sort())
  })

  it('adds a linux-x64-only variant target and is idempotent', () => {
    const dir = copyPackage()
    const pristine = fs.readFileSync(path.join(dir, 'binding.gyp'), 'utf8')
    expect(patchSmartWhisper(dir)).toBe('patched')
    const gyp = fs.readFileSync(path.join(dir, 'binding.gyp'), 'utf8')
    expect(gyp.startsWith(pristine.slice(0, pristine.lastIndexOf('  ],\n}')))).toBe(true)
    expect(gyp).toContain(`['OS=="linux" and target_arch=="x64"', {`)
    expect(gyp).toContain(`"target_name": "${VARIANT_TARGET}",`)
    expect(gyp).toContain("'cflags': [ '-mavx', '-mavx2', '-mfma', '-mf16c' ],")
    expect(patchSmartWhisper(dir)).toBe('already-patched')
    expect(fs.readFileSync(path.join(dir, 'binding.gyp'), 'utf8')).toBe(gyp)
  })

  it('refuses an anchor it cannot find instead of writing a half-patched package', () => {
    const dir = testTmpDir('sw-patch-bad-')
    fs.mkdirSync(path.join(dir, 'dist'))
    fs.writeFileSync(path.join(dir, 'binding.gyp'), '{}')
    fs.writeFileSync(path.join(dir, 'dist', 'index.js'), 'module.exports = {}')
    expect(() => patchSmartWhisper(dir)).toThrow(/anchor/)
  })

  describe('patched loader', () => {
    type G = { __NODETERM_WHISPER_BINARY__?: string; __NODETERM_WHISPER_LOADED__?: string }
    const g = globalThis as G

    /** A patched package whose "binaries" are JS stubs (require resolves .js before .node). */
    function fakePackage(variant: 'ok' | 'broken' | 'absent'): string {
      const dir = copyPackage()
      patchSmartWhisper(dir)
      const rel = path.join(dir, 'build', 'Release')
      fs.mkdirSync(rel, { recursive: true })
      fs.writeFileSync(path.join(rel, 'smart-whisper.js'), 'module.exports = { WhisperModel: class { which = "base" } }')
      if (variant !== 'absent') fs.writeFileSync(path.join(rel, `${VARIANT_TARGET}.node`), 'not a binary')
      if (variant === 'ok')
        fs.writeFileSync(path.join(rel, `${VARIANT_TARGET}.js`), 'module.exports = { WhisperModel: class { which = "avx2" } }')
      return dir
    }

    function load(dir: string, want: string | undefined): string | undefined {
      delete g.__NODETERM_WHISPER_LOADED__
      g.__NODETERM_WHISPER_BINARY__ = want
      try {
        const mod = createRequire(path.join(dir, 'dist', 'index.js'))('./index.js')
        return new mod.binding.WhisperModel().which
      } finally {
        delete g.__NODETERM_WHISPER_BINARY__
      }
    }

    it('loads the requested variant', () => {
      expect(load(fakePackage('ok'), VARIANT_TARGET)).toBe('avx2')
      expect(g.__NODETERM_WHISPER_LOADED__).toBe(VARIANT_TARGET)
    })

    it('falls back to the baseline when the variant is absent or fails to load', () => {
      expect(load(fakePackage('absent'), VARIANT_TARGET)).toBe('base')
      expect(load(fakePackage('broken'), VARIANT_TARGET)).toBe('base')
      expect(g.__NODETERM_WHISPER_LOADED__).toBe('smart-whisper')
    })

    it('ignores a missing or malformed request', () => {
      expect(load(fakePackage('ok'), undefined)).toBe('base')
      expect(load(fakePackage('ok'), '../../evil')).toBe('base')
    })
  })
})
