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

  const startEndpoint = resolveEndpoint(
    container,
    range.startContainer,
    range.startOffset,
  );
  const endEndpoint = resolveEndpoint(
    container,
    range.endContainer,
    range.endOffset,
  );
  if (!startEndpoint || !endEndpoint) return null;

  return captureRangeFromEndpoints(startEndpoint, endEndpoint);
}

/** Nearest ancestor element (inclusive) carrying leaf-span metadata. */
function closestAnchorElement(node: Node | null): HTMLElement | null {
  let element: Node | null = node;
  while (element && element.nodeType !== Node.ELEMENT_NODE)
    element = element.parentNode;
  if (!element) return null;
  return (element as HTMLElement).closest(`[${ANCHOR_START_ATTR}]`);
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
  const anchorElement = closestAnchorElement(boundaryNode);
  if (!anchorElement || !container.contains(anchorElement)) return null;

  const leafStart = Number(anchorElement.getAttribute(ANCHOR_START_ATTR));
  const leafEnd = Number(anchorElement.getAttribute(ANCHOR_END_ATTR));
  const kind = (anchorElement.getAttribute(ANCHOR_KIND_ATTR) ??
    'prose') as LeafKind;
  if (!Number.isFinite(leafStart) || !Number.isFinite(leafEnd)) return null;

  if (kind === 'math') {
    return { leafStart, leafEnd, kind, offsetInLeaf: 0 };
  }

  // Prose/code: the boundary's segment carries an absolute canonical seg-start.
  // The segment element is the anchorElement itself for plain/mark spans; for nested
  // Shiki tokens the seg metadata sits on the rewritten mark/span ancestor.
  const segmentElement =
    (boundaryNode.nodeType === Node.ELEMENT_NODE
      ? (boundaryNode as HTMLElement)
      : (boundaryNode.parentElement ?? anchorElement)
    ).closest(`[${SEG_START_ATTR}]`) ?? anchorElement;
  const segmentStartAttribute = segmentElement.getAttribute(SEG_START_ATTR);
  const segmentStart =
    segmentStartAttribute !== null ? Number(segmentStartAttribute) : leafStart;

  // Offset within the segment's own text up to the boundary node+offset.
  const offsetWithinSegment = textOffsetWithin(
    segmentElement,
    boundaryNode,
    offset,
  );
  const canonicalOffset = segmentStart + offsetWithinSegment;
  return {
    leafStart,
    leafEnd,
    kind,
    offsetInLeaf: canonicalOffset - leafStart,
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
    let accumulatedOffset = 0;
    for (
      let childIndex = 0;
      childIndex < offset && childIndex < root.childNodes.length;
      childIndex++
    ) {
      accumulatedOffset +=
        root.childNodes[childIndex].textContent?.length ?? 0;
    }
    return accumulatedOffset;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let accumulatedOffset = 0;
  let current = walker.nextNode();
  while (current) {
    if (current === boundaryNode) return accumulatedOffset + offset;
    accumulatedOffset += current.nodeValue?.length ?? 0;
    current = walker.nextNode();
  }
  // Boundary not a descendant text node (e.g. element boundary inside root):
  // fall back to text length preceding it.
  return accumulatedOffset;
}
