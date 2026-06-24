import { useEffect, useRef } from "react";
import MiniMessageHistory from "./miniChats";
import MiniInput from "./miniInput";
import { X } from "lucide-react";
import { useMini } from "@/context/miniContext";

const MiniWindow = () => {
  const mini = useMini();

  if (!mini) return null;

  const {
    miniOpen,
    setMiniOpen,
    miniChatHistory,
    setMiniChatHistory,
    selectedText,
    setSelectedText,
    setMiniConvoId,
    setMiniMessage,
  } = mini;

  useEffect(() => {
    setMiniChatHistory(null);
  }, []);

  // Keep the latest branch message + streaming typing indicator in view.
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [miniChatHistory]);

  const handleClose = () => {
    setMiniOpen(false);
    setMiniChatHistory(null);
    setSelectedText(null);
    setMiniConvoId(null);
    setMiniMessage(null);
    //later also add operation to delete from db
  };

  if (!miniOpen) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex h-[500px] w-96 flex-col rounded-2xl border border-border bg-background shadow-md">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-sm font-semibold text-primary">Branch</span>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close branch"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {selectedText && (
        <div className="border-b border-border bg-muted/50 px-4 py-2">
          <p className="truncate text-xs italic text-muted-foreground">
            "{selectedText}"
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {miniChatHistory && <MiniMessageHistory history={miniChatHistory} />}
        <div ref={bottomRef} />
      </div>

      <div className="px-3 pb-3 pt-2">
        <MiniInput />
      </div>
    </div>
  );
};

export default MiniWindow;
