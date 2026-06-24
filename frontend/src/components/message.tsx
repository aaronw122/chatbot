import { useLayoutEffect, useRef, useState } from "react";
import type { MessageProps } from "../../../types/types";
import { computePosition, offset, flip, shift } from "@floating-ui/dom";
import Markdown from "react-markdown";
import { Check, Copy } from "lucide-react";
import { useMini } from "@/context/miniContext";
import services from "../services/index";
import {
  rangeToFlatOffsets,
  computeMarkSegments,
  type HighlightInput,
} from "@/lib/textOffsets";

// data-attribute used to find/clean marks we injected, so the layout-effect is
// idempotent (re-running unwraps the previous pass before re-applying).
const MARK_ATTR = "data-branch-mark";

const Message = ({ role, content, id, highlights = [] }: MessageProps) => {
  const replyRef = useRef<HTMLButtonElement>(null);
  // assistant content container — the SAME node used for offset capture (B.1)
  // and for the mark-render sweep (B.3), so the coordinate space round-trips.
  const contentRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const mini = useMini();

  if (!mini) throw new Error("useMini didnt work");

  const show = (el: HTMLElement) => {
    el.style.display = "block";
  };
  const hide = (el: HTMLElement) => {
    el.style.display = "none";
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable; ignore
    }
  };

  // --- B.3: open the branch for a clicked mark segment --------------------
  // `covering` is specificity-ordered (smallest range, then most-recent) so
  // covering[0] is the most-specific branch for an overlap region.
  const openBranch = async (h: HighlightInput) => {
    mini.setMiniOpen(true);
    mini.setMiniMessage(null);
    // reopening an existing branch: load its saved history, not a fresh anchor
    mini.setSourceMessageId(null);
    mini.setHighlightRange(null);
    mini.setSelectedText(null);
    mini.setQuote(h.quote);
    mini.setMiniConvoId(h.branchConvoId);
    try {
      const messages = await services.getMessages(h.branchConvoId);
      mini.setMiniChatHistory(messages ?? null);
    } catch {
      mini.setMiniChatHistory(null);
    }
  };

  // --- B.3: post-render DOM pass that wraps highlight ranges in <mark> -----
  // Runs in a layout effect (decoupled from react-markdown internals) so it
  // re-applies whenever content or highlights change, after the markdown DOM is
  // present. A highlight may cross element boundaries (paragraphs/code blocks);
  // computeMarkSegments returns one segment per covered Text-node sub-range, so
  // we wrap per piece rather than assuming a single span.
  useLayoutEffect(() => {
    const container = contentRef.current;
    if (!container || role !== "assistant") return;

    // 1. Clean up any marks from a previous pass (idempotent).
    const previous = container.querySelectorAll(`mark[${MARK_ATTR}]`);
    previous.forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize(); // re-merge split text nodes for a clean baseline
    });

    if (highlights.length === 0) return;

    const inputs: HighlightInput[] = highlights.map((h) => ({
      id: h.id,
      branchConvoId: h.branchConvoId,
      startOffset: h.startOffset,
      endOffset: h.endOffset,
      quote: h.quote,
    }));

    const segments = computeMarkSegments(container, inputs);
    if (segments.length === 0) return;

    // 2. Wrap each segment. Process per Text node, splitting right-to-left so
    // earlier offsets stay valid as we split. Group segments by node first.
    const byNode = new Map<Text, typeof segments>();
    for (const seg of segments) {
      const list = byNode.get(seg.node);
      if (list) list.push(seg);
      else byNode.set(seg.node, [seg]);
    }

    for (const [node, segs] of byNode) {
      // descending nodeStart so splitText offsets remain valid
      const ordered = [...segs].sort((a, b) => b.nodeStart - a.nodeStart);
      for (const seg of ordered) {
        const full = node.nodeValue ?? "";
        if (seg.nodeStart < 0 || seg.nodeEnd > full.length) continue;
        // Split off the tail (after the segment) so `node` ends at nodeEnd,
        // then split at nodeStart so `middle` is exactly the segment text.
        if (seg.nodeEnd < full.length) node.splitText(seg.nodeEnd);
        const middle = node.splitText(seg.nodeStart);
        // `middle` now holds exactly the segment text.
        const mark = document.createElement("mark");
        mark.setAttribute(MARK_ATTR, "true");
        // shade scales with coverage depth: brand green (--primary) at
        // increasing strength — deeper overlap = darker. color-mix keeps it
        // theme-aware (light/dark) instead of a hardcoded rgba.
        const pct = Math.min(18 + (seg.depth - 1) * 22, 85);
        mark.style.backgroundColor = `color-mix(in oklch, var(--primary) ${pct}%, transparent)`;
        mark.style.color = "inherit";
        mark.style.borderRadius = "2px";
        mark.style.cursor = "pointer";
        mark.style.padding = "0 1px";
        mark.title = seg.covering[0]?.quote ?? "";
        const target = seg.covering[0];
        if (target) {
          mark.addEventListener("click", (e) => {
            e.stopPropagation();
            void openBranch(target);
          });
        }
        const parent = middle.parentNode;
        if (parent) {
          parent.replaceChild(mark, middle);
          mark.appendChild(middle);
        }
      }
    }
    // Re-run whenever the rendered content or this message's highlights change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, role, JSON.stringify(highlights)]);

  const mouseUpHandler = async () => {
    const replyButton = replyRef.current;
    if (!replyButton) return;

    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    if (!selection || !selectedText || selectedText.length === 0) {
      hide(replyButton);
      return;
    }

    //get first node of selected text
    const range = selection.getRangeAt(0);
    const rect = range.getClientRects()[0];
    if (!rect) return hide(replyButton);
    //library computes position of the selection
    await computePosition({ getBoundingClientRect: () => rect }, replyButton, {
      placement: "top",
      middleware: [offset(8), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      Object.assign(replyButton.style, { left: `${x}px`, top: `${y}px` });
    });
    show(replyButton);
  };

  // --- B.1: capture the selection as flat offsets when reply is clicked ---
  const handleReplyClick = () => {
    const container = contentRef.current;
    const selection = window.getSelection();
    const text = selection?.toString().trim();

    if (text && container && selection && selection.rangeCount > 0 && id) {
      const range = selection.getRangeAt(0);
      const flat = rangeToFlatOffsets(container, range);
      if (flat) {
        // The exact substring in the captured coordinate space (may differ
        // from the trimmed display string by leading/trailing whitespace).
        const quote = (selection.toString() || text).trim();
        mini.setSourceMessageId(id);
        mini.setHighlightRange(flat);
        mini.setQuote(quote);
        // fresh branch: clear any reopened-branch state
        mini.setSelectedText(quote);
        mini.setMiniOpen(true);
        mini.setMiniChatHistory(null);
        mini.setMiniConvoId(null);
        mini.setMiniMessage(null);
      }
    }
    window.getSelection()?.removeAllRanges();
    hide(replyRef.current!);
  };

  return role === "user" ? (
    <div className="ml-auto max-w-[80%] rounded-2xl bg-card px-4 py-2.5 text-card-foreground whitespace-pre-wrap">
      {content}
    </div>
  ) : (
    <div className="group" onMouseUp={() => mouseUpHandler()}>
      <div
        ref={contentRef}
        className="prose prose-sm prose-neutral max-w-none text-foreground"
      >
        <Markdown>{content}</Markdown>
      </div>
      <div className="mt-1 flex h-6 items-center opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy message"
          title={copied ? "Copied" : "Copy"}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </button>
      </div>
      <button
        ref={replyRef}
        style={{ position: "fixed", display: "none" }}
        className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-md hover:opacity-90"
        onClick={handleReplyClick}
      >
        reply
      </button>
    </div>
  );
};

export default Message;
