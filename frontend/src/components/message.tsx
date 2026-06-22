import { useRef, useState } from "react";
import type { MessageProps } from "../../../types/types";
import { computePosition, offset, flip, shift } from "@floating-ui/dom";
import Markdown from "react-markdown";
import { Check, Copy } from "lucide-react";
import { useMini } from "@/context/miniContext";

const Message = ({ role, content }: MessageProps) => {
  const replyRef = useRef<HTMLButtonElement>(null);
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

  return role === "user" ? (
    <div className="ml-auto max-w-[80%] rounded-2xl bg-card px-4 py-2.5 text-card-foreground whitespace-pre-wrap">
      {content}
    </div>
  ) : (
    <div className="group" onMouseUp={() => mouseUpHandler()}>
      <div className="prose prose-sm prose-neutral max-w-none text-foreground">
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
        onClick={() => {
          const text = window.getSelection()?.toString().trim();
          if (text && mini) {
            mini.setSelectedText(text);
            mini.setMiniOpen(true);
            mini.setMiniChatHistory(null);
            mini.setMiniConvoId(null);
            mini.setMiniMessage(null);
          }
          window.getSelection()?.removeAllRanges();
          hide(replyRef.current!);
        }}
      >
        reply
      </button>
    </div>
  );
};

export default Message;
