// Shared v2 markdown renderer used by BOTH message.tsx and miniMessage.tsx.
//
// Renders markdown with math (KaTeX) + syntax highlighting (Shiki, synchronous
// preinitialized highlighter) and projects persisted v2 branch highlights
// DECLARATIVELY inside the same React tree — no post-commit DOM mutation.
//
// Coordinate authority: `buildAnchorModel(content)` (see anchorModel.ts). The
// `rehypeAnchorMarks` plugin aligns the rendered hast to that model, emitting
// <mark>/<span> segments + `data-anchor-*` leaf-span metadata (the DOM contract
// capture + B4 tests read). Branch activation is delegated: marks carry a
// `data-branch-id`; one container-level click/keydown handler resolves the id to
// the highlight and calls `onActivateBranch`. Each render is pure from
// (content, highlights); streaming a new `content` builds a fresh model + tree.

import { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeShikiFromHighlighter from '@shikijs/rehype/core';
import type { Highlight } from '../../../types/types';
import { buildAnchorModel, remarkBackslashMath } from '@/lib/anchorModel';
import {
  getHighlighter,
  SHIKI_FALLBACK_LANG,
  SHIKI_THEME,
} from '@/lib/highlighter';
import { rehypeAnchorMarks } from '@/lib/rehypeAnchorMarks';
import type { ProjectedHighlight } from '@/lib/highlightProjection';

export interface MarkdownContentProps {
  content: string;
  highlights?: Highlight[];
  /** Activate (open) the branch for a clicked/keyed mark. */
  onActivateBranch?: (highlight: Highlight) => void;
}

/** Map persisted highlights to the projection shape (v2 ranges only). */
function toProjected(highlights: Highlight[]): ProjectedHighlight[] {
  return highlights
    .filter((h) => h.anchorVersion === 2)
    .map((h) => ({
      id: h.id,
      branchConvoId: h.branchConvoId,
      startOffset: h.startOffset,
      endOffset: h.endOffset,
      quote: h.quote,
    }));
}

const MarkdownContent = ({
  content,
  highlights = [],
  onActivateBranch,
}: MarkdownContentProps) => {
  const highlighter = getHighlighter();

  // One immutable model per content revision (coordinate authority).
  const model = useMemo(() => buildAnchorModel(content), [content]);

  // v2 projection inputs + a stable id->highlight lookup for delegated clicks.
  const { projected, byId } = useMemo(() => {
    const v2 = highlights.filter((h) => h.anchorVersion === 2);
    const map = new Map<string, Highlight>();
    for (const h of v2) map.set(h.id, h);
    return { projected: toProjected(v2), byId: map };
  }, [highlights]);

  const rehypePlugins = useMemo(() => {
    const plugins: NonNullable<
      React.ComponentProps<typeof Markdown>['rehypePlugins']
    > = [rehypeKatex];
    if (highlighter) {
      plugins.push([
        rehypeShikiFromHighlighter,
        highlighter,
        {
          theme: SHIKI_THEME,
          fallbackLanguage: SHIKI_FALLBACK_LANG,
        },
      ]);
    }
    // Anchor marks run LAST so it sees KaTeX + Shiki output.
    plugins.push([rehypeAnchorMarks, { model, highlights: projected }]);
    return plugins;
    // `highlighter` is a stable singleton; included for correctness.
  }, [highlighter, model, projected]);

  // Delegated branch activation: marks carry data-branch-id.
  const handleActivate = (e: React.MouseEvent | React.KeyboardEvent): void => {
    if (!onActivateBranch) return;
    const target = (e.target as HTMLElement | null)?.closest?.(
      '[data-branch-id]',
    );
    if (!target) return;
    const id = target.getAttribute('data-branch-id');
    if (!id) return;
    const highlight = byId.get(id);
    if (!highlight) return;
    if (e.type === 'keydown') {
      const key = (e as React.KeyboardEvent).key;
      if (key !== 'Enter' && key !== ' ') return;
      e.preventDefault();
    }
    e.stopPropagation();
    onActivateBranch(highlight);
  };

  return (
    <div
      onClick={onActivateBranch ? handleActivate : undefined}
      onKeyDown={onActivateBranch ? handleActivate : undefined}
    >
      <Markdown
        // remarkBackslashMath MUST match the model's parse: it turns
        // `\(...\)`/`\[...\]` into the same inlineMath/math nodes the model emits
        // and rehype-katex consumes — without it those forms render as prose and
        // desync the v2 cursor in rehypeAnchorMarks.
        remarkPlugins={[remarkGfm, remarkMath, remarkBackslashMath]}
        rehypePlugins={rehypePlugins}
      >
        {content}
      </Markdown>
    </div>
  );
};

export default MarkdownContent;
