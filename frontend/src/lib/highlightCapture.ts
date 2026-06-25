// v2 selection capture (mapping a DOM Range back into the anchor model).
//
// Replaces the v1 all-text-node walker (`lib/textOffsets.ts`). The DOM-side step
// (in MarkdownContent) reads the leaf-span `data-anchor-*` attributes the
// renderer stamped on each semantic leaf, turning a Range endpoint into a
// `CaptureEndpoint` { leafStart, leafEnd, kind, offsetInLeaf }. THIS module then
// does the coordinate math + atomic-math normalization PURELY, so it is fully
// node-testable without a real DOM.
//
// Plan items 3 & 4 (locked):
//   - Math is selectable ONLY as an atom: an endpoint inside math snaps to the
//     formula boundary (start -> before, end -> after). Wholly-math selections
//     capture the whole formula; prose<->math includes the whole formula.
//   - Code stays ordinary selectable text across Shiki token boundaries; exact
//     code whitespace/newlines are preserved (they live verbatim in the model).
//   - Reject only ranges empty AFTER normalization.

import type { LeafKind } from './anchorModel';

/** Stable data-attribute names the renderer stamps on every semantic leaf. */
export const ANCHOR_START_ATTR = 'data-anchor-start';
export const ANCHOR_END_ATTR = 'data-anchor-end';
export const ANCHOR_KIND_ATTR = 'data-anchor-kind';

/**
 * A Range endpoint resolved to the v2 leaf it falls in. `offsetInLeaf` is the
 * UTF-16 offset of the boundary within the leaf's value (0..leafLen). For math
 * leaves the offset is irrelevant (the leaf is one atomic U+FFFC unit) and is
 * normalized away below.
 */
export interface CaptureEndpoint {
  /** Canonical leaf start (inclusive). */
  leafStart: number;
  /** Canonical leaf end (exclusive). */
  leafEnd: number;
  kind: LeafKind;
  /** UTF-16 offset within the leaf value (clamped to [0, leafEnd-leafStart]). */
  offsetInLeaf: number;
}

export interface CaptureRange {
  start: number;
  end: number;
}

/**
 * Map a resolved (start, end) endpoint pair to normalized v2 coordinates,
 * applying atomic-math normalization. Returns null when the range is empty after
 * normalization (the only rejection condition).
 *
 * Swaps endpoints if the DOM handed them to us reversed (backwards selection).
 */
export function captureRangeFromEndpoints(
  startEndpoint: CaptureEndpoint,
  endEndpoint: CaptureEndpoint,
): CaptureRange | null {
  let start = normalizeStart(startEndpoint);
  let end = normalizeEnd(endEndpoint);

  if (end < start) {
    // Reversed selection: recompute with roles swapped so math snapping is
    // applied with the correct "before/after" semantics for each boundary.
    start = normalizeStart(endEndpoint);
    end = normalizeEnd(startEndpoint);
  }

  if (end <= start) return null;
  return { start, end };
}

/**
 * Normalize a START endpoint to a canonical offset. If it lands inside math,
 * snap to BEFORE the math atom (the leaf's canonical start).
 */
function normalizeStart(endpoint: CaptureEndpoint): number {
  if (endpoint.kind === 'math') return endpoint.leafStart;
  return endpoint.leafStart + clampOffset(endpoint);
}

/**
 * Normalize an END endpoint to a canonical offset. If it lands inside math,
 * snap to AFTER the math atom (the leaf's canonical end).
 */
function normalizeEnd(endpoint: CaptureEndpoint): number {
  if (endpoint.kind === 'math') return endpoint.leafEnd;
  return endpoint.leafStart + clampOffset(endpoint);
}

function clampOffset(endpoint: CaptureEndpoint): number {
  const leafLength = endpoint.leafEnd - endpoint.leafStart;
  if (endpoint.offsetInLeaf < 0) return 0;
  if (endpoint.offsetInLeaf > leafLength) return leafLength;
  return endpoint.offsetInLeaf;
}
