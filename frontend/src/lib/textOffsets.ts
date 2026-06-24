// Shared coordinate space for branch-anchored highlights.
//
// THE single source of truth for what "offset N" means in an assistant
// response. Both capture (message.tsx reply button) and render
// (message.tsx layout-effect mark pass) MUST go through this module so the
// numbers round-trip exactly.
//
// Definition of the coordinate space:
//   Concatenate `node.nodeValue` of every Text node under the container, in
//   document order (a depth-first / DOM pre-order walk). No whitespace
//   normalization, no trimming — raw text-node values. An offset is an index
//   into that flat string. A range [start, end) covers the characters
//   start..end-1.
//
// Because react-markdown renders the same immutable content deterministically,
// the walk produces the same flat string on capture and on every later render,
// so stored offsets stay valid across reloads.

/**
 * Collect every Text node under `container` in document order.
 * A plain TreeWalker keeps this identical between capture and render.
 */
export function collectTextNodes(container: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

/** The flat plain-text string for the container (the coordinate space). */
export function getPlainText(container: Node): string {
  let text = "";
  for (const node of collectTextNodes(container)) {
    text += node.nodeValue ?? "";
  }
  return text;
}

/**
 * Map a single (node, offsetWithinNode) boundary into the flat coordinate
 * space. `boundaryNode` may be a Text node (DOM Range default for text
 * selections) or an Element (when a Range boundary sits between children).
 * Returns null if the boundary is not inside the container.
 */
function boundaryToFlatOffset(
  container: Node,
  boundaryNode: Node,
  offsetWithinNode: number,
): number | null {
  const textNodes = collectTextNodes(container);

  // Fast path: boundary is itself a Text node we walked.
  if (boundaryNode.nodeType === Node.TEXT_NODE) {
    let acc = 0;
    for (const node of textNodes) {
      if (node === boundaryNode) {
        return acc + offsetWithinNode;
      }
      acc += node.nodeValue?.length ?? 0;
    }
    return null;
  }

  // Element boundary: offset is an index into childNodes. Everything in the
  // flat string up to (but not including) that child belongs before the
  // boundary. We find the first Text node at-or-after the boundary position
  // and return the accumulated length up to it.
  if (boundaryNode.nodeType === Node.ELEMENT_NODE) {
    const child = boundaryNode.childNodes[offsetWithinNode] ?? null;
    // The flat offset is the total length of all text nodes that appear
    // strictly before `child` in document order.
    let acc = 0;
    for (const node of textNodes) {
      if (child && isBeforeOrEqual(child, node)) {
        return acc;
      }
      acc += node.nodeValue?.length ?? 0;
    }
    // Boundary is past every text node -> end of string.
    return acc;
  }

  return null;
}

/** True if `a` precedes-or-equals `b` in document order. */
function isBeforeOrEqual(a: Node, b: Node): boolean {
  if (a === b) return true;
  const pos = a.compareDocumentPosition(b);
  // b is FOLLOWING a, or b is contained by a -> a comes first.
  return (
    (pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 ||
    (pos & Node.DOCUMENT_POSITION_CONTAINED_BY) !== 0
  );
}

export interface FlatRange {
  start: number;
  end: number;
}

/**
 * Convert a DOM Range (a text selection) into flat start/end offsets in the
 * container's coordinate space. Returns null when the selection is empty or
 * lands outside the container.
 */
export function rangeToFlatOffsets(
  container: Node,
  range: Range,
): FlatRange | null {
  if (!container.contains(range.startContainer)) return null;
  if (!container.contains(range.endContainer)) return null;

  const start = boundaryToFlatOffset(
    container,
    range.startContainer,
    range.startOffset,
  );
  const end = boundaryToFlatOffset(
    container,
    range.endContainer,
    range.endOffset,
  );

  if (start === null || end === null) return null;
  if (end <= start) return null;
  return { start, end };
}

export interface HighlightInput {
  id: string;
  branchConvoId: string;
  startOffset: number;
  endOffset: number;
  quote: string;
}

/**
 * One contiguous piece of a single Text node that should be wrapped in a
 * <mark>, together with which highlights cover it.
 */
export interface MarkSegment {
  node: Text;
  /** start offset within the Text node */
  nodeStart: number;
  /** end offset within the Text node */
  nodeEnd: number;
  /** coverage depth = number of highlights covering this segment */
  depth: number;
  /**
   * Covering highlights ordered by specificity: smallest range first, then
   * most-recently-created. segments[0] is the click target ("most specific").
   */
  covering: HighlightInput[];
}

/** Highlight range length, used for the smallest-range tie-break. */
function rangeLength(h: HighlightInput): number {
  return h.endOffset - h.startOffset;
}

/**
 * Order covering highlights for click routing: smallest range first
 * (most specific), tie-broken by most-recently-created (largest id ordering is
 * unreliable, so we rely on caller-provided order being creation order and use
 * a stable secondary index).
 */
function orderBySpecificity(
  covering: HighlightInput[],
  creationIndex: Map<string, number>,
): HighlightInput[] {
  return [...covering].sort((a, b) => {
    const lenDiff = rangeLength(a) - rangeLength(b);
    if (lenDiff !== 0) return lenDiff;
    // tie-break: most-recent first => higher creation index first
    return (creationIndex.get(b.id) ?? 0) - (creationIndex.get(a.id) ?? 0);
  });
}

/**
 * Core segment-sweep. Given the container and a message's highlights, produce
 * the list of Text-node sub-ranges to wrap, each annotated with coverage depth
 * and its specificity-ordered covering highlights.
 *
 * A highlight can cross element boundaries (paragraphs, code blocks). We sweep
 * per Text node and clip each highlight's [start,end) to the node's flat span,
 * then break the node into maximal sub-ranges of uniform coverage. This means a
 * single highlight yields one MarkSegment per Text node it touches — never an
 * assumption of a single span.
 */
export function computeMarkSegments(
  container: Node,
  highlights: HighlightInput[],
): MarkSegment[] {
  if (highlights.length === 0) return [];

  // creationIndex preserves the caller's order (load order == creation order
  // since the backend returns createdAt-ascending) for the most-recent
  // tie-break.
  const creationIndex = new Map<string, number>();
  highlights.forEach((h, i) => creationIndex.set(h.id, i));

  const textNodes = collectTextNodes(container);
  const segments: MarkSegment[] = [];

  let flatPos = 0;
  for (const node of textNodes) {
    const nodeLen = node.nodeValue?.length ?? 0;
    if (nodeLen === 0) continue;
    const nodeFlatStart = flatPos;
    const nodeFlatEnd = flatPos + nodeLen;
    flatPos = nodeFlatEnd;

    // Collect boundaries (in flat space) that fall inside this node.
    const boundarySet = new Set<number>([nodeFlatStart, nodeFlatEnd]);
    for (const h of highlights) {
      if (h.endOffset <= nodeFlatStart || h.startOffset >= nodeFlatEnd) {
        continue; // highlight doesn't touch this node
      }
      if (h.startOffset > nodeFlatStart) boundarySet.add(h.startOffset);
      if (h.endOffset < nodeFlatEnd) boundarySet.add(h.endOffset);
    }
    const boundaries = [...boundarySet].sort((a, b) => a - b);

    // Each consecutive boundary pair is a uniform-coverage sub-range.
    for (let i = 0; i < boundaries.length - 1; i++) {
      const segStart = boundaries[i];
      const segEnd = boundaries[i + 1];
      if (segEnd <= segStart) continue;
      const mid = (segStart + segEnd) / 2;

      const covering = highlights.filter(
        (h) => h.startOffset <= mid && mid <= h.endOffset,
      );
      if (covering.length === 0) continue; // uncovered gap — leave as-is

      segments.push({
        node,
        nodeStart: segStart - nodeFlatStart,
        nodeEnd: segEnd - nodeFlatStart,
        depth: covering.length,
        covering: orderBySpecificity(covering, creationIndex),
      });
    }
  }

  return segments;
}
