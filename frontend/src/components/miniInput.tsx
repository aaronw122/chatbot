import { Send } from "lucide-react";
import services from "../services/index";
import type { CreateBranchResponse } from "../services/index";
import { useMini } from "@/context/miniContext";

const MiniInput = () => {
  const mini = useMini();
  if (!mini) return null;

  const {
    miniConvoId,
    setMiniConvoId,
    setMiniChatHistory,
    miniMessage,
    setMiniMessage,
    sourceMessageId,
    highlightRange,
    quote,
    setSourceMessageId,
    setHighlightRange,
  } = mini;

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMiniMessage(event.target.value);
    const el = event.target;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  const handleSend = async () => {
    if (!miniMessage || miniMessage.trim().length === 0) return;

    // B.2: the branch's first user message is the typed text ONLY — no more
    // concatenating the highlighted quote into content. The highlight travels
    // as structured data; the backend re-derives full-response context from it.
    const typedText = miniMessage.trim();
    setMiniMessage(null);

    if (!miniConvoId) {
      // First message — create the branch conversation.
      if (sourceMessageId && highlightRange && quote) {
        // Anchored branch: send structured highlight. Response is
        // { convoId, highlightId } (NOT a message array).
        const res: CreateBranchResponse = await services.createConversation({
          content: typedText,
          highlight: {
            messageId: sourceMessageId,
            startOffset: highlightRange.start,
            endOffset: highlightRange.end,
            quote,
          },
        });
        if (res?.convoId) {
          setMiniConvoId(res.convoId);
          // The created branch already holds the user message + AI reply; load
          // it so the window shows the full first turn.
          const messages = await services.getMessages(res.convoId);
          setMiniChatHistory(messages ?? null);
          // The pending anchor is now persisted as a real highlight; clear the
          // transient capture state (keep `quote` for the ↳ reference header).
          setSourceMessageId(null);
          setHighlightRange(null);
        }
      } else {
        // Chip dismissed (no anchor): create a normal conversation. The home
        // path stays array-based — handle that shape here too.
        const messages = await services.createConversation({
          content: typedText,
        });
        if (Array.isArray(messages) && messages.length > 0) {
          setMiniConvoId(messages[0].convoId);
          setMiniChatHistory(messages);
        }
      }
    } else {
      // Follow-up — typed text only; re-fetch the branch to pick up the reply.
      await services.sendMessage({
        content: typedText,
        role: "user",
        convoId: miniConvoId,
      });
      const messages = await services.getMessages(miniConvoId);
      setMiniChatHistory(messages ?? null);
    }
  };

  const disabled = !miniMessage || miniMessage.trim().length === 0;

  return (
    <div className="flex items-end gap-2 rounded-2xl border border-input bg-background p-2 shadow-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring">
      <textarea
        placeholder="ask a follow-up"
        rows={1}
        className="max-h-32 flex-1 resize-none bg-transparent px-1 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        value={miniMessage ?? ""}
        onChange={handleChange}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={disabled}
        aria-label="Send"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-50"
      >
        <Send className="size-4" />
      </button>
    </div>
  );
};

export default MiniInput;
