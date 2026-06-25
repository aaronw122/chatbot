// @vitest-environment happy-dom
//
// B4 item 2 — capture<->projection ROUND-TRIP through TWO real DOM renders.
//
// 1. Render content, build a real Range over the rendered nodes, capture v2
//    coords with the real `domCapture`.
// 2. Re-render the SAME content with those coords as a persisted v2 highlight.
// 3. Assert the declarative <mark>(s) in the second render reproduce the SAME
//    visible text (and, for math, mark the whole formula atomically).
//
// This closes the loop end-to-end in the DOM, proving capture and projection
// agree on the canonical coordinate space.

import { beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';

import { initHighlighter } from './highlighter';
import MarkdownContent from '../components/MarkdownContent';
import { rangeToAnchorOffsets } from './domCapture';
import type { CaptureRange } from './highlightCapture';
import type { Highlight } from '../../../types/types';
import { nthExactTextNode, renderReact } from '../test/domHarness';

beforeAll(async () => {
  await initHighlighter();
});

function persisted(range: CaptureRange, quote: string): Highlight {
  return {
    id: 'rt',
    messageId: 'm1',
    branchConvoId: 'c1',
    startOffset: range.start,
    endOffset: range.end,
    quote,
    userId: null,
    createdAt: new Date().toISOString(),
  };
}

/** Concatenated visible text of every declarative <mark> in document order. */
function markedText(host: HTMLElement): string {
  return Array.from(host.querySelectorAll('mark'))
    .map((m) => m.textContent ?? '')
    .join('');
}

async function captureFirstRender(
  content: string,
  buildRange: (host: HTMLElement) => Range,
): Promise<CaptureRange> {
  const { host, container, unmount } = await renderReact(
    createElement(MarkdownContent, { content }),
  );
  const range = buildRange(host);
  const captured = rangeToAnchorOffsets(container, range);
  unmount();
  if (!captured) throw new Error('capture returned null');
  return captured;
}

describe('round-trip — captured coords re-mark the same text', () => {
  it('prose selection round-trips to the same marked text', async () => {
    const content = 'The quick brown fox jumps.';
    const captured = await captureFirstRender(content, (host) => {
      const node = nthExactTextNode(host, 'The quick brown fox jumps.', 0);
      const r = host.ownerDocument.createRange();
      const i = node.nodeValue!.indexOf('brown fox');
      r.setStart(node, i);
      r.setEnd(node, i + 'brown fox'.length);
      return r;
    });
    const { host, unmount } = await renderReact(
      createElement(MarkdownContent, {
        content,
        highlights: [persisted(captured, 'brown fox')],
      }),
    );
    expect(markedText(host)).toBe('brown fox');
    unmount();
  });

  it('inline-code selection round-trips with exact code text', async () => {
    const content = 'call `doThing(42)` now';
    const captured = await captureFirstRender(content, (host) => {
      // inline code renders as a single <code> text node "doThing(42)"
      const node = nthExactTextNode(host, 'doThing(42)', 0);
      const r = host.ownerDocument.createRange();
      r.setStart(node, 0);
      r.setEnd(node, 'doThing'.length);
      return r;
    });
    const { host, unmount } = await renderReact(
      createElement(MarkdownContent, {
        content,
        highlights: [persisted(captured, 'doThing')],
      }),
    );
    expect(markedText(host)).toBe('doThing');
    unmount();
  });

  it('fenced-code multi-line selection round-trips preserving the newline', async () => {
    const content = 'x\n\n```ts\nlet p = 1;\nlet q = 2;\n```';
    const captured = await captureFirstRender(content, (host) => {
      const start = nthExactTextNode(host, 'let', 0); // line 1
      const end = nthExactTextNode(host, ';', 1); // line 2
      const r = host.ownerDocument.createRange();
      r.setStart(start, 0);
      r.setEnd(end, 1);
      return r;
    });
    const { host, unmount } = await renderReact(
      createElement(MarkdownContent, {
        content,
        highlights: [persisted(captured, 'code')],
      }),
    );
    // The re-render marks the whole code body verbatim, newline preserved.
    expect(markedText(host)).toBe('let p = 1;\nlet q = 2;');
    unmount();
  });

  it('prose<->math selection round-trips and marks the whole formula atom', async () => {
    const content = 'sum $a+b$ done';
    const captured = await captureFirstRender(content, (host) => {
      const sum = nthExactTextNode(host, 'sum ', 0);
      const katex = host.querySelector('.katex')!;
      const mathTn = host.ownerDocument
        .createTreeWalker(katex, 4)
        .nextNode() as Text;
      const r = host.ownerDocument.createRange();
      r.setStart(sum, 0);
      r.setEnd(mathTn, Math.min(1, mathTn.nodeValue?.length ?? 1));
      return r;
    });
    // canonical: "sum ￼ done" -> prose[0,4) math[4,5) -> captured [0,5)
    expect(captured).toEqual({ start: 0, end: 5 });
    const { host, unmount } = await renderReact(
      createElement(MarkdownContent, {
        content,
        highlights: [persisted(captured, 'sum a+b')],
      }),
    );
    // The prose "sum " is marked AND the katex wrapper carries the atomic mark.
    expect(markedText(host)).toBe('sum ');
    const wrapper = host.querySelector(
      '.katex[data-anchor-kind="math"]',
    ) as HTMLElement;
    expect(wrapper.getAttribute('data-branch-mark')).toBe('true');
    expect(wrapper.getAttribute('data-branch-id')).toBe('rt');
    unmount();
  });
});
