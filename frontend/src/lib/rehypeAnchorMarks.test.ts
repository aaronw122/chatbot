import { beforeAll, describe, expect, it } from 'vitest';
import type { Element, Root, RootContent } from 'hast';
import type { Highlighter } from 'shiki';
import { createHighlighter } from 'shiki';
import rehypeKatex from 'rehype-katex';
import rehypeShikiFromHighlighter from '@shikijs/rehype/core';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

import { buildAnchorModel } from './anchorModel';
import { rehypeAnchorMarks } from './rehypeAnchorMarks';
import type { ProjectedHighlight } from './highlightProjection';

let highlighter: Highlighter;

beforeAll(async () => {
  highlighter = await createHighlighter({
    themes: ['github-light'],
    langs: ['plaintext', 'python'],
  });
});

/** Build the final hast (katex + shiki applied) from markdown. */
function toHast(md: string): Root {
  const mdast = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .parse(md);
  const hast = unified().use(remarkRehype).runSync(mdast) as Root;
  unified().use(rehypeKatex).runSync(hast);
  unified()
    .use(rehypeShikiFromHighlighter, highlighter, { theme: 'github-light' })
    .runSync(hast);
  return hast;
}

function applyMarks(
  hast: Root,
  md: string,
  highlights: ProjectedHighlight[],
): Root {
  const model = buildAnchorModel(md);
  rehypeAnchorMarks({ model, highlights })(hast);
  return hast;
}

/** Collect all <mark> elements in document order. */
function marks(tree: Root): Element[] {
  const out: Element[] = [];
  const walk = (n: Root | RootContent): void => {
    if (n.type === 'element') {
      if (n.tagName === 'mark') out.push(n);
      n.children.forEach(walk);
    } else if ('children' in n && Array.isArray(n.children)) {
      n.children.forEach(walk);
    }
  };
  walk(tree);
  return out;
}

/** Find the first element whose className includes `cls`. */
function findByClass(tree: Root, cls: string): Element | null {
  let found: Element | null = null;
  const walk = (n: Root | RootContent): void => {
    if (found) return;
    if (n.type === 'element') {
      const cn = n.properties?.className;
      const list = Array.isArray(cn) ? cn.map(String) : [];
      if (list.includes(cls)) {
        found = n;
        return;
      }
      n.children.forEach(walk);
    } else if ('children' in n && Array.isArray(n.children)) {
      n.children.forEach(walk);
    }
  };
  walk(tree);
  return found;
}

function textOf(n: Element): string {
  let s = '';
  const walk = (x: Element | RootContent): void => {
    if (x.type === 'text') s += x.value;
    else if (x.type === 'element') x.children.forEach(walk);
  };
  n.children.forEach(walk);
  return s;
}

function hl(id: string, start: number, end: number): ProjectedHighlight {
  return { id, branchConvoId: `b-${id}`, startOffset: start, endOffset: end, quote: `q-${id}` };
}

describe('rehypeAnchorMarks — prose marks', () => {
  it('wraps the covered prose substring in a <mark> with anchor metadata', () => {
    const md = 'hello world';
    const model = buildAnchorModel(md);
    expect(model.canonicalText).toBe('hello world');
    const tree = applyMarks(toHast(md), md, [hl('a', 6, 11)]);
    const ms = marks(tree);
    expect(ms).toHaveLength(1);
    expect(textOf(ms[0])).toBe('world');
    expect(ms[0].properties?.['data-anchor-kind']).toBe('prose');
    expect(ms[0].properties?.['data-branch-id']).toBe('a');
    expect(ms[0].properties?.role).toBe('button');
  });

  it('no highlights -> no marks, but leaves are still annotated', () => {
    const md = 'hello world';
    const tree = applyMarks(toHast(md), md, []);
    expect(marks(tree)).toHaveLength(0);
    // every prose leaf is wrapped in a span carrying data-anchor-start.
    let annotated = false;
    const walk = (n: Root | RootContent): void => {
      if (n.type === 'element') {
        if (n.properties?.['data-anchor-start'] !== undefined) annotated = true;
        n.children.forEach(walk);
      } else if ('children' in n && Array.isArray(n.children)) {
        n.children.forEach(walk);
      }
    };
    walk(tree);
    expect(annotated).toBe(true);
  });
});

describe('rehypeAnchorMarks — segment metadata for capture round-trip', () => {
  it('every prose/code segment carries an absolute canonical seg-start', () => {
    // "hello world" with mark [6,11): segments are plain "hello "[0,6) + mark
    // "world"[6,11). The trailing-segment fix means the plain span's seg-start is
    // its OWN absolute canonical offset, not the leaf start.
    const md = 'one two three';
    // mark "two" -> [4,7)
    const tree = applyMarks(toHast(md), md, [hl('a', 4, 7)]);
    // collect all elements carrying data-anchor-seg-start with their text.
    const segs: Array<{ start: number; text: string }> = [];
    const walk = (n: Root | RootContent): void => {
      if (n.type === 'element') {
        const s = n.properties?.['data-anchor-seg-start'];
        if (s !== undefined) {
          segs.push({ start: Number(s), text: textOf(n) });
        }
        n.children.forEach(walk);
      } else if ('children' in n && Array.isArray(n.children)) {
        n.children.forEach(walk);
      }
    };
    walk(tree);
    // seg-start must equal the canonical index of each segment's first char.
    for (const seg of segs) {
      const canonAt = 'one two three'.slice(seg.start, seg.start + seg.text.length);
      expect(canonAt).toBe(seg.text);
    }
    // and the trailing plain segment " three" starts at canonical 7, not 0.
    const trailing = segs.find((s) => s.text === ' three');
    expect(trailing?.start).toBe(7);
  });
});

describe('rehypeAnchorMarks — atomic math', () => {
  it('annotates the katex wrapper with its math-unit span and never splits descendants', () => {
    const md = 'a $x$ b';
    const model = buildAnchorModel(md);
    // math unit at [2,3)
    const tree = applyMarks(toHast(md), md, [hl('m', 2, 3)]);
    const katex = findByClass(tree, 'katex');
    expect(katex).not.toBeNull();
    expect(katex!.properties?.['data-anchor-kind']).toBe('math');
    expect(Number(katex!.properties?.['data-anchor-start'])).toBe(2);
    expect(Number(katex!.properties?.['data-anchor-end'])).toBe(3);
    expect(katex!.properties?.['data-branch-mark']).toBe('true');
    expect(katex!.properties?.['data-branch-id']).toBe('m');
    // No <mark> elements created for math (atomic styling on the wrapper).
    expect(marks(tree)).toHaveLength(0);
    void model;
  });

  it('does not mark the katex wrapper when no range covers the unit', () => {
    const md = 'a $x$ b';
    const tree = applyMarks(toHast(md), md, [hl('m', 0, 2)]); // only 'a '
    const katex = findByClass(tree, 'katex');
    expect(katex!.properties?.['data-branch-mark']).toBeUndefined();
    // but it is still annotated with its span
    expect(Number(katex!.properties?.['data-anchor-start'])).toBe(2);
  });
});

describe('rehypeAnchorMarks — code across Shiki tokens', () => {
  it('marks code substrings across Shiki token boundaries with exact text', () => {
    const md = '```python\nx = 1\n```';
    const model = buildAnchorModel(md);
    expect(model.canonicalText).toBe('x = 1');
    // mark the whole code leaf [0,5)
    const tree = applyMarks(toHast(md), md, [hl('c', 0, 5)]);
    const ms = marks(tree);
    // Shiki splits 'x = 1' into tokens; concatenated marked text must equal it.
    expect(ms.map(textOf).join('')).toBe('x = 1');
    for (const m of ms) {
      expect(m.properties?.['data-anchor-kind']).toBe('code');
    }
  });

  it('marks only a sub-range of code preserving whitespace', () => {
    const md = '```python\nx = 1\n```';
    // mark '= 1' -> canonical [2,5)
    const tree = applyMarks(toHast(md), md, [hl('c', 2, 5)]);
    const ms = marks(tree);
    expect(ms.map(textOf).join('')).toBe('= 1');
  });
});

describe('rehypeAnchorMarks — mixed content alignment', () => {
  it('aligns prose + math + code without coordinate drift', () => {
    const md = 'Let $a$ be `code` ok';
    const model = buildAnchorModel(md);
    // canonical: "Let ￼ be code ok"; mark 'code' -> code leaf
    const codeLeaf = model.leaves.find((l) => l.kind === 'code')!;
    const tree = applyMarks(toHast(md), md, [
      hl('c', codeLeaf.start, codeLeaf.end),
    ]);
    const ms = marks(tree);
    expect(ms.map(textOf).join('')).toBe('code');
    expect(ms.every((m) => m.properties?.['data-anchor-kind'] === 'code')).toBe(
      true,
    );
    // katex wrapper present and annotated, unmarked
    const katex = findByClass(tree, 'katex');
    expect(katex!.properties?.['data-branch-mark']).toBeUndefined();
  });
});
