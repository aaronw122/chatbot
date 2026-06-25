import { useMemo, useRef, useState } from "react";
import type { Highlight, MessageProps } from "../../../types/types";
import { computePosition, offset, flip, shift } from "@floating-ui/dom";
import { Check, Copy, GitBranch } from "lucide-react";
import { useMini } from "@/context/miniContext";
import TypingDots from "./typingDots";
import services from "../services/index";
import MarkdownContent from "./MarkdownContent";
import { rangeToAnchorOffsets } from "@/lib/domCapture";

const Message = ({ role, content, id, highlights = [] }: MessageProps) => {
  const replyRef = useRef<HTMLButtonElement>(null);
  // assistant content container — the SAME node used for v2 selection capture
  // (read-only DOM->model mapping) and reply-button positioning. The renderer
  // owns all marks declaratively, so this ref is NEVER mutated post-commit.
  const contentRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const mini = useMini();

  if (!mini) throw new Error("useMini didnt work");

  // v1/unknown-version (or out-of-model) highlights get NO inline mark — they
  // render as unobtrusive unresolved-anchor affordances below the message so the
  // legacy branch stays reachable without mis-anchoring (plan "Anchor
  // compatibility"). Only v2 anchors flow into MarkdownContent for projection.
  const { v2Highlights, unresolvedHighlights } = useMemo(() => {
    const v2: Highlight[] = [];
    const unresolved: Highlight[] = [];
    for (const h of highlights) {
      if (h.anchorVersion === 2) v2.push(h);
      else unresolved.push(h);
    }
    return { v2Highlights: v2, unresolvedHighlights: unresolved };
  }, [highlights]);

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

  // Open the branch for a highlight (inline v2 mark OR unresolved fallback).
  // Reopening loads the branch's saved history, not a fresh anchor.
  const openBranch = async (h: Highlight) => {
    mini.setMiniOpen(true);
    mini.setMiniMessage(null);
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

  // Capture the selection as v2 canonical offsets when reply is clicked. Maps the
  // DOM Range back into the model via leaf-span metadata (domCapture), applying
  // atomic-math endpoint normalization. New captures persist anchorVersion: 2.
  const handleReplyClick = () => {
    const container = contentRef.current;
    const selection = window.getSelection();
    const text = selection?.toString().trim();

    if (text && container && selection && selection.rangeCount > 0 && id) {
      const range = selection.getRangeAt(0);
      const anchored = rangeToAnchorOffsets(container, range);
      if (anchored) {
        const quote = (selection.toString() || text).trim();
        mini.setSourceMessageId(id);
        mini.setHighlightRange(anchored);
        mini.setQuote(quote);
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
        {content.trim() === "" ? (
          <TypingDots />
        ) : (
          <MarkdownContent
            content={content}
            highlights={v2Highlights}
            onActivateBranch={openBranch}
          />
        )}
      </div>
      {unresolvedHighlights.length > 0 && (
        // Unresolved-anchor fallback for legacy (v1/unknown) branches: subtle
        // chips below the message that open the saved branch on click/keyboard.
        <div className="mt-2 flex flex-wrap gap-1.5">
          {unresolvedHighlights.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => void openBranch(h)}
              title={`Open branch about "${h.quote}"`}
              aria-label={`Open branch about ${h.quote}`}
              className="inline-flex max-w-[16rem] items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate">{h.quote}</span>
            </button>
          ))}
        </div>
      )}
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
