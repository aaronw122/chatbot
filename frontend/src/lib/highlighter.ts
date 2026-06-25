// Shiki highlighter singleton (synchronous render path, fine-grained bundle).
//
// The §3 execution model (locked) requires the Markdown render + declarative
// highlight projection to complete in ONE synchronous React render. Shiki's
// default rehype plugin is async, so we preinitialize a highlighter ONCE during
// bootstrap (`main.tsx`) and hand the resolved instance to the SYNCHRONOUS
// transformer (`rehypeShikiFromHighlighter` from `@shikijs/rehype/core`).
//
// We use the FINE-GRAINED core API (`shiki/core`) with an explicit, BOUNDED set
// of grammar + theme imports and the pure-JS engine (no Oniguruma wasm). This
// keeps the bundle small and loads exactly the languages we declare (lazy
// loading disabled — everything is eagerly imported here). Each grammar object
// carries its own aliases, so `ts`/`js`/`shell` code fences still resolve.
// Unknown languages fall back to plain code (`SHIKI_FALLBACK_LANG`), never crash.

import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

import githubLight from '@shikijs/themes/github-light';
import bash from '@shikijs/langs/bash';
import css from '@shikijs/langs/css';
import html from '@shikijs/langs/html';
import javascript from '@shikijs/langs/javascript';
import jsx from '@shikijs/langs/jsx';
import json from '@shikijs/langs/json';
import markdown from '@shikijs/langs/markdown';
import python from '@shikijs/langs/python';
import sql from '@shikijs/langs/sql';
import tsx from '@shikijs/langs/tsx';
import typescript from '@shikijs/langs/typescript';

/** Theme used everywhere; Shiki inlines its colors, so no theme stylesheet. */
export const SHIKI_THEME = 'github-light';

/** Plain-code fallback language for unknown/absent code-fence languages. */
export const SHIKI_FALLBACK_LANG = 'plaintext';

let highlighterInstance: HighlighterCore | null = null;
let initPromise: Promise<HighlighterCore> | null = null;

/**
 * Create + cache the Shiki highlighter. Idempotent: repeated calls return the
 * same in-flight or resolved instance. Call (and `await`) ONCE before mounting
 * the React root so renders can run synchronously.
 */
export async function initHighlighter(): Promise<HighlighterCore> {
  if (highlighterInstance) return highlighterInstance;
  if (initPromise) return initPromise;
  initPromise = createHighlighterCore({
    themes: [githubLight],
    langs: [
      typescript,
      tsx,
      javascript,
      jsx,
      json,
      python,
      bash,
      sql,
      html,
      css,
      markdown,
    ],
    engine: createJavaScriptRegexEngine(),
  }).then((hl) => {
    highlighterInstance = hl;
    return hl;
  });
  return initPromise;
}

/**
 * The resolved highlighter, or null if bootstrap hasn't finished. The renderer
 * tolerates null (renders plain code) so a render before init can never crash.
 */
export function getHighlighter(): HighlighterCore | null {
  return highlighterInstance;
}
