// B4 item 5 — buildAnchorModel golden coverage check.
//
// B1's `anchorModel.test.ts` already locks the Verification list: prose, escaped
// Markdown delimiters, inline code + fenced code containing math-like
// delimiters, `$`/`$$` math, `\(`/`\[` math, incomplete streaming delimiters,
// and mixed spans. This file ADDS the remaining permutations the Verification
// bullet implies but B1 does not spell out explicitly — specifically:
//   - FENCED code containing BACKSLASH math-like delimiters (`\[...\]`/`\(...\)`)
//     must stay a single code leaf with NO math node (B1 only had fenced `$`).
//   - INLINE code containing `$...$` / `$$...$$` must stay code (B1 only had
//     inline `\(...\)`).
//   - A `$$...$$` block with multi-line TeX -> one atomic math leaf.
// It does NOT modify or weaken any existing B1 golden.

import { describe, expect, it } from 'vitest';

import type { AnchorModel, Leaf } from './anchorModel';
import { buildAnchorModel } from './anchorModel';

const M = '￼';

function assertInvariants(model: AnchorModel): void {
  let cursor = 0;
  for (const leaf of model.leaves) {
    expect(model.canonicalText.slice(leaf.start, leaf.end)).toBe(leaf.value);
    expect(leaf.start).toBe(cursor);
    expect(leaf.end).toBe(leaf.start + leaf.value.length);
    expect(leaf.value.length).toBeGreaterThan(0);
    if (leaf.kind === 'math') {
      expect(leaf.value).toBe(M);
      expect(typeof leaf.tex).toBe('string');
    } else {
      expect(leaf.tex).toBeUndefined();
    }
    cursor = leaf.end;
  }
  expect(cursor).toBe(model.canonicalText.length);
}

function shape(leaves: Leaf[]): Array<Omit<Leaf, 'start' | 'end'>> {
  return leaves.map(({ kind, value, tex }) =>
    tex === undefined ? { kind, value } : { kind, value, tex },
  );
}

describe('buildAnchorModel — B4 added goldens (no math inside code)', () => {
  it('fenced code containing \\[..\\] and \\(..\\) stays code (no math node)', () => {
    const model = buildAnchorModel('```\n\\[ x \\] and \\(y\\)\nz\n```');
    expect(model.canonicalText).toBe('\\[ x \\] and \\(y\\)\nz');
    expect(shape(model.leaves)).toEqual([
      { kind: 'code', value: '\\[ x \\] and \\(y\\)\nz' },
    ]);
    expect(model.leaves.some((l) => l.kind === 'math')).toBe(false);
    assertInvariants(model);
  });

  it('inline code containing $ and $$ stays code (no math node)', () => {
    const model = buildAnchorModel('a `$x$ and $$y$$` b');
    expect(model.canonicalText).toBe('a $x$ and $$y$$ b');
    expect(shape(model.leaves)).toEqual([
      { kind: 'prose', value: 'a ' },
      { kind: 'code', value: '$x$ and $$y$$' },
      { kind: 'prose', value: ' b' },
    ]);
    expect(model.leaves.some((l) => l.kind === 'math')).toBe(false);
    assertInvariants(model);
  });

  it('fenced ts code containing a $$ string literal stays code', () => {
    const model = buildAnchorModel('```ts\nconst s = "$$x$$";\n```');
    expect(model.canonicalText).toBe('const s = "$$x$$";');
    expect(shape(model.leaves)).toEqual([
      { kind: 'code', value: 'const s = "$$x$$";' },
    ]);
    expect(model.leaves.some((l) => l.kind === 'math')).toBe(false);
    assertInvariants(model);
  });
});

describe('buildAnchorModel — B4 added goldens (math + mixed)', () => {
  it('a $$...$$ block with multi-line TeX is ONE atomic math leaf', () => {
    const model = buildAnchorModel('A\n\n$$\n\\int_0^1 x\n$$\n\nB');
    expect(model.canonicalText).toBe(`A${M}B`);
    expect(shape(model.leaves)).toEqual([
      { kind: 'prose', value: 'A' },
      { kind: 'math', value: M, tex: '\\int_0^1 x' },
      { kind: 'prose', value: 'B' },
    ]);
    assertInvariants(model);
  });

  it('mixed $a$ + \\[b\\] + inline `c$d` + prose round-trips with contiguous offsets', () => {
    const model = buildAnchorModel('Start $a$ mid \\[b\\] then `c$d` end');
    expect(model.canonicalText).toBe(`Start ${M} mid ${M} then c$d end`);
    expect(model.leaves).toEqual<Leaf[]>([
      { kind: 'prose', value: 'Start ', start: 0, end: 6 },
      { kind: 'math', value: M, start: 6, end: 7, tex: 'a' },
      { kind: 'prose', value: ' mid ', start: 7, end: 12 },
      { kind: 'math', value: M, start: 12, end: 13, tex: 'b' },
      { kind: 'prose', value: ' then ', start: 13, end: 19 },
      { kind: 'code', value: 'c$d', start: 19, end: 22 },
      { kind: 'prose', value: ' end', start: 22, end: 26 },
    ]);
    assertInvariants(model);
  });
});
