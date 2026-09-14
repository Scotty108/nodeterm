import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The animation gate is an ALL-OR-NOTHING fix, which is why it is enforced by scan rather than by
 * review.
 *
 * A running CSS animation obliges the compositor to produce a frame every vsync, and that cost is
 * paid once for the window, not once per animation. Measured on the Server Edition with a
 * 40-terminal canvas idling for 25 s under headless Chrome: 1.5 % total browser CPU with nothing
 * animating, 33 % with ONE node pulsing, 101 % with twenty, and 1.6 % with the same twenty paused.
 * The step is at the first animation. So a single `infinite` animation added later without the
 * gate does not make the feature 1/56th worse — it holds the frame loop open and takes the whole
 * win back, while every animation the gate DOES cover still looks correctly frozen, which is
 * exactly the kind of regression nobody notices by looking.
 *
 * Joining the gate means one of two things, and the allowlist below is for neither:
 *   - `animation-play-state: var(--nt-anim-state);` after the shorthand (the shorthand resets
 *     play-state, so it must come after), or
 *   - an explicit `:root[data-nt-window='idle']` rule that gives the element a static state.
 */

const STYLES = path.join(__dirname, 'styles.css')
const PLAY_STATE = 'animation-play-state: var(--nt-anim-state)'

/**
 * Animations that deliberately stay out of the shared play-state property because an idle-window
 * rule handles them by hand. Keyed by keyframe name, with the reason, so removing the hand-written
 * rule without removing the entry fails below.
 */
const STATIC_WHEN_IDLE: Record<string, string> = {
  'nt-unread-glow': 'rests at opacity 0; pausing could hide the "finished while you were away" glow',
  'nt-working-glow': 'held lit rather than frozen mid-cycle, alongside its two siblings',
  'nt-attention-glow': 'held lit rather than frozen mid-cycle, alongside its two siblings'
}

function readStyles(): string {
  // Normalized per the repo's line-endings rule: `.gitattributes` only applies on re-checkout, so
  // a tree cloned before it still has CRLF working files and every `\n` slice below would miss.
  return fs.readFileSync(STYLES, 'utf8').replace(/\r\n/g, '\n')
}

/** Every `animation:` shorthand in the file that runs forever, with its line number. */
function infiniteAnimationLines(css: string): { line: number; text: string }[] {
  return css
    .split('\n')
    .map((text, i) => ({ line: i + 1, text }))
    .filter((l) => l.text.includes('animation:') && /\binfinite\b/.test(l.text))
}

describe('idle-window animation gate', () => {
  const css = readStyles()

  it('defines the variable and the idle state that drive it', () => {
    expect(css).toContain('--nt-anim-state: running')
    expect(css).toMatch(/:root\[data-nt-window='idle'\]\s*\{\s*--nt-anim-state:\s*paused/)
  })

  it('finds the infinite animations at all (a passing scan over nothing proves nothing)', () => {
    expect(infiniteAnimationLines(css).length).toBeGreaterThan(20)
  })

  it('gates every infinite animation, or names it in the static-when-idle allowlist', () => {
    const lines = css.split('\n')
    const ungated: string[] = []

    for (const { line, text } of infiniteAnimationLines(css)) {
      const keyframe = Object.keys(STATIC_WHEN_IDLE).find((k) => text.includes(k))
      if (keyframe) continue

      // The property is either on the same line (single-line rule) or on the next non-blank one.
      const sameLine = text.includes(PLAY_STATE)
      const next = (lines[line] ?? '').trim()
      if (sameLine || next.startsWith(PLAY_STATE)) continue

      ungated.push(`styles.css:${line}  ${text.trim()}`)
    }

    expect(
      ungated,
      'These infinite animations keep the compositor producing frames while nobody is looking at\n' +
        'the window, which takes back the whole win of the gate (see the header of this file).\n' +
        `Add "${PLAY_STATE};" directly after the shorthand, or give the element an explicit\n` +
        "`:root[data-nt-window='idle']` rule and list its keyframe in STATIC_WHEN_IDLE.\n"
    ).toEqual([])
  })

  it('backs every static-when-idle entry with a real idle rule', () => {
    for (const [keyframe, reason] of Object.entries(STATIC_WHEN_IDLE)) {
      // The keyframe still has to exist, or the entry is stale and is silently excusing nothing.
      expect(css, `${keyframe} is allowlisted (${reason}) but has no @keyframes`).toContain(
        `@keyframes ${keyframe}`
      )
      // And the animation it drives must be turned off — not merely paused — while idle.
      const selector = css.match(
        new RegExp(`:root\\[data-nt-window='idle'\\][^{]*\\{[^}]*animation:\\s*none[^}]*\\}`, 'g')
      )
      expect(selector, `${keyframe} is allowlisted (${reason}) but nothing sets animation: none`)
        .not.toBeNull()
    }
  })

  it('never pauses the notch HUD, whose window is never focused', () => {
    // hud.css belongs to a separate always-on-top panel window that by design never takes focus,
    // so the shared gate would freeze it permanently rather than while nobody is looking.
    const hud = path.join(__dirname, 'hud', 'hud.css')
    if (!fs.existsSync(hud)) return
    expect(fs.readFileSync(hud, 'utf8')).not.toContain('--nt-anim-state')
  })
})

/**
 * The three per-node glows, under `prefers-reduced-motion`.
 *
 * The trap this pins is not "is there a rule" but "does the rule keep the STATE readable": each
 * glow's keyframe rests at its DIM end (`nt-unread-glow` at `opacity: 0`), so the idiomatic
 * `animation: none` on its own would leave the unread glow completely invisible and the other two
 * nearly so — a motion preference silently costing the user the status, not just the movement. A
 * reviewer reading the diff sees three plausible `animation: none` rules and no reason to suspect
 * it; only the base opacity three hundred lines up says otherwise.
 */
describe('reduced-motion glows stay readable', () => {
  const css = readStyles()

  const GLOWS = ['unread', 'working', 'attention'] as const

  /** The body of the `prefers-reduced-motion` block that holds the glow rules. */
  function reducedMotionGlowBlock(): string {
    const start = css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('nt-attention-glow'))
    expect(start, 'no reduced-motion block after the glow keyframes').toBeGreaterThan(-1)
    // The block ends at the first line that closes it at column 0.
    const end = css.indexOf('\n}\n', start)
    expect(end, 'reduced-motion block is not closed').toBeGreaterThan(start)
    return css.slice(start, end)
  }

  it.each(GLOWS)('stops the %s glow animating', (state) => {
    const body = reducedMotionGlowBlock()
    const rule = body.match(
      new RegExp(`\\.react-flow__node:has\\(\\.term-node\\.${state}\\)::after\\s*\\{([^}]*)\\}`)
    )
    expect(rule, `no reduced-motion rule for the ${state} glow`).not.toBeNull()
    expect(rule![1]).toMatch(/animation:\s*none/)
  })

  it.each(GLOWS)('leaves the %s glow VISIBLE rather than at its dim resting frame', (state) => {
    const body = reducedMotionGlowBlock()
    const rule = body.match(
      new RegExp(`\\.react-flow__node:has\\(\\.term-node\\.${state}\\)::after\\s*\\{([^}]*)\\}`)
    )!
    const opacity = rule[1].match(/opacity:\s*([0-9.]+)/)
    expect(
      opacity,
      `the ${state} glow's reduced-motion rule sets no opacity, so it falls back to the keyframe's ` +
        'dim rest value — for unread that is 0, i.e. the state disappears entirely'
    ).not.toBeNull()
    expect(Number(opacity![1])).toBeGreaterThan(0.5)
  })
})
