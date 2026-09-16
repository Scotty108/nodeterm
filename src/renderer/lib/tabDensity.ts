/**
 * How much furniture a project tab may carry at the width the strip can give it.
 *
 * MEASURED, 8 projects in a 1340px macOS window (86px traffic-light reservation), on the first
 * Chrome-style strip: every tab got ~137px, and the pieces of an INACTIVE tab were
 *
 *   padding 10+4 · colour dot 9 · gap 6 · [SSH chip 30 · gap 6] · [badge 17 · gap 6] · caret 22+2
 *
 * so a plain tab kept 77px of name (9 readable characters), an SSH tab 41px (2–5), and the ACTIVE
 * tab — the one the user most needs to read — 24px (0 characters): it carries the board toggle as
 * well, hit its floor first, and the name absorbed the loss. At 12 tabs everything sat on the 83px
 * floor and every name was 24px. The name has to be the thing that survives, so this decides, per
 * strip, which furniture to shed BEFORE the name is squeezed — and the strip only starts scrolling
 * once a tab cannot hold `TAB_NAME_MIN_PX` of name with the furniture that is left.
 *
 * Three levels, each dropping one thing, cheapest first:
 *   roomy   — everything shown.
 *   compact — the SSH chip is hidden (the tab's tooltip still carries user@host).
 *   tight   — the options caret on INACTIVE tabs shows only on hover (and while its menu is open);
 *             the active tab keeps both its buttons at every width.
 *
 * One rule for the whole strip rather than per tab, so neighbours never disagree about which
 * furniture is on show. The thresholds are derived from the measured furniture, not chosen.
 */

/** Left/right padding + colour dot + the gap after it: what every tab carries. */
export const TAB_BASE_FURNITURE_PX = 10 + 4 + 9 + 6
/** The options caret (22px box) and the actions cluster's step from the name. */
export const TAB_CARET_PX = 22 + 2
/** The SSH chip plus its gap. */
export const TAB_SSH_CHIP_PX = 30 + 6
/** The least name a tab may show before the strip scrolls instead: ~6–7 characters at 12.5px. */
export const TAB_NAME_MIN_PX = 60

export type TabDensity = 'roomy' | 'compact' | 'tight'

/** A tab can show everything (chip and caret) and still keep a readable name at this width. */
export const ROOMY_MIN_TAB_PX = TAB_BASE_FURNITURE_PX + TAB_SSH_CHIP_PX + TAB_CARET_PX + TAB_NAME_MIN_PX
/** A tab can show the caret (no chip) and keep a readable name at this width. */
export const COMPACT_MIN_TAB_PX = TAB_BASE_FURNITURE_PX + TAB_CARET_PX + TAB_NAME_MIN_PX

/**
 * @param stripInnerWidth the strip's width minus its own padding, in CSS px; `null`/non-finite
 *   means "not measured yet", which answers `roomy` — the pre-density rendering.
 * @param tabCount how many tabs share it.
 */
export function tabDensity(stripInnerWidth: number | null, tabCount: number): TabDensity {
  if (stripInnerWidth == null || !Number.isFinite(stripInnerWidth) || tabCount <= 0) return 'roomy'
  const perTab = stripInnerWidth / tabCount
  if (perTab >= ROOMY_MIN_TAB_PX) return 'roomy'
  if (perTab >= COMPACT_MIN_TAB_PX) return 'compact'
  return 'tight'
}
