// DOM-side capture: turn a browser `Range` into v2 canonical coordinates by
// reading the `data-anchor-*` leaf-span metadata the renderer stamped (NOT by
// walking all text nodes — the v1 approach in textOffsets.ts). The coordinate
// math + atomic-math normalization live in the PURE `highlightCapture.ts`; this
// file only resolves Range boundaries to `CaptureEndpoint`s, then delegates.

import type { LeafKind } from './anchorModel';
import {
  ANCHOR_END_ATTR,
  ANCHOR_KIND_ATTR,
  ANCHOR_START_ATTR,
  captureRangeFromEndpoints,
  type CaptureEndpoint,
  type CaptureRange,
} from './highlightCapture';

const SEG_START_ATTR = 'data-anchor-seg-start';

/** Nearest ancestor element (inclusive) carrying leaf-span metadata. */
function closestAnchorEl(node: Node | null): HTMLElement | null {
  let el: Node | null = node;
  while (el && el.nodeType !== Node.ELEMENT_NODE) el = el.parentNode;
  if (!el) return null;
  return (el as HTMLElement).closest(`[${ANCHOR_START_ATTR}]`);
}

/**
 * Resolve a Range boundary `(node, offset)` to a CaptureEndpoint.
 *
 * For prose/code we compute the absolute canonical offset of the boundary from
 * the enclosing SEGMENT's `data-anchor-seg-start` plus the offset within that
 * segment's text, then express it relative to the leaf. For math the leaf bounds
 * are enough (the pure core normalizes to before/after the atom).
 */
function resolveEndpoint(
  container: HTMLElement,
  boundaryNode: Node,
  offset: number,
): CaptureEndpoint | null {
  const anchorEl = closestAnchorEl(boundaryNode);
  if (!anchorEl || !container.contains(anchorEl)) return null;

  const leafStart = Number(anchorEl.getAttribute(ANCHOR_START_ATTR));
  const leafEnd = Number(anchorEl.getAttribute(ANCHOR_END_ATTR));
  const kind = (anchorEl.getAttribute(ANCHOR_KIND_ATTR) ?? 'prose') as LeafKind;
  if (!Number.isFinite(leafStart) || !Number.isFinite(leafEnd)) return null;

  if (kind === 'math') {
    return { leafStart, leafEnd, kind, offsetInLeaf: 0 };
  }

  // Prose/code: the boundary's segment carries an absolute canonical seg-start.
  // The segment element is the anchorEl itself for plain/mark spans; for nested
  // Shiki tokens the seg metadata sits on the rewritten mark/span ancestor.
  const segEl =
    (boundaryNode.nodeType === Node.ELEMENT_NODE
      ? (boundaryNode as HTMLElement)
      : (boundaryNode.parentElement ?? anchorEl)
    ).closest(`[${SEG_START_ATTR}]`) ?? anchorEl;
  const segStartAttr = segEl.getAttribute(SEG_START_ATTR);
  const segStart =
    segStartAttr !== null ? Number(segStartAttr) : leafStart;

  // Offset within the segment's own text up to the boundary node+offset.
  const localInSeg = textOffsetWithin(segEl, boundaryNode, offset);
  const canonical = segStart + localInSeg;
  return {
    leafStart,
    leafEnd,
    kind,
    offsetInLeaf: canonical - leafStart,
  };
}

/**
 * Count UTF-16 units of text inside `root` that precede `(boundaryNode, offset)`
 * in document order. Used to locate a boundary within a segment that may contain
 * nested Shiki token spans.
 */
function textOffsetWithin(
  root: Element,
  boundaryNode: Node,
  offset: number,
): number {
  // Boundary directly on the segment element: offset indexes childNodes.
  if (boundaryNode.nodeType === Node.ELEMENT_NODE && boundaryNode === root) {
    let acc = 0;
    for (let i = 0; i < offset && i < root.childNodes.length; i++) {
      acc += root.childNodes[i].textContent?.length ?? 0;
    }
    return acc;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let current = walker.nextNode();
  while (current) {
    if (current === boundaryNode) return acc + offset;
    acc += current.nodeValue?.length ?? 0;
    current = walker.nextNode();
  }
  // Boundary not a descendant text node (e.g. element boundary inside root):
  // fall back to text length preceding it.
  return acc;
}

/**
 * Map a DOM Range to normalized v2 canonical coordinates. Returns null when the
 * range falls outside the container or is empty after math normalization.
 */
export function rangeToAnchorOffsets(
  container: HTMLElement,
  range: Range,
): CaptureRange | null {
  if (!container.contains(range.startContainer)) return null;
  if (!container.contains(range.endContainer)) return null;

  const startEp = resolveEndpoint(
    container,
    range.startContainer,
    range.startOffset,
  );
  const endEp = resolveEndpoint(container, range.endContainer, range.endOffset);
  if (!startEp || !endEp) return null;

  return captureRangeFromEndpoints(startEp, endEp);
}
