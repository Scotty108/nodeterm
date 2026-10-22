#!/usr/bin/env node
/**
 * patch-smart-whisper.mjs — gives Linux x64 a SIMD build of whisper.cpp (issue #1267).
 *
 * WHAT IT FIXES
 *   smart-whisper's binding.gyp compiles whisper.cpp/ggml with no -m flags, so on x86-64 the
 *   compiler targets the SSE2 baseline and every AVX/AVX2/FMA/F16C kernel in ggml is compiled out
 *   (`objdump -d smart-whisper.node | grep -c ymm` = 0 on the shipped Linux build). macOS arm64 is
 *   unaffected (NEON is baseline and Metal does the heavy lifting). Measured on a 12-thread AVX2
 *   machine, base model, 3 s of audio: 18.8 s as shipped vs 1.9 s with -mavx2 -mfma -mf16c — the
 *   report was large-v3-turbo taking ~7 minutes for one sentence.
 *
 *   A single -mavx2 build would SIGILL on CPUs without AVX2 (pre-Haswell, many Atom/Pentium
 *   parts), killing the whole app on the first dictation. So we build BOTH:
 *     - `smart-whisper.node`       — untouched baseline, loads everywhere
 *     - `smart-whisper-avx2.node`  — linux x64 only, -mavx -mavx2 -mfma -mf16c
 *   and choose at load time from the CPU's own flags (`pickWhisperBinary` in
 *   src/core/speech/speech-service.ts). The choice reaches smart-whisper's loader through
 *   `globalThis.__NODETERM_WHISPER_BINARY__`; the patched loader falls back to the baseline when
 *   the variant file is absent or fails to load, so a missing/broken variant degrades to the old
 *   speed, never to "dictation unavailable".
 *
 * PROPERTIES
 *   - Idempotent (PATCH_MARKER), and every anchor must match exactly once or the script exits
 *     non-zero — a smart-whisper upgrade that reshapes these files fails the install loudly.
 *   - Cross-platform safe: the extra target sits behind a gyp `OS=="linux" and target_arch=="x64"`
 *     condition, so mac/Windows builds are byte-for-byte what they were. The loader change is a
 *     no-op when nothing sets the global.
 *   - Runs before electron-rebuild in `postinstall` / `rebuild`, so the native build sees it.
 *
 * GUARD: src/core/speech/smart-whisper-patch.test.ts asserts the marker is present in the
 * installed sources. If it is red, your node_modules is unpatched — run `npm run rebuild`.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PATCH_MARKER = 'NODETERM-PATCH(smart-whisper-simd)'
export const VARIANT_TARGET = 'smart-whisper-avx2'
export const SIMD_FLAGS = ['-mavx', '-mavx2', '-mfma', '-mf16c']

const LOADER_FIND =
  'var module2 = require(import_node_path.default.join(__dirname, "../build/Release/smart-whisper"));'

const LOADER_REPLACE = `// ${PATCH_MARKER}: load the binary nodeterm picked for this CPU, falling back to the baseline.
var module2 = (() => {
  const base = import_node_path.default.join(__dirname, "../build/Release/smart-whisper");
  const want = globalThis.__NODETERM_WHISPER_BINARY__;
  if (typeof want === "string" && /^smart-whisper-[a-z0-9]+$/.test(want)) {
    const file = import_node_path.default.join(__dirname, "../build/Release", want);
    if (require("fs").existsSync(file + ".node")) {
      try {
        const m = require(file);
        globalThis.__NODETERM_WHISPER_LOADED__ = want;
        return m;
      } catch (err) {
        console.warn("[speech] " + want + " failed to load, using the baseline build:", err);
      }
    }
  }
  globalThis.__NODETERM_WHISPER_LOADED__ = "smart-whisper";
  return require(base);
})();`

const GYP_FIND = '    }\n  ],\n}'

/** Patches the smart-whisper package in `dir`. Returns 'patched' | 'already-patched'. */
export function patchSmartWhisper(dir) {
  const gypPath = path.join(dir, 'binding.gyp')
  const jsPath = path.join(dir, 'dist', 'index.js')
  const gyp = fs.readFileSync(gypPath, 'utf8')
  const js = fs.readFileSync(jsPath, 'utf8')
  const gypDone = gyp.includes(PATCH_MARKER)
  const jsDone = js.includes(PATCH_MARKER)
  if (gypDone && jsDone) return 'already-patched'

  if (!jsDone) {
    expectOnce(js, LOADER_FIND, 'dist/index.js binary require')
    fs.writeFileSync(jsPath, js.replace(LOADER_FIND, LOADER_REPLACE))
  }

  if (!gypDone) {
    const start = gyp.indexOf('    {\n      "target_name": "smart-whisper",')
    expectOnce(gyp, '"target_name": "smart-whisper",', 'binding.gyp target_name')
    expectOnce(gyp, GYP_FIND, 'binding.gyp end of targets')
    expectOnce(gyp, "      'cflags_cc!': [ '-fno-exceptions' ],\n", 'binding.gyp cflags_cc!')
    if (start < 0) fail('binding.gyp target block', 'not found')
    const end = gyp.indexOf(GYP_FIND)
    // The baseline target, copied verbatim so both binaries compile the same sources and defines.
    const target = gyp.slice(start, end + '    }'.length)
    const variant = target
      .replace('"target_name": "smart-whisper",', `"target_name": "${VARIANT_TARGET}",`)
      .replace(
        "      'cflags_cc!': [ '-fno-exceptions' ],\n",
        "      'cflags_cc!': [ '-fno-exceptions' ],\n" +
          `      'cflags': [ ${SIMD_FLAGS.map((f) => `'${f}'`).join(', ')} ],\n`
      )
      .replace(/^/gm, '    ')
    const conditions =
      `  # ${PATCH_MARKER}: an AVX2 build beside the baseline; the loader picks per CPU.\n` +
      `  'conditions': [\n` +
      `    ['OS=="linux" and target_arch=="x64"', {\n` +
      `      'targets': [\n${variant}\n      ],\n` +
      `    }],\n` +
      `  ],\n`
    fs.writeFileSync(gypPath, gyp.replace(GYP_FIND, `    }\n  ],\n${conditions}}`))
  }
  return 'patched'
}

function expectOnce(text, needle, name) {
  const n = text.split(needle).length - 1
  if (n !== 1) fail(name, `expected exactly 1 match, found ${n}`)
}

function fail(name, why) {
  throw new Error(
    `[patch-smart-whisper] anchor "${name}": ${why}. smart-whisper was probably upgraded — ` +
      're-derive the anchors in scripts/patch-smart-whisper.mjs (issue #1267).'
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const dir = path.join(repoRoot, 'node_modules', 'smart-whisper')
  if (!fs.existsSync(dir)) {
    console.log('[patch-smart-whisper] smart-whisper not installed; nothing to patch.')
  } else {
    try {
      console.log(`[patch-smart-whisper] ${patchSmartWhisper(dir)}`)
    } catch (err) {
      console.error(String(err instanceof Error ? err.message : err))
      process.exit(1)
    }
  }
}
