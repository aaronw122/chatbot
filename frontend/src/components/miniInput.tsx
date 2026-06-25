import { Send } from "lucide-react";
import services from "../services/index";
import type { CreateBranchResponse } from "../services/index";
import { useMini } from "@/context/miniContext";
import { useMessage } from "@/context/messageContext";

const MiniInput = () => {
  const mini = useMini();
  const message = useMessage();
  if (!mini) return null;
  if (!message) throw new Error("useMessage not working");

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
    notifyHighlightCreated,
  } = mini;

  // The branch window streams through the SAME orchestrator as the main chat —
  // we just inject the mini-window's history setter, so it gets the identical
  // instant-feedback (typing indicator) + token-by-token behavior.
  const { streamReply, streaming } = message;

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMiniMessage(event.target.value);
    const el = event.target;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  const handleSend = async () => {
    if (!miniMessage || miniMessage.trim().length === 0 || streaming) return;

    // B.2: the branch's first user message is the typed text ONLY — no more
    // concatenating the highlighted quote into content. The highlight travels
    // as structured data; the backend re-derives full-response context from it.
    const typedText = miniMessage.trim();
    setMiniMessage(null);

    if (!miniConvoId) {
      if (sourceMessageId && highlightRange && quote) {
        const res: CreateBranchResponse = await services.createConversation({
          content: typedText,
          highlight: {
            messageId: sourceMessageId,
            startOffset: highlightRange.start,
            endOffset: highlightRange.end,
            quote,
            // v2 renderer: captured offsets are semantic canonical coordinates.
            anchorVersion: 2,
          },
        });
        if (!res?.convoId) return;

        setMiniConvoId(res.convoId);
        const messages = await services.getMessages(res.convoId);
        setMiniChatHistory(messages ?? null);
        setSourceMessageId(null);
        setHighlightRange(null);
        notifyHighlightCreated();
        await streamReply(res.convoId, {
          firstReply: true,
          setChatHistory: setMiniChatHistory,
        });
      } else {
        const messages = await services.createConversation({
          content: typedText,
          save: false,
        });
        if (!Array.isArray(messages) || messages.length === 0) return;

        const newConvoId = messages[0].convoId;
        setMiniConvoId(newConvoId);
        setMiniChatHistory(messages);
        await streamReply(newConvoId, {
          firstReply: true,
          setChatHistory: setMiniChatHistory,
        });
      }
    } else {
      await streamReply(miniConvoId, {
        content: typedText,
        setChatHistory: setMiniChatHistory,
        seedUser: true,
      });
    }
  };

  const disabled =
    !miniMessage || miniMessage.trim().length === 0 || streaming;

  return (
    <div className="flex items-end gap-2 rounded-2xl border border-input bg-background p-2 shadow-sm focus-within:border-ring focus-within:ring-2 focus-within:ring-ring">
      <textarea
        placeholder="ask a follow-up"
        rows={1}
        disabled={streaming}
        className="max-h-32 flex-1 resize-none bg-transparent px-1 py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
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
