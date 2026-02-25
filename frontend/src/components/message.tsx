import { useRef } from "react";
import { Card } from "./ui/card";
import type { MessageProps } from "../../../types/types";
import { computePosition, offset, flip, shift } from "@floating-ui/dom";
import Markdown from "react-markdown";
import { useMini } from "@/context/miniContext";

const Message = ({ role, content }: MessageProps) => {
  const replyRef = useRef<HTMLButtonElement>(null);
  const mini = useMini();
  //fix styling so its right aligned vs left aligned, etc.

  if (!mini) throw new Error('useMini didnt work')

  const show = (el: HTMLElement) => {
    el.style.display = "block";
  };
  const hide = (el: HTMLElement) => {
    el.style.display = "none";
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

    console.log("selected", selectedText);
    console.log("whole text", content);
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
    <Card className="ml-auto px-3.5">{content}</Card>
  ) : (
    <div onMouseUp={() => mouseUpHandler()}>
      <div className="my-3 mr-15 prose prose-sm dark:prose-invert max-w-none">
        <Markdown>{content}</Markdown>
      </div>
      <button
        ref={replyRef}
        style={{ position: "fixed", display: "none" }}
        className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground shadow"
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
        {" "}
        reply{" "}
      </button>
    </div>
  );
};

export default Message;
