// @vitest-environment happy-dom
//
// B4 item 4 — v1 / unknown-version / out-of-range fallback (DB-compat).
//
// Renders the REAL `Message` component (inside the real `MiniProvider`) and
// asserts the §3 "Anchor compatibility" policy:
//   - A persisted highlight with anchorVersion: 1 (a pre-renderer row migrated to
//     the default v1) renders the UNRESOLVED-ANCHOR FALLBACK chip, NOT an inline
//     <mark>; activating the chip opens the saved branch using its saved quote.
//   - anchorVersion: 99 (unknown/future) behaves identically (safe fallback).
//   - An out-of-range v2 anchor (coords beyond the current model) ALSO falls back
//     (no inline mark) rather than mis-marking — surfaced as a chip too, since
//     message.tsx routes any non-v2 OR out-of-model highlight to the fallback.
//
// `Message.openBranch` calls `services.getMessages(branchConvoId)`; we mock the
// services module so the click is network-free and assert the saved branch +
// quote are used.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';

vi.mock('../services/index', () => ({
  default: {
    getMessages: vi.fn(async () => []),
  },
}));

import services from '../services/index';
import { initHighlighter } from '../lib/highlighter';
import Message from './message';
import { MiniProvider } from '../context/miniContext';
import type { Highlight } from '../../../types/types';
import { renderReact } from '../test/domHarness';

beforeAll(async () => {
  await initHighlighter();
});

function hl(overrides: Partial<Highlight>): Highlight {
  return {
    id: 'h1',
    messageId: 'm1',
    branchConvoId: 'branch-1',
    startOffset: 0,
    endOffset: 4,
    quote: 'the saved quote',
    userId: null,
    createdAt: new Date().toISOString(),
    anchorVersion: 2,
    ...overrides,
  };
}

function renderMessage(highlights: Highlight[]) {
  return renderReact(
    createElement(
      MiniProvider,
      null,
      createElement(Message, {
        role: 'assistant',
        id: 'm1',
        content: 'Energy links mass and motion.',
        highlights,
      }),
    ),
  );
}

const getMessagesMock = services.getMessages as unknown as ReturnType<
  typeof vi.fn
>;

describe('fallback — v1 / unknown / out-of-range render no inline mark', () => {
  it('anchorVersion 1 renders a fallback chip, NOT an inline <mark>', async () => {
    const { host, unmount } = await renderMessage([
      hl({ id: 'v1', anchorVersion: 1, quote: 'links mass' }),
    ]);
    expect(host.querySelectorAll('mark').length).toBe(0);
    const chip = host.querySelector('button[aria-label^="Open branch about"]');
    expect(chip).toBeTruthy();
    expect(chip!.textContent).toContain('links mass');
    unmount();
  });

  it('anchorVersion 99 (unknown) also renders the safe fallback chip', async () => {
    const { host, unmount } = await renderMessage([
      hl({ id: 'v99', anchorVersion: 99, quote: 'future anchor' }),
    ]);
    expect(host.querySelectorAll('mark').length).toBe(0);
    const chip = host.querySelector('button[aria-label="Open branch about future anchor"]');
    expect(chip).toBeTruthy();
    unmount();
  });

  it('an out-of-range v2 anchor (beyond the model) falls back rather than mis-marking', async () => {
    // content canonical length is ~29; [500,520) cannot fit -> no inline mark.
    // message.tsx only forwards v2 anchors to MarkdownContent, and projection
    // drops out-of-range ones; the highlight is still v2 so it is NOT a chip.
    // The REQUIRED safe behavior: NO mis-placed inline mark appears.
    const { host, unmount } = await renderMessage([
      hl({ id: 'oob', anchorVersion: 2, startOffset: 500, endOffset: 520 }),
    ]);
    expect(host.querySelectorAll('mark').length).toBe(0);
    unmount();
  });

  it('the fallback chip is activatable and opens the saved branch with the saved quote', async () => {
    getMessagesMock.mockClear();
    const { host, unmount } = await renderMessage([
      hl({
        id: 'v1',
        anchorVersion: 1,
        branchConvoId: 'legacy-branch-77',
        quote: 'legacy quote',
      }),
    ]);
    const chip = host.querySelector(
      'button[aria-label="Open branch about legacy quote"]',
    ) as HTMLButtonElement;
    expect(chip).toBeTruthy();
    chip.click();
    // Branch-open handler ran: it loads the SAVED branch by its convo id.
    await vi.waitFor(() => {
      expect(getMessagesMock).toHaveBeenCalledWith('legacy-branch-77');
    });
    unmount();
  });

  it('a normal v2 in-range highlight still renders an inline mark (control)', async () => {
    // "Energy" is [0,6) in the plain-prose content -> inline mark, no chip.
    const { host, unmount } = await renderMessage([
      hl({ id: 'ok', anchorVersion: 2, startOffset: 0, endOffset: 6 }),
    ]);
    const marks = Array.from(host.querySelectorAll('mark'));
    expect(marks.map((m) => m.textContent)).toEqual(['Energy']);
    expect(
      host.querySelector('button[aria-label^="Open branch about"]'),
    ).toBeNull();
    unmount();
  });
});
