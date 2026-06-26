import { useRef, useState } from "react";
import type { Highlight, MessageProps } from "../../../types/types";
import { computePosition, offset, flip, shift } from "@floating-ui/dom";
import { Check, Copy } from "lucide-react";
import { useMini } from "@/context/miniContext";
import TypingDots from "./typingDots";
import services from "../services/index";
import MarkdownContent from "./MarkdownContent";
import { rangeToAnchorOffsets } from "@/lib/domCapture";

// Top offset of `rect` within the chat scroll content (the [data-chat-scroll]
// container), so the floating desktop branch panel can anchor to the highlighted
// text and scroll away with it. Returns null when not inside a chat scroll
// region (e.g. the mini-window's own re-rendered markdown).
const chatScrollAnchorTop = (rect: DOMRect, fromEl: Element): number | null => {
  const scrollEl = fromEl.closest<HTMLElement>("[data-chat-scroll]");
  if (!scrollEl) return null;
  const rawTop =
    rect.top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
  // Clamp so the panel opens fully inside the visible scroll area: a highlight
  // low in the viewport would otherwise push the panel's bottom under the
  // composer and clip it. (Once open it still scrolls away with the content.)
  // PANEL_H mirrors miniWindow's h-[500px], shrunk to fit short viewports.
  const MARGIN = 16;
  const PANEL_H = Math.min(500, scrollEl.clientHeight - 2 * MARGIN);
  const minTop = scrollEl.scrollTop + MARGIN;
  const maxTop = scrollEl.scrollTop + scrollEl.clientHeight - PANEL_H - MARGIN;
  return Math.min(Math.max(rawTop, minTop), Math.max(minTop, maxTop));
};

const Message = ({ role, content, id, highlights = [] }: MessageProps) => {
  const replyRef = useRef<HTMLButtonElement>(null);
  // assistant content container — the SAME node used for v2 selection capture
  // (read-only DOM->model mapping) and reply-button positioning. The renderer
  // owns all marks declaratively, so this ref is NEVER mutated post-commit.
  const contentRef = useRef<HTMLDivElement>(null);
  // Branch anchor captured the moment a selection is made (mouseup/touchend).
  // Mobile clears the live selection when the reply button is tapped, so the
  // click handler consumes this snapshot instead of re-reading the selection.
  const pendingBranchRef = useRef<{
    highlightRange: { start: number; end: number };
    quote: string;
    anchorTop: number | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const miniContext = useMini();

  if (!miniContext) throw new Error("useMini didnt work");

  const showReplyButton = (replyButton: HTMLElement) => {
    replyButton.style.display = "block";
  };
  const hideReplyButton = (replyButton: HTMLElement) => {
    replyButton.style.display = "none";
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

  // Open the branch for a highlight's inline mark. Reopening loads the branch's
  // saved history, not a fresh anchor.
  const openHighlightBranch = async (highlight: Highlight) => {
    // Anchor the floating panel beside the clicked mark so it tracks that text.
    const markEl = document.querySelector<HTMLElement>(
      `[data-branch-id="${highlight.id}"]`,
    );
    miniContext.setAnchorTop(
      markEl
        ? chatScrollAnchorTop(markEl.getBoundingClientRect(), markEl)
        : null,
    );
    miniContext.setMiniOpen(true);
    miniContext.setMiniMessage(null);
    miniContext.setSourceMessageId(null);
    miniContext.setHighlightRange(null);
    miniContext.setSelectedText(null);
    miniContext.setQuote(highlight.quote);
    miniContext.setMiniConvoId(highlight.branchConvoId);
    try {
      const messages = await services.getMessages(highlight.branchConvoId);
      miniContext.setMiniChatHistory(messages ?? null);
    } catch {
      miniContext.setMiniChatHistory(null);
    }
  };

  // On selection end (mouse OR touch): capture the branch anchor as canonical
  // offsets immediately — while the selection is guaranteed present — and float
  // the reply button above it. Capturing here (not on click) is what makes
  // mobile work, since tapping the button clears the live selection.
  const handleSelectionEnd = async () => {
    const replyButton = replyRef.current;
    const contentContainer = contentRef.current;
    if (!replyButton) return;

    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    if (
      !selection ||
      !selectedText ||
      selection.rangeCount === 0 ||
      !contentContainer ||
      !id
    ) {
      pendingBranchRef.current = null;
      hideReplyButton(replyButton);
      return;
    }

    const selectionRange = selection.getRangeAt(0);
    const selectionRect = selectionRange.getClientRects()[0];
    // Maps the DOM Range back into the model via leaf-span metadata (domCapture),
    // applying atomic-math endpoint normalization.
    const highlightRange = rangeToAnchorOffsets(contentContainer, selectionRange);
    if (!selectionRect || !highlightRange) {
      pendingBranchRef.current = null;
      hideReplyButton(replyButton);
      return;
    }

    pendingBranchRef.current = {
      highlightRange,
      quote: (selection.toString() || selectedText).trim(),
      anchorTop: chatScrollAnchorTop(
        selectionRange.getBoundingClientRect(),
        contentContainer,
      ),
    };

    await computePosition(
      { getBoundingClientRect: () => selectionRect },
      replyButton,
      {
        placement: "top",
        middleware: [offset(8), flip(), shift({ padding: 8 })],
      },
    ).then(({ x: left, y: top }) => {
      Object.assign(replyButton.style, {
        left: `${left}px`,
        top: `${top}px`,
      });
    });
    showReplyButton(replyButton);
  };

  // Open the branch from the snapshot captured at selection time.
  const handleReplyClick = () => {
    const pending = pendingBranchRef.current;
    if (pending && id) {
      miniContext.setAnchorTop(pending.anchorTop);
      miniContext.setSourceMessageId(id);
      miniContext.setHighlightRange(pending.highlightRange);
      miniContext.setQuote(pending.quote);
      miniContext.setSelectedText(pending.quote);
      miniContext.setMiniOpen(true);
      miniContext.setMiniChatHistory(null);
      miniContext.setMiniConvoId(null);
      miniContext.setMiniMessage(null);
    }
    pendingBranchRef.current = null;
    window.getSelection()?.removeAllRanges();
    hideReplyButton(replyRef.current!);
  };

  return role === "user" ? (
    <div className="ml-auto max-w-[80%] rounded-2xl bg-card px-4 py-2.5 text-base text-card-foreground whitespace-pre-wrap">
      {content}
    </div>
  ) : (
    <div
      className="group"
      onMouseUp={() => handleSelectionEnd()}
      // Touch has no mouseup; defer a tick so the mobile selection finalizes.
      onTouchEnd={() => window.setTimeout(handleSelectionEnd, 0)}
    >
      <div
        ref={contentRef}
        className="prose prose-neutral max-w-none text-foreground"
      >
        {content.trim() === "" ? (
          <TypingDots />
        ) : (
          <MarkdownContent
            content={content}
            highlights={highlights}
            onActivateBranch={openHighlightBranch}
          />
        )}
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
