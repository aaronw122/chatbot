import { describe, expect, it } from 'vitest';

import type { AnchorModel, Leaf } from './anchorModel';
import { buildAnchorModel } from './anchorModel';

/** The single UTF-16 unit every math atom occupies (U+FFFC). */
const M = '￼';

/**
 * Assert the structural invariants of the v2 contract for ANY model:
 *  - every leaf round-trips: `canonicalText.slice(start,end) === value`
 *  - leaves are contiguous and cover exactly `[0, canonicalText.length)`
 *  - math leaves are exactly the single U+FFFC unit and carry `tex`
 *  - non-math leaves never carry `tex`
 */
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

/** Convenience: strip positional fields for value/kind comparison. */
function shape(leaves: Leaf[]): Array<Omit<Leaf, 'start' | 'end'>> {
  return leaves.map(({ kind, value, tex }) =>
    tex === undefined ? { kind, value } : { kind, value, tex },
  );
}

describe('buildAnchorModel — golden v2 fixtures', () => {
  it('plain prose', () => {
    const model = buildAnchorModel('hello world');
    expect(model.canonicalText).toBe('hello world');
    expect(model.leaves).toEqual<Leaf[]>([
      { kind: 'prose', value: 'hello world', start: 0, end: 11 },
    ]);
    assertInvariants(model);
  });

  it('backslash-escaped markdown delimiters stay literal prose (not math)', () => {
    // Source bytes: `price \$5 and \(x\) escaped`
    // `\$` -> literal `$`; `\(`/`\)` here are GENUINE escapes only when the
    // delimiter does not form a complete math run... but `\(x\)` IS a complete
    // run, so to test the escape path we escape the leading backslash itself.
    const model = buildAnchorModel('price \\$5 then \\\\(not math\\\\)');
    // `\$` -> `$`; `\\(` -> `\` + literal `(`; `\\)` -> `\` + literal `)`.
    expect(model.canonicalText).toBe('price $5 then \\(not math\\)');
    expect(shape(model.leaves)).toEqual([
      { kind: 'prose', value: 'price $5 then \\(not math\\)' },
    ]);
    assertInvariants(model);
  });

  it('inline code containing math-like delimiters stays code (no math node)', () => {
    const model = buildAnchorModel('a `\\(x\\)` b');
    expect(model.canonicalText).toBe('a \\(x\\) b');
    expect(shape(model.leaves)).toEqual([
      { kind: 'prose', value: 'a ' },
      { kind: 'code', value: '\\(x\\)' },
      { kind: 'prose', value: ' b' },
    ]);
    expect(model.leaves.some((l) => l.kind === 'math')).toBe(false);
    assertInvariants(model);
  });

  it('fenced code containing $ math stays code with whitespace preserved', () => {
    const model = buildAnchorModel('```\n$x$\nline2\n```');
    expect(model.canonicalText).toBe('$x$\nline2');
    expect(shape(model.leaves)).toEqual([
      { kind: 'code', value: '$x$\nline2' },
    ]);
    expect(model.leaves.some((l) => l.kind === 'math')).toBe(false);
    assertInvariants(model);
  });

  it('inline $x$ math -> single U+FFFC with tex captured', () => {
    const model = buildAnchorModel('a $x$ b');
    expect(model.canonicalText).toBe(`a ${M} b`);
    expect(shape(model.leaves)).toEqual([
      { kind: 'prose', value: 'a ' },
      { kind: 'math', value: M, tex: 'x' },
      { kind: 'prose', value: ' b' },
    ]);
    assertInvariants(model);
  });

  it('display $$x$$ math -> single U+FFFC with tex captured', () => {
    const model = buildAnchorModel('a $$x$$ b');
    expect(model.canonicalText).toBe(`a ${M} b`);
    expect(shape(model.leaves)).toEqual([
      { kind: 'prose', value: 'a ' },
      { kind: 'math', value: M, tex: 'x' },
      { kind: 'prose', value: ' b' },
    ]);
    assertInvariants(model);
  });

  it('inline \\(x\\) math -> single U+FFFC with tex captured', () => {
    const model = buildAnchorModel('a \\(x\\) b');
    expect(model.canonicalText).toBe(`a ${M} b`);
    expect(shape(model.leaves)).toEqual([
      { kind: 'prose', value: 'a ' },
      { kind: 'math', value: M, tex: 'x' },
      { kind: 'prose', value: ' b' },
    ]);
    assertInvariants(model);
  });

  it('display \\[x\\] math -> single U+FFFC with tex captured', () => {
    const model = buildAnchorModel('a \\[x\\] b');
    expect(model.canonicalText).toBe(`a ${M} b`);
    expect(shape(model.leaves)).toEqual([
      { kind: 'prose', value: 'a ' },
      { kind: 'math', value: M, tex: 'x' },
      { kind: 'prose', value: ' b' },
    ]);
    assertInvariants(model);
  });

  it('\\(...\\) tex preserves internal backslashes', () => {
    const model = buildAnchorModel('\\(\\frac{a}{b}\\)');
    expect(model.canonicalText).toBe(M);
    expect(shape(model.leaves)).toEqual([
      { kind: 'math', value: M, tex: '\\frac{a}{b}' },
    ]);
    assertInvariants(model);
  });

  it('incomplete streaming \\[ delimiter (no closer) remains prose', () => {
    const model = buildAnchorModel('... \\[ \\text{Beta}');
    // No closing `\]`: the `\[` falls back to character-escape, decoding to `[`.
    expect(model.canonicalText).toBe('... [ \\text{Beta}');
    expect(shape(model.leaves)).toEqual([
      { kind: 'prose', value: '... [ \\text{Beta}' },
    ]);
    expect(model.leaves.some((l) => l.kind === 'math')).toBe(false);
    assertInvariants(model);
  });

  it('incomplete streaming \\( delimiter (no closer) remains prose', () => {
    // CommonMark trims trailing whitespace of the final text node, so the
    // canonical prose ends at `+` — the point is that NO math node is created.
    const model = buildAnchorModel('half arrived \\(x + ');
    expect(model.canonicalText).toBe('half arrived (x +');
    expect(shape(model.leaves)).toEqual([
      { kind: 'prose', value: 'half arrived (x +' },
    ]);
    expect(model.leaves.some((l) => l.kind === 'math')).toBe(false);
    assertInvariants(model);
  });

  it('mixed prose + math ($ and backslash) + code: contiguous offsets round-trip', () => {
    const model = buildAnchorModel('Let $a$ be `code` and \\[b\\] done');
    expect(model.canonicalText).toBe(`Let ${M} be code and ${M} done`);
    expect(model.leaves).toEqual<Leaf[]>([
      { kind: 'prose', value: 'Let ', start: 0, end: 4 },
      { kind: 'math', value: M, start: 4, end: 5, tex: 'a' },
      { kind: 'prose', value: ' be ', start: 5, end: 9 },
      { kind: 'code', value: 'code', start: 9, end: 13 },
      { kind: 'prose', value: ' and ', start: 13, end: 18 },
      { kind: 'math', value: M, start: 18, end: 19, tex: 'b' },
      { kind: 'prose', value: ' done', start: 19, end: 24 },
    ]);
    assertInvariants(model);
  });

  it('structural nodes (heading, list, paragraphs) contribute nothing themselves', () => {
    const src = '# Title $x$\n\n- one `c`\n- two \\(y\\)';
    const model = buildAnchorModel(src);
    // Headings/list wrappers add no separators; only inline leaves contribute.
    expect(model.canonicalText).toBe(`Title ${M}one ctwo ${M}`);
    expect(shape(model.leaves)).toEqual([
      { kind: 'prose', value: 'Title ' },
      { kind: 'math', value: M, tex: 'x' },
      { kind: 'prose', value: 'one ' },
      { kind: 'code', value: 'c' },
      { kind: 'prose', value: 'two ' },
      { kind: 'math', value: M, tex: 'y' },
    ]);
    assertInvariants(model);
  });
});

describe('buildAnchorModel — global invariants', () => {
  const corpus = [
    '',
    'hello world',
    'a $x$ b',
    'a $$x$$ b',
    'a \\(x\\) b',
    'a \\[x\\] b',
    'price \\$5 then \\\\(not math\\\\)',
    'a `\\(x\\)` b',
    '```\n$x$\nline2\n```',
    '... \\[ \\text{Beta}',
    'half arrived \\(x + ',
    'Let $a$ be `code` and \\[b\\] done',
    '# Title $x$\n\n- one `c`\n- two \\(y\\)',
    '\\(\\frac{a}{b}\\)',
    'multi\n\nparagraph $z$ text',
  ];

  for (const src of corpus) {
    it(`round-trips & covers canonicalText: ${JSON.stringify(src)}`, () => {
      const model = buildAnchorModel(src);
      assertInvariants(model);
    });
  }

  it('is deterministic (same input -> identical output)', () => {
    const src = 'Let $a$ be `code` and \\[b\\] done';
    expect(buildAnchorModel(src)).toEqual(buildAnchorModel(src));
  });
});
