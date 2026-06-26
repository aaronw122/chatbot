// @vitest-environment happy-dom
//
// B4 item 3 — sequence / streaming fixtures.
//
// Re-renders the SAME React root through: revision N -> a longer revision N+1
// (simulating a streaming token append) -> a "reload" with persisted v2 code
// highlights. Asserts each commit's marks are produced DECLARATIVELY from the
// matching (content, ranges) pair, with:
//   - NO post-commit DOM mutation (the marks exist immediately after render and
//     do not change without a re-render),
//   - NO stale-revision marks bleeding across revisions (a highlight valid only
//     for revision N must not appear after content changes to N+1).
//
// The B3 renderer owns every mark declaratively (MarkdownContent rebuilds a
// fresh model + React tree from the latest props each revision), so we assert
// the rendered DOM after each commit reflects ONLY that revision's projection.

import { beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';

import { initHighlighter } from './highlighter';
import MarkdownContent from '../components/MarkdownContent';
import { buildAnchorModel } from './anchorModel';
import type { Highlight } from '../../../types/types';
import { renderReact } from '../test/domHarness';

beforeAll(async () => {
  await initHighlighter();
});

function hl(start: number, end: number, id: string, quote = 'q'): Highlight {
  return {
    id,
    messageId: 'm1',
    branchConvoId: `c-${id}`,
    startOffset: start,
    endOffset: end,
    quote,
    userId: null,
    createdAt: new Date().toISOString(),
  };
}

function markTexts(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('mark')).map((m) => m.textContent ?? '');
}

describe('sequence — streaming revisions render declaratively, no stale bleed', () => {
  it('revision N -> longer N+1 rebuilds marks from the new content only', async () => {
    // Revision N: short. Highlight "world" => canonical [6,11).
    const revN = 'hello world';
    const modelN = buildAnchorModel(revN);
    expect(modelN.canonicalText).toBe('hello world');

    const { host, container, rerender, unmount } = await renderReact(
      createElement(MarkdownContent, {
        content: revN,
        highlights: [hl(6, 11, 'a', 'world')],
      }),
    );
    expect(markTexts(host)).toEqual(['world']);
    // No post-commit mutation: a microtask later the DOM is unchanged.
    await Promise.resolve();
    expect(markTexts(host)).toEqual(['world']);
    const containerAfterN = host.firstElementChild;

    // Revision N+1: streaming appended more text. The SAME highlight id now
    // carries N+1 coords (e.g. "world" still at [6,11) but a NEW highlight on the
    // appended tail "everyone" => find offsets in the longer canonical text).
    const revN1 = 'hello world and goodbye everyone';
    const modelN1 = buildAnchorModel(revN1);
    const tailStart = modelN1.canonicalText.indexOf('everyone');
    const tailEnd = tailStart + 'everyone'.length;
    await rerender(
      createElement(MarkdownContent, {
        content: revN1,
        highlights: [hl(6, 11, 'a', 'world'), hl(tailStart, tailEnd, 'b', 'everyone')],
      }),
    );
    // Marks reflect the NEW revision: both "world" and "everyone", nothing stale.
    expect(markTexts(host)).toEqual(['world', 'everyone']);
    // The container element is the same root subtree (React reconciled, not a
    // detached stale tree); capture still works against it.
    expect(host.firstElementChild).toBe(containerAfterN);
    expect(container.querySelectorAll('mark').length).toBe(2);
    unmount();
  });

  it('a highlight valid for revision N does NOT bleed onto a shorter N+1', async () => {
    // N has a highlight near the end; N+1 truncates so that range is OUT OF
    // RANGE for the new model. fittingHighlights must drop it -> no inline mark.
    const revN = 'alpha beta gamma delta';
    const modelN = buildAnchorModel(revN);
    const gStart = modelN.canonicalText.indexOf('gamma');
    const gEnd = modelN.canonicalText.indexOf('delta') + 'delta'.length; // [12,22)

    const { host, rerender, unmount } = await renderReact(
      createElement(MarkdownContent, {
        content: revN,
        highlights: [hl(gStart, gEnd, 'tail', 'gamma delta')],
      }),
    );
    expect(markTexts(host)).toEqual(['gamma delta']);

    // N+1: truncated content; the [12,22) range no longer fits the model.
    const revN1 = 'alpha beta';
    await rerender(
      createElement(MarkdownContent, {
        content: revN1,
        highlights: [hl(gStart, gEnd, 'tail', 'gamma delta')],
      }),
    );
    // No stale mark survives — the out-of-range anchor produces NO inline mark.
    expect(markTexts(host)).toEqual([]);
    expect(host.textContent).toContain('alpha beta');
    expect(host.textContent).not.toContain('gamma');
    unmount();
  });

  it('reload with persisted v2 CODE highlights marks the exact code spans', async () => {
    // Simulate a reload: mount fresh with content + persisted v2 code ranges.
    const content = 'Run:\n\n```ts\nconst total = sum(xs);\n```';
    const model = buildAnchorModel(content);
    // code leaf value is "const total = sum(xs);"; mark "sum(xs)".
    const codeLeaf = model.leaves.find((l) => l.kind === 'code')!;
    const local = codeLeaf.value.indexOf('sum(xs)');
    const start = codeLeaf.start + local;
    const end = start + 'sum(xs)'.length;

    const { host, container, unmount } = await renderReact(
      createElement(MarkdownContent, {
        content,
        highlights: [hl(start, end, 'code1', 'sum(xs)')],
      }),
    );
    // The mark covers exactly the code substring (may be split across Shiki
    // token spans, so concatenate the mark texts).
    expect(markTexts(host).join('')).toBe('sum(xs)');
    // Every mark lives INSIDE the <pre><code> Shiki subtree (code, not prose).
    const pre = container.querySelector('pre')!;
    for (const m of Array.from(host.querySelectorAll('mark'))) {
      expect(pre.contains(m)).toBe(true);
      expect(m.getAttribute('data-anchor-kind')).toBe('code');
    }
    unmount();
  });

  it('re-rendering the SAME revision is idempotent (no duplicate/stale marks)', async () => {
    const content = 'one two three';
    const model = buildAnchorModel(content);
    const s = model.canonicalText.indexOf('two');
    const high = hl(s, s + 3, 'x', 'two');

    const { host, rerender, unmount } = await renderReact(
      createElement(MarkdownContent, { content, highlights: [high] }),
    );
    expect(markTexts(host)).toEqual(['two']);
    await rerender(
      createElement(MarkdownContent, { content, highlights: [high] }),
    );
    // Still exactly one mark — no accumulation from a post-commit sweep.
    expect(markTexts(host)).toEqual(['two']);
    unmount();
  });
});
