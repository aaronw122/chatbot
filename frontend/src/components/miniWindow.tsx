import { useEffect, useRef } from "react";
import MiniMessageHistory from "./miniChats";
import MiniInput from "./miniInput";
import { ArrowLeft, Maximize2, X } from "lucide-react";
import { useNavigate } from "react-router";
import { useMini } from "@/context/miniContext";
import { useConvo } from "@/context/convoContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";
import services from "../services/index";

const MiniWindow = () => {
  const mini = useMini();
  const convo = useConvo();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [mini?.miniChatHistory]);

  if (!mini || !convo) return null;

  const {
    miniOpen,
    setMiniOpen,
    miniChatHistory,
    setMiniChatHistory,
    setSelectedText,
    miniConvoId,
    setMiniConvoId,
    setMiniMessage,
    sourceMessageId,
    setSourceMessageId,
    highlightRange,
    setHighlightRange,
    quote,
    setQuote,
  } = mini;

  const resetState = () => {
    setMiniChatHistory(null);
    setSelectedText(null);
    setMiniConvoId(null);
    setMiniMessage(null);
    setSourceMessageId(null);
    setHighlightRange(null);
    setQuote(null);
  };

  const handleClose = () => {
    setMiniOpen(false);
    resetState();
    //later also add operation to delete from db
  };

  // B.4: dismiss the pending highlight before first send -> the branch carries
  // no anchor (no mark will be created). Only meaningful pre-creation.
  const dismissChip = () => {
    setSourceMessageId(null);
    setHighlightRange(null);
    setQuote(null);
    setSelectedText(null);
  };

  // B.4: fullscreen -> promote the branch to a sidebar conversation and open it
  // as a full conversation. The source response's mark remains.
  const handleFullscreen = async () => {
    if (!miniConvoId) return;
    try {
      await services.promoteConversation(miniConvoId);
      const conversations = await services.getConversations();
      convo.setConvos(conversations);
    } catch {
      // promotion failed; keep the window open so the user can retry
      return;
    }
    const target = miniConvoId;
    setMiniOpen(false);
    resetState();
    navigate(`/chat/${target}`);
  };

  // A pending anchor (capture state present, branch not yet created) shows a
  // dismissible chip; an already-created branch shows a static ↳ reference.
  const isPending = !miniConvoId && Boolean(sourceMessageId && highlightRange);

  // Shared content — the ↳ quote reference, the scrollable branch history, and
  // the composer (with its pre-send dismissible chip). Identical between the
  // desktop floating window and the mobile sheet; only the header chrome differs.
  const body = (
    <>
      {/* Reopened/created branch: static ↳ quote reference above the history. */}
      {!isPending && quote && (
        <div className="border-b border-border bg-muted/50 px-4 py-2">
          <p className="truncate text-xs italic text-muted-foreground">
            ↳ {quote}
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {miniChatHistory && <MiniMessageHistory history={miniChatHistory} />}
        <div ref={bottomRef} />
      </div>

      <div className="px-3 pb-3 pt-2">
        {/* Pending highlight chip with ✕ to drop the anchor before sending. */}
        {isPending && quote && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-1.5">
            <p className="flex-1 truncate text-xs italic text-muted-foreground">
              ↳ {quote}
            </p>
            <button
              type="button"
              onClick={dismissChip}
              aria-label="Remove highlight"
              title="Remove highlight"
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
        <MiniInput />
      </div>
    </>
  );

  // Mobile: a full-screen sheet sliding in from the right, dismissed via a back
  // arrow (or swipe / overlay tap / Esc). Rendered even when closed so Radix can
  // play the slide-out animation; every close routes through handleClose so the
  // pending-branch state is reset exactly like the desktop ✕. Fullscreen-promote
  // is omitted here — the sheet is already full-screen.
  if (isMobile) {
    return (
      <Sheet
        open={miniOpen}
        onOpenChange={(open) => {
          if (!open) handleClose();
        }}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          aria-describedby={undefined}
          className="flex w-full flex-col gap-0 p-0 sm:max-w-none"
        >
          <div className="flex items-center gap-2 border-b border-border px-2 py-2.5">
            <button
              type="button"
              onClick={handleClose}
              aria-label="Back"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <ArrowLeft className="size-5" />
            </button>
            <SheetTitle className="text-sm font-semibold text-primary">
              Branch
            </SheetTitle>
          </div>
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  if (!miniOpen) return null;

  // Desktop: floating window pinned bottom-right with maximize + close controls.
  return (
    <div className="fixed bottom-6 right-6 z-50 flex h-[500px] w-96 flex-col rounded-2xl border border-border bg-background shadow-md">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-sm font-semibold text-primary">Branch</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleFullscreen}
            disabled={!miniConvoId}
            aria-label="Open full screen"
            title="Open full screen"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Maximize2 className="size-4" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close branch"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
      {body}
    </div>
  );
};

export default MiniWindow;
