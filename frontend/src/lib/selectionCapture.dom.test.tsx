// @vitest-environment happy-dom
//
// B4 item 1 + 2 — V2 selection capture/restore goldens + round-trip.
//
// Renders the REAL `MarkdownContent` into happy-dom, builds genuine `Range`s
// over the rendered nodes, and runs the REAL `domCapture.rangeToAnchorOffsets`
// (which delegates to the pure `highlightCapture`). Asserts the normalized
// persisted v2 `[start,end)`, then re-projects those coords back onto the same
// content and asserts the SAME text is marked (capture<->projection loop), plus
// whole-formula atomic math, exact code whitespace, and most-specific-branch
// click routing.
//
// Fixture model (from buildAnchorModel, verified):
//   prose  [0,7)   "Energy "
//   math   [7,8)   ￼  tex "E=mc^2"            (inline $...$)
//   prose  [8,20)  " links mass."
//   prose  [20,40) "The area integral is"
//   math   [40,41) ￼  tex " \int_0^1 x^2 dx " (display \[...\])
//   prose  [41,54) "and the call "
//   code   [54,64) "compute(x)"               (inline `code`)
//   prose  [64,76) " returns it."
//   code   [76,101)"const a = 1;\nconst b = 2;"(```ts fence```, newline at 88)
//   prose  [101,111)"End prose."

import { beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';

import { initHighlighter } from './highlighter';
import MarkdownContent from '../components/MarkdownContent';
import { rangeToAnchorOffsets } from './domCapture';
import {
  captureRangeFromEndpoints,
  type CaptureEndpoint,
} from './highlightCapture';
import { buildAnchorModel } from './anchorModel';
import { markBackground, projectHighlights } from './highlightProjection';
import type { ProjectedHighlight } from './highlightProjection';
import type { Highlight } from '../../../types/types';
import {
  findTextNode,
  firstKatexTextNode,
  nthExactTextNode,
  rangeBetween,
  renderReact,
} from '../test/domHarness';

const FIXTURE = `Energy $E=mc^2$ links mass.

The area integral is

\\[ \\int_0^1 x^2 dx \\]

and the call \`compute(x)\` returns it.

\`\`\`ts
const a = 1;
const b = 2;
\`\`\`

End prose.`;

const MATH_INLINE = { start: 7, end: 8 };
const MATH_DISPLAY = { start: 40, end: 41 };
const CODE_FENCE = { start: 76, end: 101 };

beforeAll(async () => {
  await initHighlighter();
});

function renderFixture(highlights: Highlight[] = []) {
  return renderReact(
    createElement(MarkdownContent, { content: FIXTURE, highlights }),
  );
}

/** Persisted-highlight factory for re-projection / restore assertions. */
function hl(start: number, end: number, id = 'h1'): Highlight {
  return {
    id,
    messageId: 'm1',
    branchConvoId: `c-${id}`,
    startOffset: start,
    endOffset: end,
    quote: FIXTURE,
    userId: null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Re-project a captured [start,end) onto the SAME content and return the text
 * that the renderer would mark (prose/code substrings + the U+FFFC math atom).
 * This closes the capture<->projection loop WITHOUT a second DOM render.
 */
function projectedMarkedText(start: number, end: number): string {
  const model = buildAnchorModel(FIXTURE);
  const ph: ProjectedHighlight = {
    id: 'p',
    branchConvoId: 'b',
    startOffset: start,
    endOffset: end,
    quote: 'q',
  };
  const projections = projectHighlights(model, [ph]);
  let out = '';
  for (const p of projections) {
    for (const seg of p.segments) {
      if (seg.depth > 0) out += seg.text;
    }
  }
  return out;
}

describe('v2 selection capture — prose around math and code', () => {
  it('prose BEFORE math (within the leading prose leaf)', async () => {
    const { container, host, unmount } = await renderFixture();
    // "Energy " -> select "Energy" [0,6)
    const range = rangeBetween(
      host,
      { needle: 'Energy', delta: 0 },
      { needle: 'Energy', delta: 6 },
    );
    expect(rangeToAnchorOffsets(container, range)).toEqual({ start: 0, end: 6 });
    expect(projectedMarkedText(0, 6)).toBe('Energy');
    unmount();
  });

  it('prose AFTER math (within " links mass.")', async () => {
    const { container, host, unmount } = await renderFixture();
    // " links mass." [8,20) -> select "links" => canonical [9,14)
    const range = rangeBetween(
      host,
      { needle: 'links mass', delta: 0 },
      { needle: 'links mass', delta: 5 },
    );
    expect(rangeToAnchorOffsets(container, range)).toEqual({ start: 9, end: 14 });
    expect(projectedMarkedText(9, 14)).toBe('links');
    unmount();
  });

  it('prose BEFORE inline code ("the call ")', async () => {
    const { container, host, unmount } = await renderFixture();
    // "and the call " [41,54) -> select "call" => [49,53)
    const range = rangeBetween(
      host,
      { needle: 'the call', delta: 4 },
      { needle: 'the call', delta: 8 },
    );
    expect(rangeToAnchorOffsets(container, range)).toEqual({
      start: 49,
      end: 53,
    });
    expect(projectedMarkedText(49, 53)).toBe('call');
    unmount();
  });

  it('prose AFTER inline code (" returns it.")', async () => {
    const { container, host, unmount } = await renderFixture();
    // " returns it." [64,76) -> "returns" => [65,72)
    const range = rangeBetween(
      host,
      { needle: 'returns it', delta: 0 },
      { needle: 'returns it', delta: 7 },
    );
    expect(rangeToAnchorOffsets(container, range)).toEqual({
      start: 65,
      end: 72,
    });
    expect(projectedMarkedText(65, 72)).toBe('returns');
    unmount();
  });
});

describe('v2 selection capture — wholly inside math (atomic, whole formula)', () => {
  it('inline math: endpoints inside KaTeX capture the WHOLE formula', async () => {
    const { container, host, unmount } = await renderFixture();
    const katexText = firstKatexTextNode(host); // first .katex is the inline one
    const range = host.ownerDocument.createRange();
    range.setStart(katexText, 0);
    range.setEnd(katexText, Math.min(1, katexText.nodeValue?.length ?? 1));
    expect(rangeToAnchorOffsets(container, range)).toEqual(MATH_INLINE);
    // re-projected: the whole single math unit is marked atomically.
    expect(projectedMarkedText(MATH_INLINE.start, MATH_INLINE.end)).toBe('￼');
    unmount();
  });

  it('display math: a selection inside it captures the whole display formula', async () => {
    const { container, host, unmount } = await renderFixture();
    const display = host.querySelector('.katex-display') as HTMLElement;
    const tn = display.ownerDocument
      .createTreeWalker(display, 4)
      .nextNode() as Text;
    const range = host.ownerDocument.createRange();
    range.setStart(tn, 0);
    range.setEnd(tn, Math.min(1, tn.nodeValue?.length ?? 1));
    expect(rangeToAnchorOffsets(container, range)).toEqual(MATH_DISPLAY);
    unmount();
  });

  it('atomic math styling: a covering range marks the whole katex wrapper', async () => {
    const { host, unmount } = await renderFixture([
      hl(MATH_INLINE.start, MATH_INLINE.end, 'mInline'),
    ]);
    const wrapper = host.querySelector(
      '.katex[data-anchor-kind="math"]',
    ) as HTMLElement;
    expect(wrapper).toBeTruthy();
    // Atomic highlight props applied to the OUTER formula wrapper (not a
    // .katex-mathml / .katex-html descendant — those are never split/walked).
    expect(wrapper.getAttribute('data-branch-mark')).toBe('true');
    expect(wrapper.getAttribute('data-branch-id')).toBe('mInline');
    expect(wrapper.getAttribute('role')).toBe('button');
    expect(wrapper.getAttribute('tabindex')).toBe('0');
    // The whole math leaf is a single covered segment (depth 1) — its
    // coverage-depth background is what the renderer applies. (happy-dom's CSS
    // parser drops the color-mix() background from inline style, so assert the
    // styling at its declarative source: the projection segment.)
    const projection = projectHighlights(buildAnchorModel(FIXTURE), [
      {
        id: 'mInline',
        branchConvoId: 'b',
        startOffset: MATH_INLINE.start,
        endOffset: MATH_INLINE.end,
        quote: 'q',
      },
    ]);
    const mathLeaf = projection.find((p) => p.leaf.kind === 'math')!;
    expect(mathLeaf.marked).toBe(true);
    expect(mathLeaf.segments).toHaveLength(1);
    expect(mathLeaf.segments[0].depth).toBe(1);
    expect(markBackground(1)).toContain('color-mix');
    unmount();
  });
});

describe('v2 selection capture — wholly inside code (exact, non-atomic)', () => {
  it('inline code: select inside `compute(x)` captures exact coords', async () => {
    const { container, host, unmount } = await renderFixture();
    // capture "compute" => [54,61)
    const range = rangeBetween(
      host,
      { needle: 'compute(x)', delta: 0 },
      { needle: 'compute(x)', delta: 7 },
    );
    expect(rangeToAnchorOffsets(container, range)).toEqual({
      start: 54,
      end: 61,
    });
    expect(projectedMarkedText(54, 61)).toBe('compute');
    unmount();
  });

  it('fenced code: a selection across Shiki tokens preserves EXACT whitespace + newline', async () => {
    const { container, host, unmount } = await renderFixture();
    // Shiki splits the fence into one text node per token; select from the FIRST
    // token of line 1 (`const`) to the END of the LAST token of line 2 (`;`),
    // crossing the inter-line "\n" text node. The capture must walk every token
    // and produce the exact code span [76,101).
    const startN = nthExactTextNode(host, 'const', 0); // line 1 keyword
    const endN = nthExactTextNode(host, ';', 1); // line 2 semicolon
    const range = host.ownerDocument.createRange();
    range.setStart(startN, 0);
    range.setEnd(endN, 1);
    expect(rangeToAnchorOffsets(container, range)).toEqual(CODE_FENCE);
    // The re-projected marked text is the code verbatim, newline preserved.
    expect(projectedMarkedText(CODE_FENCE.start, CODE_FENCE.end)).toBe(
      'const a = 1;\nconst b = 2;',
    );
    unmount();
  });

  it('fenced code: a partial selection across the newline keeps exact whitespace', async () => {
    const { container, host, unmount } = await renderFixture();
    // Select from "= 1;" through the newline into "const b" on the next line.
    // " 1" token sits at canonical seg [29-ish]; pick concrete tokens: end of
    // line1 ";" (canonical 87..88) .. start of line2 "const" (88..93). The "\n"
    // is canonical 88. Selecting ";" end .. "b" should include "\nconst b".
    const semi1 = nthExactTextNode(host, ';', 0); // line 1 ";": canonical [87,88)
    const const2 = nthExactTextNode(host, 'const', 1); // line 2: [89,94)
    const range = host.ownerDocument.createRange();
    range.setStart(semi1, 0); // canonical 87
    range.setEnd(const2, 5); // canonical 94
    const captured = rangeToAnchorOffsets(container, range);
    expect(captured).toEqual({ start: 87, end: 94 });
    // Verbatim slice INCLUDING the preserved newline.
    expect(projectedMarkedText(87, 94)).toBe(';\nconst');
    unmount();
  });
});

describe('v2 selection capture — spanning ranges', () => {
  it('prose <-> math: includes the WHOLE formula', async () => {
    const { container, host, unmount } = await renderFixture();
    // start "Energy" [0] .. end inside inline math -> [0,8) (whole formula in)
    const [startN, startI] = findTextNode(host, 'Energy');
    const katexText = firstKatexTextNode(host);
    const range = host.ownerDocument.createRange();
    range.setStart(startN, startI);
    range.setEnd(katexText, Math.min(1, katexText.nodeValue?.length ?? 1));
    expect(rangeToAnchorOffsets(container, range)).toEqual({ start: 0, end: 8 });
    // Re-projected: "Energy " prose marked AND the math atom marked.
    expect(projectedMarkedText(0, 8)).toBe('Energy ￼');
    unmount();
  });

  it('prose <-> code (inline): spans prose into the code leaf exactly', async () => {
    const { container, host, unmount } = await renderFixture();
    // "the call " [start of "call" =49] .. inside "compute(x)" up to "compute"=61
    const [startN, startI] = findTextNode(host, 'the call');
    const [endN, endI] = findTextNode(host, 'compute(x)');
    const range = host.ownerDocument.createRange();
    range.setStart(startN, startI + 4); // "call"
    range.setEnd(endN, endI + 7); // "compute"
    expect(rangeToAnchorOffsets(container, range)).toEqual({
      start: 49,
      end: 61,
    });
    expect(projectedMarkedText(49, 61)).toBe('call compute');
    unmount();
  });

  it('math <-> code: from inside display math through into the fence', async () => {
    const { container, host, unmount } = await renderFixture();
    // start inside display math -> snaps to BEFORE atom (40); end inside the
    // fence at the end of line-1 `const` token (canonical 76+5 = 81). [40,81).
    const display = host.querySelector('.katex-display') as HTMLElement;
    const mathTn = display.ownerDocument
      .createTreeWalker(display, 4)
      .nextNode() as Text;
    const const1 = nthExactTextNode(host, 'const', 0); // line 1: [76,81)
    const range = host.ownerDocument.createRange();
    range.setStart(mathTn, 0);
    range.setEnd(const1, 5); // end of "const"
    expect(rangeToAnchorOffsets(container, range)).toEqual({
      start: 40,
      end: 81,
    });
    // re-projected marked text spans the math atom + intervening prose/code.
    const marked = projectedMarkedText(40, 81);
    expect(marked.startsWith('￼')).toBe(true);
    expect(marked.endsWith('const')).toBe(true);
    unmount();
  });
});

describe('v2 selection capture — normalization & rejection', () => {
  // A browser `Range` is ALWAYS forward-normalized: setting the end before the
  // start collapses it (verified against happy-dom, matching the DOM spec). A
  // user's BACKWARD selection therefore reaches `message.tsx` as a forward Range
  // via `selection.getRangeAt(0)`. The capture CORE still defends against
  // reversed endpoints (its swap path); we exercise that on the REAL
  // DOM-resolved coordinates by feeding the endpoints to the pure core directly.
  it('reversed endpoints (the swap path) normalize to the SAME range as forward', () => {
    // " links mass." [8,20) -> "links" forward => [9,14).
    const proseLeaf = { leafStart: 8, leafEnd: 20, kind: 'prose' as const };
    const startEp: CaptureEndpoint = { ...proseLeaf, offsetInLeaf: 1 }; // canon 9
    const endEp: CaptureEndpoint = { ...proseLeaf, offsetInLeaf: 6 }; // canon 14
    const forward = captureRangeFromEndpoints(startEp, endEp);
    const reversed = captureRangeFromEndpoints(endEp, startEp);
    expect(forward).toEqual({ start: 9, end: 14 });
    expect(reversed).toEqual(forward);
  });

  it('a real DOM Range with end<start collapses, so capture rejects it (browser-forward-normalize)', async () => {
    const { container, host, unmount } = await renderFixture();
    const [node, idx] = findTextNode(host, 'links mass');
    const rev = host.ownerDocument.createRange();
    rev.setStart(node, idx + 5);
    rev.setEnd(node, idx); // happy-dom collapses this to an empty range
    expect(rev.collapsed).toBe(true);
    expect(rangeToAnchorOffsets(container, rev)).toBeNull();
    unmount();
  });

  it('a collapsed prose caret (empty selection) is rejected', async () => {
    const { container, host, unmount } = await renderFixture();
    const [node, idx] = findTextNode(host, 'links mass');
    const caret = host.ownerDocument.createRange();
    caret.setStart(node, idx + 2);
    caret.setEnd(node, idx + 2);
    expect(rangeToAnchorOffsets(container, caret)).toBeNull();
    unmount();
  });

  it('empty ONLY after atomic-math normalization is rejected (math endpoint pair)', () => {
    // The genuine "empty only after math normalization" case is unreachable as a
    // forward DOM Range (start always snaps to BEFORE the atom, end to AFTER, so
    // a single atom never collapses). It arises when the START endpoint resolves
    // to the prose position immediately AFTER the math atom (canonical 8) while
    // the END endpoint lands inside that SAME atom and snaps to its end (also 8).
    // Both -> 8 -> empty -> rejected. We assert it on the REAL pure core.
    const proseAfterMath: CaptureEndpoint = {
      leafStart: 8, // " links mass." starts right after the inline math atom
      leafEnd: 20,
      kind: 'prose',
      offsetInLeaf: 0, // canonical 8
    };
    const insideMath: CaptureEndpoint = {
      leafStart: 7,
      leafEnd: 8,
      kind: 'math',
      offsetInLeaf: 0, // normalizeEnd -> leafEnd = 8
    };
    expect(captureRangeFromEndpoints(proseAfterMath, insideMath)).toBeNull();
  });
});

describe('v2 click routing — most-specific branch wins', () => {
  it('overlapping marks: the smallest covering range is the click target', async () => {
    // Two highlights over the leading prose: big [0,20) and small [0,6).
    // The depth-2 segment "Energy" must target the SMALL (most specific) one.
    const big = hl(0, 20, 'big');
    const small = hl(0, 6, 'small');
    const { host, unmount } = await renderFixture([big, small]);
    // The mark covering "Energy" (the most-covered segment) targets 'small'.
    const marks = Array.from(host.querySelectorAll('mark')) as HTMLElement[];
    const energyMark = marks.find((m) => m.textContent === 'Energy');
    expect(energyMark).toBeTruthy();
    expect(energyMark!.getAttribute('data-branch-id')).toBe('small');
    unmount();
  });
});
