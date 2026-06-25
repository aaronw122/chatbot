// Shared DOM test harness for the B4 selection/sequence/fallback fixtures.
//
// These helpers render the REAL `MarkdownContent` (and `Message`) React output
// into a happy-dom document so tests can construct genuine browser `Range`s over
// the rendered nodes and run the REAL `domCapture`/`highlightCapture` against
// them — proving the capture/projection round-trips rather than faking the DOM
// contract. NOT a `.test` file, so vitest does not collect it.

import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const SHOW_TEXT = 4; // NodeFilter.SHOW_TEXT (avoid relying on the global enum)

export interface Rendered {
  /** The host element the React root mounted into. */
  host: HTMLElement;
  /** The MarkdownContent outer <div> — the capture `container`. */
  container: HTMLElement;
  root: Root;
  /** Re-render the SAME root with new props (streaming/sequence tests). */
  rerender: (element: ReactElement) => Promise<void>;
  unmount: () => void;
}

/** Mount a React element into a fresh happy-dom host and return handles. */
export async function renderReact(element: ReactElement): Promise<Rendered> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(element);
  });
  const rerender = async (next: ReactElement): Promise<void> => {
    await act(async () => {
      root.render(next);
    });
  };
  const unmount = (): void => {
    act(() => {
      root.unmount();
    });
    host.remove();
  };
  return {
    host,
    container: host.firstElementChild as HTMLElement,
    root,
    rerender,
    unmount,
  };
}

/**
 * Find the FIRST text node under `root` whose value contains `needle`, plus the
 * index where `needle` starts inside that node. Throws if not found so a broken
 * fixture fails loudly instead of silently mis-anchoring.
 */
export function findTextNode(root: HTMLElement, needle: string): [Text, number] {
  const walker = root.ownerDocument.createTreeWalker(root, SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    const idx = (node.nodeValue ?? '').indexOf(needle);
    if (idx >= 0) return [node, idx];
    node = walker.nextNode() as Text | null;
  }
  throw new Error(`text node not found for needle ${JSON.stringify(needle)}`);
}

/**
 * Find the Nth (0-based) text node under `root` whose value EQUALS `value`
 * exactly. Shiki splits code into one text node per token, so token text appears
 * verbatim and unsplit — this lets a test address e.g. the SECOND "const".
 */
export function nthExactTextNode(
  root: HTMLElement,
  value: string,
  n: number,
): Text {
  const walker = root.ownerDocument.createTreeWalker(root, SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  let seen = 0;
  while (node) {
    if (node.nodeValue === value) {
      if (seen === n) return node;
      seen += 1;
    }
    node = walker.nextNode() as Text | null;
  }
  throw new Error(
    `text node #${n} with value ${JSON.stringify(value)} not found`,
  );
}

/** The first text node inside the rendered KaTeX wrapper (for math endpoints). */
export function firstKatexTextNode(root: HTMLElement): Text {
  const katex = root.querySelector('.katex, .katex-display') as HTMLElement | null;
  if (!katex) throw new Error('no .katex wrapper rendered');
  const node = katex.ownerDocument
    .createTreeWalker(katex, SHOW_TEXT)
    .nextNode() as Text | null;
  if (!node) throw new Error('katex wrapper has no text node');
  return node;
}

/**
 * Build a Range from a (startNeedle, startDelta) .. (endNeedle, endDelta) pair,
 * where each delta is added to the index of the needle inside its found text
 * node. This lets a test express a selection in terms of the visible text.
 */
export function rangeBetween(
  root: HTMLElement,
  start: { needle: string; delta?: number },
  end: { needle: string; delta?: number },
): Range {
  const [sNode, sIdx] = findTextNode(root, start.needle);
  const [eNode, eIdx] = findTextNode(root, end.needle);
  const range = root.ownerDocument.createRange();
  range.setStart(sNode, sIdx + (start.delta ?? 0));
  range.setEnd(eNode, eIdx + (end.delta ?? 0));
  return range;
}

/** Collect the visible text of every declarative <mark> in document order. */
export function markedTexts(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('mark')).map(
    (m) => m.textContent ?? '',
  );
}

/** Convenience: createElement wrapper kept local to avoid importing React twice. */
export function h(...args: Parameters<typeof createElement>): ReactElement {
  return createElement(...args);
}
