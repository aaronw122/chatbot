/**
 * IMMUTABLE v2 ANCHOR CONTRACT — `buildAnchorModel`
 * =================================================
 *
 * `buildAnchorModel(rawMarkdown)` is the single, pure, deterministic source of
 * truth for v2 canonical coordinates. Its output is consumed UNCHANGED by branch
 * capture, persistence validation, and rendering. The pipeline below is FIXED:
 *
 *   1. Parse raw CommonMark + GFM + math with a real parser (unified /
 *      remark-parse + remark-gfm + remark-math) to get an mdast. The raw string
 *      is NEVER regex-normalized or mutated.
 *   2. A syntax-aware micromark extension (see `backslashMathExtension` below)
 *      recognizes unescaped `\(...\)` (inline) and `\[...\]` (display) math at the
 *      PARSER level — `remark-math` only handles `$...$` / `$$...$$`. The
 *      extension runs as a `text` construct competing with CommonMark's
 *      character-escape, so code spans, fenced/indented code, and
 *      backslash-escaped delimiters are excluded structurally, and incomplete /
 *      unmatched delimiters fall back to ordinary text.
 *   3. Walk the mdast depth-first in document order, emitting immutable leaves:
 *        - prose text  -> parser-DECODED text value
 *        - code (inline + fenced/indented) -> exact parser code value (whitespace
 *          and newlines preserved)
 *        - math (inline/display) -> the single UTF-16 unit U+FFFC ('￼') as
 *          `value`; the TeX source is stored in `tex`
 *        - structural nodes contribute nothing; we recurse into their children.
 *   4. `canonicalText` is the direct concatenation of leaf `value`s with NO
 *      inserted separators. Each leaf `[start, end)` is a UTF-16 index range into
 *      `canonicalText`, so `canonicalText.slice(start, end) === value` and the
 *      leaves are contiguous and cover `[0, canonicalText.length)`.
 *
 * WHY a parser-level extension (and not a post-parse text transform): CommonMark
 * resolves backslash escapes during tokenization, so by the time an mdast `text`
 * node exists, `\(` has already been decoded to the literal `(`. A post-parse
 * transform on decoded text CANNOT distinguish a math `\(` from an escaped `\(`
 * — the information is gone. The delimiters must therefore be recognized BEFORE
 * escape resolution, which is exactly what a micromark `text` construct does.
 *
 * This algorithm and its output are the single immutable coordinate contract.
 * Persisted offsets are interpreted only through this model; an anchor whose
 * range no longer fits the current model is dropped, never relocated. ANY future
 * change to the parser, delimiter set, decoding, whitespace handling, traversal
 * order, or the math unit that can alter coordinates would require a deliberate
 * re-anchoring strategy — never reinterpret persisted offsets in place.
 */

import type { Root, RootContent } from 'mdast';
import type {
  Code as MathConstruct,
  Effects,
  Extension as MicromarkExtension,
  State,
  TokenizeContext,
} from 'micromark-util-types';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

/** Object Replacement Character — the single UTF-16 unit every math atom occupies. */
const MATH_PLACEHOLDER = '￼';

const BACKSLASH: MathConstruct = 92; // '\'
const LEFT_PAREN: MathConstruct = 40; // '('
const RIGHT_PAREN: MathConstruct = 41; // ')'
const LEFT_BRACKET: MathConstruct = 91; // '['
const RIGHT_BRACKET: MathConstruct = 93; // ']'

/**
 * True for micromark line-ending codes. micromark preprocesses the source so
 * line endings (LF, CR, CRLF) become negative codes (< -2) BEFORE a tokenizer
 * sees them — a real `\n` never arrives as char code 10. A `text` construct must
 * emit each line ending as its own `lineEnding` token (it cannot swallow one into
 * a flat token), or the document's text-content subtokenizer corrupts its splice
 * buffer and throws a RangeError. Mirrors `markdownLineEnding` from
 * `micromark-util-character`; inlined to avoid taking a transitive dep directly.
 */
function isLineEnding(code: MathConstruct): boolean {
  return code !== null && code < -2;
}

export type LeafKind = 'prose' | 'code' | 'math';

export interface Leaf {
  kind: LeafKind;
  value: string;
  /** Inclusive UTF-16 start index into `canonicalText`. */
  start: number;
  /** Exclusive UTF-16 end index into `canonicalText`. */
  end: number;
  /** TeX source, present only on `kind: 'math'` leaves. */
  tex?: string;
}

export interface AnchorModel {
  canonicalText: string;
  leaves: Leaf[];
}

/**
 * micromark `text` construct that recognizes unescaped `\(...\)` and `\[...\]`.
 *
 * Registered under the backslash character code, it competes with CommonMark's
 * `characterEscape`. On a match it emits a `backslashMath` token whose inner
 * `backslashMathValue` token carries the raw TeX; on no match it returns `nok`,
 * letting the normal escape handling run (so `\$`, an escaped `\(`, etc. decode
 * as usual). The TeX is read back from the source by the mdast handler below.
 */
function tokenizeBackslashMath(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  let closingDelimiter: MathConstruct;

  return start;

  // The `\(...\)` / `\[...\]` run is emitted as an outer `backslashMath` token
  // wrapping inner `backslashMathMarker` (the two-char open/close delimiters),
  // `backslashMathData` (content runs), and `lineEnding` (each newline) tokens.
  // Mirroring micromark's own `codeText`, EVERY code lives inside an inner token
  // — no untokenized gaps — and line endings are their own tokens. Both are
  // mandatory: the document's text-content subtokenizer corrupts its splice
  // buffer (a RangeError on multi-line input) when a `text` construct swallows a
  // line ending or leaves gaps spanning one. The mdast handler below recovers the
  // TeX by slicing the whole serialized token and stripping the 2-char
  // delimiters, so the inner token types are only there to satisfy micromark.
  function start(code: MathConstruct): State | undefined {
    // `code` is the backslash that keyed this construct.
    effects.enter('backslashMath' as 'data');
    effects.enter('backslashMathMarker' as 'data');
    effects.consume(code);
    return afterOpenBackslash;
  }

  function afterOpenBackslash(code: MathConstruct): State | undefined {
    if (code === LEFT_PAREN) {
      closingDelimiter = RIGHT_PAREN;
    } else if (code === LEFT_BRACKET) {
      closingDelimiter = RIGHT_BRACKET;
    } else {
      // Not a math opener — `nok` discards this attempt's events entirely, so the
      // unbalanced marker token we entered above is rolled back automatically.
      return nok(code);
    }
    effects.consume(code);
    effects.exit('backslashMathMarker' as 'data');
    return between;
  }

  // Between inner tokens: dispatch on line ending / possible closer / content.
  function between(code: MathConstruct): State | undefined {
    if (code === null) {
      // EOF before a close delimiter: not math; fall back to escape handling.
      return nok(code);
    }
    if (isLineEnding(code)) {
      effects.enter('lineEnding');
      effects.consume(code);
      effects.exit('lineEnding');
      return between;
    }
    if (code === BACKSLASH) {
      // Could be the closing `\)` / `\]`; open a marker and look ahead one code.
      effects.enter('backslashMathMarker' as 'data');
      effects.consume(code);
      return afterContentBackslash;
    }
    effects.enter('backslashMathData' as 'data');
    return data(code);
  }

  function data(code: MathConstruct): State | undefined {
    if (code === null || isLineEnding(code) || code === BACKSLASH) {
      effects.exit('backslashMathData' as 'data');
      return between(code);
    }
    effects.consume(code);
    return data;
  }

  // A backslash was consumed inside an open marker token; decide closer vs content.
  function afterContentBackslash(code: MathConstruct): State | undefined {
    if (code === closingDelimiter) {
      effects.consume(code);
      effects.exit('backslashMathMarker' as 'data');
      effects.exit('backslashMath' as 'data');
      return ok;
    }
    // Not a closer: that backslash was content (e.g. a LaTeX command or `\\`).
    // Close its marker and re-dispatch the current code through `between`.
    effects.exit('backslashMathMarker' as 'data');
    return between(code);
  }
}

const backslashMathExtension: MicromarkExtension = {
  text: {
    [BACKSLASH]: {
      name: 'backslashMath',
      tokenize: tokenizeBackslashMath,
    },
  },
};

/**
 * mdast-from-markdown extension turning `backslashMath` tokens into standard
 * `inlineMath` / `math` mdast nodes (matching `mdast-util-math` shapes), so the
 * tree walker treats `$...$` and `\(...\)` uniformly.
 */
interface FromMarkdownToken {
  type: string;
  start: { offset: number };
  end: { offset: number };
}
interface FromMarkdownContext {
  enter(node: Record<string, unknown>, token: FromMarkdownToken): void;
  exit(token: FromMarkdownToken): void;
  sliceSerialize(token: FromMarkdownToken): string;
  stack: Array<Record<string, unknown>>;
}

const backslashMathFromMarkdown = {
  enter: {
    backslashMath(this: FromMarkdownContext, token: FromMarkdownToken) {
      // `raw` is the whole run, e.g. `\(x\)` or `\[x\]`. Strip the 2-char open
      // and 2-char close delimiters to recover the TeX; `\[` => display math.
      const raw = this.sliceSerialize(token);
      const display = raw.startsWith('\\[');
      const tex = raw.slice(2, -2);
      // CRITICAL: set the SAME `data.hName`/`hProperties`/`hChildren` that
      // `mdast-util-math` puts on `$...$` / `$$...$$` nodes. `buildAnchorModel`
      // ignores `data` (it reads only `type`/`value`), but the RENDERER runs
      // remark-rehype, which needs this metadata to emit a
      // `<code class="language-math …">` (display: wrapped in `<pre>`) that
      // `rehype-katex` then typesets. Without it the node falls back to plain
      // text and `\(…\)`/`\[…\]` render literally — desyncing the v2 cursor.
      const data = display
        ? {
            hName: 'pre',
            hChildren: [
              {
                type: 'element',
                tagName: 'code',
                properties: { className: ['language-math', 'math-display'] },
                children: [{ type: 'text', value: tex }],
              },
            ],
          }
        : {
            hName: 'code',
            hProperties: { className: ['language-math', 'math-inline'] },
            hChildren: [{ type: 'text', value: tex }],
          };
      this.enter(
        {
          type: display ? 'math' : 'inlineMath',
          meta: null,
          value: tex,
          data,
        },
        token,
      );
    },
  },
  exit: {
    backslashMath(this: FromMarkdownContext, token: FromMarkdownToken) {
      this.exit(token);
    },
  },
};

/**
 * Reusable remark plugin registering the backslash-math micromark + fromMarkdown
 * extensions. This is the SINGLE shared parse semantics for `\(...\)` / `\[...\]`
 * math: the model (`buildAnchorModel`) AND the renderer (`MarkdownContent`'s
 * react-markdown pipeline) MUST both use it, so they produce identical
 * `inlineMath` / `math` nodes. Diverging them desyncs the v2 coordinate cursor.
 *
 * Use it alongside `remarkGfm` + `remarkMath` (it only adds the backslash forms;
 * `$...$` / `$$...$$` stay with `remark-math`).
 */
export function remarkBackslashMath(this: {
  data(key: string): unknown[];
}): void {
  const data = this.data;
  const micromarkExtensions =
    (data.call(this, 'micromarkExtensions') as unknown[]) ?? [];
  const fromMarkdownExtensions =
    (data.call(this, 'fromMarkdownExtensions') as unknown[]) ?? [];
  micromarkExtensions.push(backslashMathExtension);
  fromMarkdownExtensions.push(backslashMathFromMarkdown);
}

/** Lazily-built processor so `buildAnchorModel` stays pure & allocation-light. */
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkBackslashMath);

type MdastNode = Root | RootContent;

interface NodeWithValue {
  value: string;
}
interface NodeWithChildren {
  children: MdastNode[];
}

function hasValue(node: MdastNode): node is MdastNode & NodeWithValue {
  return typeof (node as Partial<NodeWithValue>).value === 'string';
}
function hasChildren(node: MdastNode): node is MdastNode & NodeWithChildren {
  return Array.isArray((node as Partial<NodeWithChildren>).children);
}

const CODE_TYPES = new Set(['code', 'inlineCode']);
const MATH_TYPES = new Set(['math', 'inlineMath']);
const PROSE_TYPES = new Set(['text']);

/**
 * Build the immutable v2 anchor model from raw markdown.
 *
 * Pure, deterministic, side-effect-free.
 */
export function buildAnchorModel(rawMarkdown: string): AnchorModel {
  const tree = processor.parse(rawMarkdown) as Root;
  processor.runSync(tree);

  const leaves: Leaf[] = [];
  let canonicalText = '';

  const appendLeaf = (kind: LeafKind, value: string, tex?: string): void => {
    if (value.length === 0) return;
    const start = canonicalText.length;
    canonicalText += value;
    const end = canonicalText.length;
    const leaf: Leaf = { kind, value, start, end };
    if (tex !== undefined) leaf.tex = tex;
    leaves.push(leaf);
  };

  const visitNode = (node: MdastNode): void => {
    if (MATH_TYPES.has(node.type)) {
      const tex = hasValue(node) ? node.value : '';
      appendLeaf('math', MATH_PLACEHOLDER, tex);
      return;
    }
    if (CODE_TYPES.has(node.type)) {
      appendLeaf('code', hasValue(node) ? node.value : '');
      return;
    }
    if (PROSE_TYPES.has(node.type)) {
      appendLeaf('prose', hasValue(node) ? node.value : '');
      return;
    }
    // Structural node: contributes nothing itself; recurse in document order.
    if (hasChildren(node)) {
      for (const child of node.children) visitNode(child);
    }
  };

  visitNode(tree);

  return { canonicalText, leaves };
}
