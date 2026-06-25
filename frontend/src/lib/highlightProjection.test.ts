import { describe, expect, it } from 'vitest';

import { buildAnchorModel } from './anchorModel';
import {
  fittingHighlights,
  markBackground,
  projectHighlights,
  type ProjectedHighlight,
} from './highlightProjection';

const M = '￼';

function hl(
  id: string,
  start: number,
  end: number,
  extra: Partial<ProjectedHighlight> = {},
): ProjectedHighlight {
  return {
    id,
    branchConvoId: `b-${id}`,
    startOffset: start,
    endOffset: end,
    quote: extra.quote ?? `q-${id}`,
  };
}

describe('projectHighlights — prose/code segmentation', () => {
  it('splits a prose leaf into unmarked + marked + unmarked segments', () => {
    // "hello world" -> mark [6,11) ("world")
    const model = buildAnchorModel('hello world');
    const proj = projectHighlights(model, [hl('a', 6, 11)]);
    expect(proj).toHaveLength(1);
    const p = proj[0];
    expect(p.marked).toBe(true);
    expect(p.segments.map((s) => [s.text, s.depth])).toEqual([
      ['hello ', 0],
      ['world', 1],
    ]);
    expect(p.segments[1].covering[0].id).toBe('a');
  });

  it('marks across a prose/code/prose boundary as per-leaf segments', () => {
    // "Let a be code and b done"-ish — use plain text + code fence inline.
    const model = buildAnchorModel('say `code` now'); // prose 'say ', code 'code', prose ' now'
    // canonical: "say code now" -> code at [4,8)
    expect(model.canonicalText).toBe('say code now');
    const proj = projectHighlights(model, [hl('a', 2, 10)]); // 'y cod...e n'
    // prose 'say ': split at 2 -> ['sa',0]['y ',1]
    expect(proj[0].segments.map((s) => [s.text, s.depth])).toEqual([
      ['sa', 0],
      ['y ', 1],
    ]);
    // code 'code': fully covered [4,8)
    expect(proj[1].leaf.kind).toBe('code');
    expect(proj[1].segments.map((s) => [s.text, s.depth])).toEqual([
      ['code', 1],
    ]);
    // prose ' now': covered [8,10) -> ' n' then 'ow'
    expect(proj[2].segments.map((s) => [s.text, s.depth])).toEqual([
      [' n', 1],
      ['ow', 0],
    ]);
  });

  it('overlapping highlights increase coverage depth and order by specificity', () => {
    const model = buildAnchorModel('abcdefgh');
    // big [0,8), small [2,5)
    const proj = projectHighlights(model, [hl('big', 0, 8), hl('small', 2, 5)]);
    const segs = proj[0].segments;
    // expect ['ab' depth1] ['cde' depth2] ['fgh' depth1]
    expect(segs.map((s) => [s.text, s.depth])).toEqual([
      ['ab', 1],
      ['cde', 2],
      ['fgh', 1],
    ]);
    // most-specific (smallest range) first in the depth-2 segment
    expect(segs[1].covering[0].id).toBe('small');
    expect(segs[1].covering[1].id).toBe('big');
  });
});

describe('projectHighlights — atomic math', () => {
  it('marks the whole math leaf when a range covers its unit', () => {
    const model = buildAnchorModel('a $x$ b'); // prose 'a ', math, prose ' b'
    // math unit at [2,3)
    const proj = projectHighlights(model, [hl('m', 2, 3)]);
    expect(proj[1].leaf.kind).toBe('math');
    expect(proj[1].marked).toBe(true);
    expect(proj[1].segments).toHaveLength(1);
    expect(proj[1].segments[0].text).toBe(M);
    expect(proj[1].segments[0].depth).toBe(1);
  });

  it('a prose<->math range marks both the prose and the whole formula', () => {
    const model = buildAnchorModel('a $x$ b');
    // [0,3): 'a ' + math unit
    const proj = projectHighlights(model, [hl('m', 0, 3)]);
    expect(proj[0].segments.map((s) => [s.text, s.depth])).toEqual([
      ['a ', 1],
    ]);
    expect(proj[1].marked).toBe(true); // math fully marked
  });

  it('does not mark math when range stops before its unit', () => {
    const model = buildAnchorModel('a $x$ b');
    const proj = projectHighlights(model, [hl('m', 0, 2)]); // only 'a '
    expect(proj[1].marked).toBe(false);
  });
});

describe('fittingHighlights — only in-range v2 anchors project', () => {
  it('drops out-of-range and inverted ranges', () => {
    const model = buildAnchorModel('hello'); // len 5
    const fit = fittingHighlights(model, [
      hl('ok', 0, 5),
      hl('over', 0, 6),
      hl('neg', -1, 3),
      hl('empty', 2, 2),
      hl('inv', 4, 2),
    ]);
    expect(fit.map((h) => h.id)).toEqual(['ok']);
  });
});

describe('markBackground — coverage-depth styling', () => {
  it('scales with depth and clamps', () => {
    expect(markBackground(1)).toContain('18%');
    expect(markBackground(2)).toContain('40%');
    expect(markBackground(10)).toContain('85%'); // clamped
  });
});
