// Shared markdown renderer used by BOTH message.tsx and miniMessage.tsx.
//
// Renders markdown with math (KaTeX) + syntax highlighting (Shiki, synchronous
// preinitialized highlighter) and projects persisted branch highlights
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

/** Map persisted highlights to the projection shape. */
function projectHighlights(highlights: Highlight[]): ProjectedHighlight[] {
  return highlights.map((highlight) => ({
    id: highlight.id,
    branchConvoId: highlight.branchConvoId,
    startOffset: highlight.startOffset,
    endOffset: highlight.endOffset,
    quote: highlight.quote,
  }));
}

const MarkdownContent = ({
  content,
  highlights = [],
  onActivateBranch,
}: MarkdownContentProps) => {
  const highlighter = getHighlighter();

  // One immutable model per content revision (coordinate authority).
  const anchorModel = useMemo(() => buildAnchorModel(content), [content]);

  // Projection inputs + a stable id->highlight lookup for delegated clicks.
  // Out-of-range anchors (range doesn't fit the current model) are dropped by
  // the projection itself; no version filtering happens here.
  const { projectedHighlights, highlightsById } = useMemo(() => {
    const highlightLookup = new Map<string, Highlight>();
    for (const highlight of highlights) {
      highlightLookup.set(highlight.id, highlight);
    }
    return {
      projectedHighlights: projectHighlights(highlights),
      highlightsById: highlightLookup,
    };
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
    plugins.push([
      rehypeAnchorMarks,
      { model: anchorModel, highlights: projectedHighlights },
    ]);
    return plugins;
    // `highlighter` is a stable singleton; included for correctness.
  }, [highlighter, anchorModel, projectedHighlights]);

  // Delegated branch activation: marks carry data-branch-id.
  const handleBranchActivation = (
    event: React.MouseEvent | React.KeyboardEvent,
  ): void => {
    if (!onActivateBranch) return;
    const branchElement = (event.target as HTMLElement | null)?.closest?.(
      '[data-branch-id]',
    );
    if (!branchElement) return;
    const branchId = branchElement.getAttribute('data-branch-id');
    if (!branchId) return;
    const highlight = highlightsById.get(branchId);
    if (!highlight) return;
    if (event.type === 'keydown') {
      const key = (event as React.KeyboardEvent).key;
      if (key !== 'Enter' && key !== ' ') return;
      event.preventDefault();
    }
    event.stopPropagation();
    onActivateBranch(highlight);
  };

  return (
    <div
      onClick={onActivateBranch ? handleBranchActivation : undefined}
      onKeyDown={onActivateBranch ? handleBranchActivation : undefined}
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
