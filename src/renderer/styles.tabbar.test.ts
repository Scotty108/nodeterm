import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TABBAR_HEIGHT_PX } from '@shared/window-chrome-metrics'
import { TAB_NAME_MIN_PX } from './lib/tabDensity'

/**
 * The tab bar's height used to be a literal in four places — the bar's own rule, the kanban
 * overlay's `top`, the usage popover's cap and (in another process) the macOS traffic-light `y`.
 * Shrinking the bar to Chrome's proportions meant finding all of them by hand. Now there is one
 * token, one constant, and this file to keep the two equal and every dependant on the token.
 */
const CSS = readFileSync(join(__dirname, 'styles.css'), 'utf8').replace(/\r\n/g, '\n')

/** The value of a `--token:` declaration inside the dark `:root {` block. */
function token(name: string): string {
  const root = CSS.slice(CSS.indexOf(':root {'), CSS.search(/^:root\[data-theme='light'\]\s*\{/m))
  const m = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(root)
  if (!m) throw new Error(`${name} is not declared in :root`)
  return m[1].trim()
}

/**
 * The body of the rule whose selector is exactly `selector` — on its own, not as the last line of
 * a selector GROUP (`.tab,\n.tabbar__tabs {` is the no-drag list, not the strip's rule).
 */
function rule(selector: string): string {
  const re = new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'gm')
  for (const m of CSS.matchAll(re)) {
    const prev = CSS.lastIndexOf('\n', m.index - 1)
    const prevLine = CSS.slice(CSS.lastIndexOf('\n', prev - 1) + 1, prev).trim()
    if (prevLine.endsWith(',')) continue
    return CSS.slice(m.index, CSS.indexOf('}', m.index))
  }
  throw new Error(`no rule for ${selector}`)
}

describe('tab bar height', () => {
  it('is the shared constant main centres the traffic lights on', () => {
    expect(token('--tabbar-h')).toBe(`${TABBAR_HEIGHT_PX}px`)
  })

  it('is read through the token by the bar and by everything positioned against it', () => {
    expect(rule('.tabbar')).toMatch(/height:\s*var\(--tabbar-h\)/)
    expect(rule('.kanban-overlay')).toMatch(/top:\s*var\(--tabbar-h\)/)
    expect(rule('.usage-popover')).toMatch(/max-height:\s*calc\([^)]*var\(--tabbar-h\)/)
  })

  it('appears as a literal nowhere else — a second copy is the drift this token exists to end', () => {
    // Every `top:`/`height:`/`max-height:` whose value is the bar's own pixel height, outside the
    // token declaration itself. `.chat-node__attach-chip` is a 44px square that happened to share
    // the OLD height; a match here has to name the bar to count.
    const px = `${TABBAR_HEIGHT_PX}px`
    const offenders = CSS.split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => new RegExp(`^\\s*(top|height|max-height):\\s*${px};`).test(line))
      .filter(({ line }) => /tab ?bar/i.test(line))
    expect(offenders).toEqual([])
  })
})

describe('tab strip geometry', () => {
  it('lets the active tab reach the bar\'s bottom while the hover pill stays inset', () => {
    expect(rule('.tab')).toMatch(/margin:\s*var\(--tab-inset\)\s+0/)
    expect(rule('.tab.active')).toMatch(/margin-bottom:\s*0/)
    expect(rule('.tab.active')).toMatch(/background:\s*var\(--canvas-bg\)/)
  })

  it('draws the concave flares in the surface colour the tab merges into', () => {
    const flares = rule('.tab.active::after')
    expect(flares.match(/radial-gradient/g)).toHaveLength(2)
    expect(flares.match(/var\(--canvas-bg\)/g)).toHaveLength(2)
    // The strip must leave room for them, or the first/last tab's flare is clipped by the scroller.
    expect(rule('.tabbar__tabs')).toMatch(/padding:\s*0\s+var\(--tab-flare\)/)
  })

  it('shrinks every tab from one basis and fades the name instead of truncating it', () => {
    // A definite width, not a flex-basis: only a width enters the content-sized strip's intrinsic
    // size, so with a basis the tabs never widened past their floor however much room there was.
    expect(rule('.tab')).toMatch(/width:\s*var\(--tab-w\)/)
    expect(rule('.tab')).toMatch(/flex:\s*0 1 auto/)
    const name = rule('.tab__name')
    expect(name).toMatch(/mask-image:\s*linear-gradient/)
    expect(name).not.toMatch(/text-overflow/)
    // `width: 0` is what keeps the tab's automatic minimum from being the whole label.
    expect(name).toMatch(/width:\s*0;/)
  })

  it('keeps a readable name floor, the same number the density rule reasons from', () => {
    expect(token('--tab-name-min')).toBe(`${TAB_NAME_MIN_PX}px`)
    expect(rule('.tab__name')).toMatch(/min-width:\s*var\(--tab-name-min\)/)
    // The active tab's basis is wider by its board toggle, so its name shrinks in step with the
    // inactive names instead of absorbing the toggle (the 24px active name at 8 tabs).
    expect(rule('.tab.active')).toMatch(/width:\s*calc\(var\(--tab-w\) \+ var\(--tab-active-extra\)\)/)
  })

  it('sheds furniture by density before the name is squeezed, and never the active tab\'s buttons', () => {
    const compactChip = CSS.match(/\.tabbar__tabs\[data-density='compact'\] \.tab__ssh,\s*\.tabbar__tabs\[data-density='tight'\] \.tab__ssh \{[^}]*display:\s*none/)
    expect(compactChip).not.toBeNull()
    const tightCaret = CSS.match(/\.tabbar__tabs\[data-density='tight'\] \.tab:not\(\.active\):not\(:hover\):not\(\.tab--menu-open\) \.tab__actions \{[^}]*display:\s*none/)
    expect(tightCaret).not.toBeNull()
    // Nothing hides the board toggle at any density.
    expect(CSS).not.toMatch(/\[data-density[^\]]*\][^{]*\.tab__board-toggle[^{]*\{[^}]*display:\s*none/)
  })
})
