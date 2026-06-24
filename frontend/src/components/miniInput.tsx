import { Send } from "lucide-react";
import services from "../services/index";
import { useMini } from "@/context/miniContext";
import { useMessage } from "@/context/messageContext";

const MiniInput = () => {
  const mini = useMini();
  const message = useMessage();
  if (!mini) return null;
  if (!message) throw new Error("useMessage not working");

  const {
    selectedText,
    miniConvoId,
    setMiniConvoId,
    setMiniChatHistory,
    miniMessage,
    setMiniMessage,
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

    const messageContent = miniMessage.trim();
    setMiniMessage(null);

    if (!miniConvoId) {
      // First message — create the conversation with the highlighted text as
      // context. /conversations only persists the user message (no LLM call);
      // the reply is then streamed via the firstReply handoff.
      const contextMessage = selectedText
        ? `'${selectedText}' ${messageContent}`
        : messageContent;

      const messages = await services.createConversation({
        content: contextMessage,
      });
      if (!messages || messages.length === 0) return;

      const newConvoId = messages[0].convoId;
      setMiniConvoId(newConvoId);
      // Seed the persisted user bubble, then stream the assistant reply.
      setMiniChatHistory(messages);
      await streamReply(newConvoId, {
        firstReply: true,
        setChatHistory: setMiniChatHistory,
      });
    } else {
      // Subsequent messages — stream the reply into the mini-window history,
      // seeding the optimistic user bubble first.
      await streamReply(miniConvoId, {
        content: messageContent,
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
