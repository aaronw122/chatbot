// rehype plugin: aligns react-markdown's rendered hast to the v2 AnchorModel and
// emits declarative branch highlights + leaf-span metadata.
//
// =========================== ALIGNMENT APPROACH ============================
// `buildAnchorModel(content)` is the coordinate AUTHORITY (canonical UTF-16
// offsets over `canonicalText`). The rendered hast must conform to it, never the
// reverse. We do MODEL-DRIVEN matching: a single monotonic cursor walks
// `canonicalText` while we traverse the hast in document order, consuming model
// leaves as their rendered text appears.
//
//   * KaTeX wrapper (`span.katex` / `.katex-display`) -> the next `math` leaf
//     (one U+FFFC unit). We stamp the wrapper with that leaf's [start,end) span,
//     apply ATOMIC highlight state if a fitting range covers it, advance the
//     cursor past the math unit, and DO NOT descend (its `.katex-mathml` /
//     `.katex-html` text is renderer-added and never matched/walked).
//   * Code leaves render as `<pre><code>...Shiki spans...</code></pre>` (or
//     inline `<code>`). Shiki splits the code into nested token text nodes; their
//     concatenation equals the code leaf value (Shiki may append ONE trailing
//     "\n" not present in the model — treated as structural filler). Each code
//     text node is split into mark/unmark segments at canonical boundaries.
//   * Prose mdast `text` nodes are 1:1 with `prose` leaves; each is split into
//     mark/unmark segments.
//   * Structural text inserted by remark-rehype (inter-block "\n") or Shiki's
//     trailing newline does NOT match the leaf at the cursor; it is emitted
//     verbatim and the cursor does not advance.
//
// Renderer-owned prose/code segments become `<mark data-anchor-*>` /
// `<span data-anchor-*>` elements; the KaTeX wrapper carries its one math-unit
// span. EVERY rendered semantic leaf thus carries stable `data-anchor-start`,
// `data-anchor-end`, `data-anchor-kind` attributes — the DOM contract capture +
// B4 tests read. No post-commit mutation: this runs during the synchronous
// render pipeline, producing the final hast React renders directly.

import type { Element, Properties, Root, RootContent, Text } from 'hast';
import type { AnchorModel, Leaf } from './anchorModel';
import {
  ANCHOR_END_ATTR,
  ANCHOR_KIND_ATTR,
  ANCHOR_START_ATTR,
} from './highlightCapture';
import type { LeafProjection, ProjectedHighlight } from './highlightProjection';
import { markBackground, projectHighlights } from './highlightProjection';

export interface AnchorMarksOptions {
  model: AnchorModel;
  highlights: ProjectedHighlight[];
  /** Called when a mark is activated; wired to a stable id->handler lookup. */
  onActivate?: (highlightId: string) => void;
}

/** Class list helpers (hast className may be string | array | undefined). */
function classList(props: Properties | undefined): string[] {
  const cn = props?.className;
  if (Array.isArray(cn)) return cn.map(String);
  if (typeof cn === 'string') return cn.split(/\s+/).filter(Boolean);
  return [];
}

function isKatexWrapper(node: Element): boolean {
  const cls = classList(node.properties);
  return cls.includes('katex') || cls.includes('katex-display');
}

/** Build the data-anchor-* properties for a leaf span. */
function anchorProps(leaf: Leaf): Properties {
  return {
    [ANCHOR_START_ATTR]: leaf.start,
    [ANCHOR_END_ATTR]: leaf.end,
    [ANCHOR_KIND_ATTR]: leaf.kind,
  };
}

/** Properties applied to a marked segment (declarative <mark>). */
function markProps(
  leaf: Leaf,
  segLocalStart: number,
  segLocalEnd: number,
  depth: number,
  target: ProjectedHighlight | undefined,
): Properties {
  return {
    ...anchorProps(leaf),
    // Segment-local span lets capture resolve sub-leaf offsets precisely.
    'data-anchor-seg-start': leaf.start + segLocalStart,
    'data-anchor-seg-end': leaf.start + segLocalEnd,
    'data-branch-mark': 'true',
    'data-branch-id': target?.id,
    style: `background-color:${markBackground(depth)};color:inherit;border-radius:2px;cursor:pointer;padding:0 1px;`,
    role: target ? 'button' : undefined,
    tabIndex: target ? 0 : undefined,
    title: target?.quote,
    'aria-label': target ? `Open branch about ${target.quote}` : undefined,
  };
}

/**
 * A plain (unmarked) leaf-text span. Carries the leaf span AND this segment's
 * absolute canonical `seg-start` so capture can resolve a boundary inside a
 * non-leading segment (e.g. the trailing piece after a mark) precisely.
 */
function plainSpan(
  leaf: Leaf,
  segLocalStart: number,
  segLocalEnd: number,
  text: string,
): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: {
      ...anchorProps(leaf),
      'data-anchor-seg-start': leaf.start + segLocalStart,
      'data-anchor-seg-end': leaf.start + segLocalEnd,
    },
    children: [{ type: 'text', value: text }],
  };
}

/**
 * Replace a code/prose text node (belonging to `leaf`, starting at
 * `leafConsumed` within the leaf value) with marked/unmarked spans per the
 * projection. Returns the produced hast nodes and the number of leaf chars
 * consumed.
 */
function segmentTextNode(
  text: string,
  leaf: Leaf,
  leafConsumed: number,
  projection: LeafProjection,
): RootContent[] {
  const out: RootContent[] = [];
  const nodeStart = leafConsumed; // local offset where this text node begins
  const nodeEnd = leafConsumed + text.length;

  for (const seg of projection.segments) {
    // Intersect this projection segment with the current text node window.
    const lo = Math.max(seg.localStart, nodeStart);
    const hi = Math.min(seg.localEnd, nodeEnd);
    if (hi <= lo) continue;
    const piece = leaf.value.slice(lo, hi);
    if (seg.depth === 0) {
      out.push(plainSpan(leaf, lo, hi, piece));
    } else {
      out.push({
        type: 'element',
        tagName: 'mark',
        properties: markProps(leaf, lo, hi, seg.depth, seg.covering[0]),
        children: [{ type: 'text', value: piece }],
      });
    }
  }
  return out;
}

/**
 * The plugin. `unified` calls the returned transformer with the hast root.
 */
export function rehypeAnchorMarks(options: AnchorMarksOptions) {
  const { model, highlights } = options;
  const projections = projectHighlights(model, highlights);
  const canonical = model.canonicalText;

  return (tree: Root): void => {
    // Monotonic cursor into canonicalText. We also track which leaf the cursor
    // currently sits in for fast projection lookup.
    let cursor = 0;
    let leafIdx = 0;

    const leafAt = (pos: number): number => {
      // Advance leafIdx so leaves[leafIdx] contains pos (or is the next leaf).
      while (
        leafIdx < model.leaves.length &&
        pos >= model.leaves[leafIdx].end &&
        model.leaves[leafIdx].end > model.leaves[leafIdx].start
      ) {
        leafIdx++;
      }
      return leafIdx;
    };

    // Consume a KaTeX wrapper: bind it to the next math leaf at/after cursor.
    const consumeMath = (node: Element): void => {
      // Find next math leaf at or after the cursor.
      let idx = leafAt(cursor);
      while (idx < model.leaves.length && model.leaves[idx].kind !== 'math') {
        idx++;
      }
      if (idx >= model.leaves.length) return; // no math leaf left; leave as-is
      const leaf = model.leaves[idx];
      const projection = projections[idx];
      const props: Properties = {
        ...(node.properties ?? {}),
        ...anchorProps(leaf),
      };
      if (projection.marked) {
        const seg = projection.segments[0];
        const target = seg.covering[0];
        const existingStyle =
          typeof node.properties?.style === 'string'
            ? node.properties.style.replace(/;?\s*$/, ';')
            : '';
        props.style =
          `${existingStyle}background-color:${markBackground(seg.depth)};border-radius:2px;cursor:pointer;`;
        props['data-branch-mark'] = 'true';
        if (target) {
          props['data-branch-id'] = target.id;
          props.role = 'button';
          props.tabIndex = 0;
          props.title = target.quote;
          props['aria-label'] = `Open branch about ${target.quote}`;
        }
      }
      node.properties = props;
      // Advance cursor past the single math unit.
      cursor = leaf.end;
      leafIdx = idx;
    };

    /**
     * Process the children array of `parent`, rewriting renderer-owned text
     * nodes into segment spans. Returns the new children array.
     */
    const processChildren = (children: RootContent[]): RootContent[] => {
      const result: RootContent[] = [];
      for (const child of children) {
        if (child.type === 'text') {
          result.push(...processText(child));
          continue;
        }
        if (child.type === 'element') {
          if (isKatexWrapper(child)) {
            consumeMath(child);
            result.push(child); // do NOT descend into katex internals
            continue;
          }
          child.children = processChildren(child.children) as Element['children'];
          result.push(child);
          continue;
        }
        // Some transformers (e.g. Shiki) wrap output in a nested `root`; descend
        // into any node that has a children array so the cursor keeps walking in
        // document order.
        if ('children' in child && Array.isArray(child.children)) {
          (child as { children: RootContent[] }).children = processChildren(
            child.children as RootContent[],
          );
          result.push(child);
          continue;
        }
        result.push(child); // comments, doctype, etc. — untouched
      }
      return result;
    };

    /**
     * Match a text node against canonicalText at the cursor. The matching prefix
     * (which belongs to the leaf at the cursor) is segmented; any non-matching
     * remainder (structural filler) is emitted verbatim without advancing.
     */
    const processText = (node: Text): RootContent[] => {
      const value = node.value;
      // How many leading chars of `value` equal canonicalText from `cursor`?
      let match = 0;
      while (
        match < value.length &&
        cursor + match < canonical.length &&
        value[match] === canonical[cursor + match]
      ) {
        match++;
      }

      if (match === 0) {
        // Pure structural filler (e.g. inter-block "\n" or Shiki trailing "\n").
        return [node];
      }

      const out: RootContent[] = [];
      const idx = leafAt(cursor);
      const leaf = model.leaves[idx];
      const projection = projections[idx];

      // The matched run must lie within ONE leaf (prose 1:1; code split by
      // Shiki never crosses the leaf). Clip the match to the leaf end for safety.
      const inLeaf = Math.min(match, leaf.end - cursor);
      const leafConsumed = cursor - leaf.start;
      const matchedText = value.slice(0, inLeaf);
      out.push(...segmentTextNode(matchedText, leaf, leafConsumed, projection));
      cursor += inLeaf;

      // Any trailing chars beyond the leaf or non-matching are filler.
      if (inLeaf < value.length) {
        out.push({ type: 'text', value: value.slice(inLeaf) });
      }
      return out;
    };

    tree.children = processChildren(tree.children) as Root['children'];
  };
}
