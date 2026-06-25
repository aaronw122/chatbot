// Declarative v2 highlight projection (PURE, DOM-free, node-testable).
//
// This module is the §3 "one segment sweep over canonical spans before commit".
// It intersects persisted v2 ranges with an `AnchorModel`'s leaves and emits the
// marked/unmarked segments the renderer materializes inside the React tree. No
// DOM, no post-commit mutation — the rehype plugin (MarkdownContent) consumes
// this output to build hast.
//
// Coverage-depth styling + most-specific-branch click routing mirror the OLD
// `lib/textOffsets.ts` semantics exactly, but operate on v2 canonical offsets
// instead of flat DOM text-node offsets.

import type { AnchorModel, Leaf } from './anchorModel';

/** A persisted highlight reduced to what projection + click routing need. */
export interface ProjectedHighlight {
  id: string;
  branchConvoId: string;
  /** v2 canonical start offset (UTF-16 index into canonicalText). */
  startOffset: number;
  /** v2 canonical end offset (exclusive). */
  endOffset: number;
  quote: string;
}

/**
 * One contiguous sub-range of a single leaf, annotated with coverage. A leaf can
 * be split into several segments (marked + unmarked) at highlight boundaries.
 */
export interface LeafSegment {
  /** Offset within the leaf value where this segment starts (UTF-16). */
  localStart: number;
  /** Offset within the leaf value where this segment ends (exclusive). */
  localEnd: number;
  /** The exact substring of the leaf value this segment covers. */
  text: string;
  /** Number of highlights covering this segment (0 = unmarked). */
  depth: number;
  /**
   * Covering highlights ordered by specificity: smallest range first (most
   * specific), tie-broken by most-recently-created. `covering[0]` is the click
   * target. Empty when `depth === 0`.
   */
  covering: ProjectedHighlight[];
}

/** Projection result for one leaf. */
export interface LeafProjection {
  leaf: Leaf;
  /**
   * For prose/code: the ordered marked/unmarked segments. For math: a single
   * segment spanning the one U+FFFC unit (atomic — never split).
   */
  segments: LeafSegment[];
  /** True when ANY highlight covers this leaf (math atomicity / fast paths). */
  marked: boolean;
}

/** Coverage-depth -> background strength, matching the prior `<mark>` styling. */
export function markBackground(depth: number): string {
  const pct = Math.min(18 + (depth - 1) * 22, 85);
  return `color-mix(in oklch, var(--primary) ${pct}%, transparent)`;
}

/** Highlight range length, for the smallest-range (most-specific) tie-break. */
function rangeLength(h: ProjectedHighlight): number {
  return h.endOffset - h.startOffset;
}

/**
 * Order covering highlights for click routing: smallest range first (most
 * specific), tie-broken by most-recently-created. `creationIndex` preserves the
 * caller's load order (backend returns createdAt-ascending), so a higher index
 * is more recent.
 */
function orderBySpecificity(
  covering: ProjectedHighlight[],
  creationIndex: Map<string, number>,
): ProjectedHighlight[] {
  return [...covering].sort((a, b) => {
    const lenDiff = rangeLength(a) - rangeLength(b);
    if (lenDiff !== 0) return lenDiff;
    return (creationIndex.get(b.id) ?? 0) - (creationIndex.get(a.id) ?? 0);
  });
}

/**
 * Keep only v2 highlights whose ranges FIT the current model (plan item 6):
 * `0 <= start < end <= canonicalText.length`. Out-of-range anchors get no inline
 * mark; the message-level fallback surfaces them instead.
 */
export function fittingHighlights(
  model: AnchorModel,
  highlights: ProjectedHighlight[],
): ProjectedHighlight[] {
  const len = model.canonicalText.length;
  return highlights.filter(
    (h) =>
      Number.isInteger(h.startOffset) &&
      Number.isInteger(h.endOffset) &&
      h.startOffset >= 0 &&
      h.endOffset <= len &&
      h.startOffset < h.endOffset,
  );
}

/**
 * Project one leaf into segments. Prose/code leaves split at highlight
 * boundaries clipped to the leaf span; math leaves are atomic (the whole U+FFFC
 * unit is marked when any range covers it — never split).
 */
function projectLeaf(
  leaf: Leaf,
  highlights: ProjectedHighlight[],
  creationIndex: Map<string, number>,
): LeafProjection {
  const isMath = leaf.kind === 'math';

  // Highlights touching this leaf's [start,end) canonical span.
  const touching = highlights.filter(
    (h) => h.startOffset < leaf.end && h.endOffset > leaf.start,
  );

  if (touching.length === 0) {
    return {
      leaf,
      marked: false,
      segments: [
        {
          localStart: 0,
          localEnd: leaf.value.length,
          text: leaf.value,
          depth: 0,
          covering: [],
        },
      ],
    };
  }

  if (isMath) {
    // Atomic: any touch marks the whole single-unit leaf.
    return {
      leaf,
      marked: true,
      segments: [
        {
          localStart: 0,
          localEnd: leaf.value.length,
          text: leaf.value,
          depth: touching.length,
          covering: orderBySpecificity(touching, creationIndex),
        },
      ],
    };
  }

  // Prose/code: sweep boundaries inside the leaf span (canonical coords).
  const boundarySet = new Set<number>([leaf.start, leaf.end]);
  for (const h of touching) {
    if (h.startOffset > leaf.start) boundarySet.add(h.startOffset);
    if (h.endOffset < leaf.end) boundarySet.add(h.endOffset);
  }
  const boundaries = [...boundarySet].sort((a, b) => a - b);

  const segments: LeafSegment[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const segStart = boundaries[i];
    const segEnd = boundaries[i + 1];
    if (segEnd <= segStart) continue;
    const mid = (segStart + segEnd) / 2;
    const covering = touching.filter(
      (h) => h.startOffset <= mid && mid < h.endOffset,
    );
    segments.push({
      localStart: segStart - leaf.start,
      localEnd: segEnd - leaf.start,
      text: leaf.value.slice(segStart - leaf.start, segEnd - leaf.start),
      depth: covering.length,
      covering:
        covering.length === 0
          ? []
          : orderBySpecificity(covering, creationIndex),
    });
  }

  return {
    leaf,
    marked: segments.some((s) => s.depth > 0),
    segments,
  };
}

/**
 * Project all fitting v2 highlights onto the model, returning per-leaf segment
 * plans keyed by leaf index. The renderer walks leaves in document order and
 * materializes each plan as marked/unmarked spans (prose/code) or atomic
 * highlight state (math).
 */
export function projectHighlights(
  model: AnchorModel,
  highlights: ProjectedHighlight[],
): LeafProjection[] {
  const fitting = fittingHighlights(model, highlights);
  const creationIndex = new Map<string, number>();
  highlights.forEach((h, i) => creationIndex.set(h.id, i));
  return model.leaves.map((leaf) =>
    projectLeaf(leaf, fitting, creationIndex),
  );
}
