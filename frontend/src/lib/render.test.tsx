import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { initHighlighter } from './highlighter';
import MarkdownContent from '../components/MarkdownContent';
import type { Highlight } from '../../../types/types';

beforeAll(async () => { await initHighlighter(); });

function hl(start: number, end: number): Highlight {
  return {
    id: 'h1', messageId: 'm1', branchConvoId: 'c1',
    startOffset: start, endOffset: end, quote: 'q', userId: null,
    createdAt: new Date().toISOString(), anchorVersion: 2,
  };
}

describe('MarkdownContent — full React render', () => {
  it('renders katex, shiki code, and a v2 mark with anchor metadata', () => {
    const md = 'Let $a$ be:\n\n```python\nx = 1\n```\n\nand done';
    // mark 'done' — canonical 'Let ￼ be:x = 1and done'; find via offsets:
    // 'Let '=0..4, math=4..5, ' be:'=5..9, code 'x = 1'=9..14, 'and done'=14..22
    // mark 'done' => [18,22)
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, { content: md, highlights: [hl(18, 22)] }),
    );
    expect(html).toContain('katex'); // math typeset
    expect(html).toContain('shiki'); // code highlighted by shiki
    expect(html).toContain('data-anchor-start'); // leaf metadata present
    expect(html).toMatch(/<mark[^>]*data-branch-id="h1"[^>]*>done<\/mark>/);
  });

  it('math leaf gets atomic mark on the katex wrapper when covered', () => {
    const md = 'a $x$ b'; // math [2,3)
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, { content: md, highlights: [hl(2, 3)] }),
    );
    // katex wrapper carries data-branch-mark and is NOT split (single katex span)
    expect(html).toMatch(/class="katex[^"]*"[^>]*data-anchor-kind="math"/);
    expect(html).toContain('data-branch-mark="true"');
  });

  // Regression: `\(...\)` / `\[...\]` math must render via KaTeX AND keep the v2
  // cursor in sync, so a highlight AFTER the math lands on the right text. The
  // renderer's remark pipeline must share the model's backslash-math parse.
  it('renders inline \\(...\\) via KaTeX and aligns a highlight after it', () => {
    // canonical: "The value ￼ equals four always." (prose[0,10) math[10,11)
    // prose[11,31)); "four" -> [19,23).
    const md = 'The value \\(x^2\\) equals four always.';
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, { content: md, highlights: [hl(19, 23)] }),
    );
    // math actually typeset (the original product bug — was literal prose before)
    expect(html).toContain('katex');
    expect(html).not.toContain('\\(x^2\\)'); // not left as literal text
    // and "four" is correctly marked (cursor stayed aligned past the math unit)
    expect(html).toMatch(/<mark[^>]*data-branch-id="h1"[^>]*>four<\/mark>/);
  });

  it('renders display \\[...\\] via KaTeX and aligns a highlight after it', () => {
    // canonical: "Area ￼ done" (prose[0,5) math[5,6) prose[6,11)); "done" ->[7,11)
    const md = 'Area \\[ \\text{Beta}(r,b) \\] done';
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, { content: md, highlights: [hl(7, 11)] }),
    );
    // display math typeset by KaTeX, annotated as the atomic math leaf (NOT left
    // as the literal `\[ … \]` delimiters in prose). KaTeX keeps the TeX in an
    // <annotation>, so we assert on the wrapper, not the absence of TeX.
    expect(html).toContain('katex-display');
    expect(html).toContain('data-anchor-kind="math"');
    expect(html).not.toContain('\\['); // delimiter not rendered literally
    expect(html).toMatch(/<mark[^>]*data-branch-id="h1"[^>]*>done<\/mark>/);
  });
});
