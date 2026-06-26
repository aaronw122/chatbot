import { useRef, useState } from "react";
import type { Highlight, MessageProps } from "../../../types/types";
import { computePosition, offset, flip, shift } from "@floating-ui/dom";
import { Check, Copy } from "lucide-react";
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

  const handleSelectionMouseUp = async () => {
    const replyButton = replyRef.current;
    if (!replyButton) return;

    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    if (!selection || !selectedText || selectedText.length === 0) {
      hideReplyButton(replyButton);
      return;
    }

    //get first node of selected text
    const selectionRange = selection.getRangeAt(0);
    const selectionRect = selectionRange.getClientRects()[0];
    if (!selectionRect) return hideReplyButton(replyButton);
    //library computes position of the selection
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

  // Capture the selection as canonical offsets when reply is clicked. Maps the
  // DOM Range back into the model via leaf-span metadata (domCapture), applying
  // atomic-math endpoint normalization.
  const handleReplyClick = () => {
    const contentContainer = contentRef.current;
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    if (
      selectedText &&
      contentContainer &&
      selection &&
      selection.rangeCount > 0 &&
      id
    ) {
      const selectionRange = selection.getRangeAt(0);
      const highlightRange = rangeToAnchorOffsets(
        contentContainer,
        selectionRange,
      );
      if (highlightRange) {
        const quote = (selection.toString() || selectedText).trim();
        miniContext.setSourceMessageId(id);
        miniContext.setHighlightRange(highlightRange);
        miniContext.setQuote(quote);
        miniContext.setSelectedText(quote);
        miniContext.setMiniOpen(true);
        miniContext.setMiniChatHistory(null);
        miniContext.setMiniConvoId(null);
        miniContext.setMiniMessage(null);
      }
    }
    window.getSelection()?.removeAllRanges();
    hideReplyButton(replyRef.current!);
  };

  return role === "user" ? (
    <div className="ml-auto max-w-[80%] rounded-2xl bg-card px-4 py-2.5 text-base text-card-foreground whitespace-pre-wrap">
      {content}
    </div>
  ) : (
    <div className="group" onMouseUp={() => handleSelectionMouseUp()}>
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
