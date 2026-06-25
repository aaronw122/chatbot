import { describe, expect, it } from 'vitest';

import {
  captureRangeFromEndpoints,
  type CaptureEndpoint,
} from './highlightCapture';

// Model context for these endpoints (mirrors `buildAnchorModel('a $x$ be `c`')`):
//   prose 'a '   [0,2)
//   math  ￼      [2,3)   tex 'x'
//   prose ' be '  [3,7)
//   code  'c'    [7,8)
const PROSE_A: Omit<CaptureEndpoint, 'offsetInLeaf'> = {
  leafStart: 0,
  leafEnd: 2,
  kind: 'prose',
};
const MATH: Omit<CaptureEndpoint, 'offsetInLeaf'> = {
  leafStart: 2,
  leafEnd: 3,
  kind: 'math',
};
const PROSE_BE: Omit<CaptureEndpoint, 'offsetInLeaf'> = {
  leafStart: 3,
  leafEnd: 7,
  kind: 'prose',
};
const CODE: Omit<CaptureEndpoint, 'offsetInLeaf'> = {
  leafStart: 7,
  leafEnd: 8,
  kind: 'code',
};

function ep(
  base: Omit<CaptureEndpoint, 'offsetInLeaf'>,
  offsetInLeaf: number,
): CaptureEndpoint {
  return { ...base, offsetInLeaf };
}

describe('captureRangeFromEndpoints — prose', () => {
  it('maps a plain prose selection to canonical offsets', () => {
    // start at 'a '[0], end at 'a '[2] -> [0,2)
    expect(captureRangeFromEndpoints(ep(PROSE_A, 0), ep(PROSE_A, 2))).toEqual({
      start: 0,
      end: 2,
    });
  });

  it('maps a prose selection spanning into code', () => {
    // ' be ' offset 1 -> canonical 4 ; code offset 1 -> canonical 8
    expect(captureRangeFromEndpoints(ep(PROSE_BE, 1), ep(CODE, 1))).toEqual({
      start: 4,
      end: 8,
    });
  });

  it('clamps an offset past the leaf end', () => {
    expect(captureRangeFromEndpoints(ep(PROSE_A, 0), ep(PROSE_A, 99))).toEqual({
      start: 0,
      end: 2,
    });
  });
});

describe('captureRangeFromEndpoints — atomic math normalization', () => {
  it('a wholly-math selection captures the whole formula', () => {
    // both endpoints inside math -> [leafStart, leafEnd) = [2,3)
    expect(captureRangeFromEndpoints(ep(MATH, 0), ep(MATH, 1))).toEqual({
      start: 2,
      end: 3,
    });
  });

  it('start inside math snaps to BEFORE the atom', () => {
    // start math, end prose ' be ' offset 2 -> start=2, end=5
    expect(captureRangeFromEndpoints(ep(MATH, 0), ep(PROSE_BE, 2))).toEqual({
      start: 2,
      end: 5,
    });
  });

  it('end inside math snaps to AFTER the atom (prose<->math includes formula)', () => {
    // start prose 'a ' offset 0, end inside math -> start=0, end=3
    expect(captureRangeFromEndpoints(ep(PROSE_A, 0), ep(MATH, 0))).toEqual({
      start: 0,
      end: 3,
    });
  });
});

describe('captureRangeFromEndpoints — code (exact, non-atomic)', () => {
  it('captures exact code-text coordinates', () => {
    // wholly inside the single-char code leaf 'c' [7,8)
    expect(captureRangeFromEndpoints(ep(CODE, 0), ep(CODE, 1))).toEqual({
      start: 7,
      end: 8,
    });
  });
});

describe('captureRangeFromEndpoints — rejection & reversal', () => {
  it('rejects an empty range after normalization', () => {
    expect(captureRangeFromEndpoints(ep(PROSE_A, 1), ep(PROSE_A, 1))).toBeNull();
  });

  it('rejects a collapsed selection inside a single math atom edge', () => {
    // both endpoints math but normalization keeps [2,3) — NOT empty, so valid.
    // (A truly empty case: same prose offset.)
    expect(captureRangeFromEndpoints(ep(PROSE_BE, 2), ep(PROSE_BE, 2))).toBeNull();
  });

  it('handles a reversed selection (end before start) by swapping', () => {
    // DOM hands us start=code[1]=8, end=prose 'a '[0]=0 -> normalized [0,8)
    expect(captureRangeFromEndpoints(ep(CODE, 1), ep(PROSE_A, 0))).toEqual({
      start: 0,
      end: 8,
    });
  });
});
