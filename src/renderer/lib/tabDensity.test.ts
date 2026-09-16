import { describe, expect, it } from 'vitest'
import {
  COMPACT_MIN_TAB_PX,
  ROOMY_MIN_TAB_PX,
  TAB_BASE_FURNITURE_PX,
  TAB_CARET_PX,
  TAB_NAME_MIN_PX,
  TAB_SSH_CHIP_PX,
  tabDensity
} from './tabDensity'

describe('tabDensity', () => {
  // The strip inner width a 1340px macOS window leaves 8 tabs, measured before the fix: 1114 minus
  // 16px of flare padding. Every number below is from that run or derived from its furniture.
  const STRIP_1340_MAC = 1114 - 16

  it('answers roomy until measured', () => {
    expect(tabDensity(null, 8)).toBe('roomy')
    expect(tabDensity(Number.NaN, 8)).toBe('roomy')
    expect(tabDensity(1000, 0)).toBe('roomy')
  })

  it('keeps everything while a tab can hold chip + caret + a readable name', () => {
    expect(ROOMY_MIN_TAB_PX).toBe(TAB_BASE_FURNITURE_PX + TAB_SSH_CHIP_PX + TAB_CARET_PX + TAB_NAME_MIN_PX)
    expect(tabDensity(ROOMY_MIN_TAB_PX * 4, 4)).toBe('roomy')
    // 4 projects at their 168px basis: what a typical window shows.
    expect(tabDensity(168 * 4, 4)).toBe('roomy')
  })

  it('drops the SSH chip first: the field report at 8 tabs in 1340px is compact, not tight', () => {
    // 1098 / 8 = 137px per tab — enough for caret + 60px of name, not for the chip as well.
    expect(tabDensity(STRIP_1340_MAC, 8)).toBe('compact')
    expect(tabDensity(ROOMY_MIN_TAB_PX * 8 - 8, 8)).toBe('compact')
  })

  it('hides the inactive caret only when the caret itself would squeeze the name', () => {
    // 1098 / 12 = 91.5px per tab: below the caret floor, above the bare floor.
    expect(tabDensity(STRIP_1340_MAC, 12)).toBe('tight')
    expect(tabDensity(COMPACT_MIN_TAB_PX * 12 - 12, 12)).toBe('tight')
    expect(tabDensity(COMPACT_MIN_TAB_PX * 12, 12)).toBe('compact')
  })

  it('never lets the name floor fall below the width of a short word', () => {
    // Below this the fade zone (18px) eats most of what is left; 24px was the reported bug.
    expect(TAB_NAME_MIN_PX).toBeGreaterThanOrEqual(56)
  })
})
