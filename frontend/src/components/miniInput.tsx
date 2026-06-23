import { Send } from "lucide-react";
import services from "../services/index";
import { useMini } from "@/context/miniContext";

const MiniInput = () => {
  const mini = useMini();
  if (!mini) return null;

  const {
    selectedText,
    miniConvoId,
    setMiniConvoId,
    setMiniChatHistory,
    miniMessage,
    setMiniMessage,
  } = mini;

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMiniMessage(event.target.value);
    const el = event.target;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  const handleSend = async () => {
    if (!miniMessage || miniMessage.trim().length === 0) return;

    const messageContent = miniMessage.trim();
    setMiniMessage(null);

    if (!miniConvoId) {
      // First message — create new conversation with highlighted text as context
      const contextMessage = selectedText
        ? `'${selectedText}' ${messageContent}`
        : messageContent;

      //this is where we change to reference new express function, and send over agent instead.
      const messages = await services.createConversation({
        content: contextMessage,
        withReply: true,
      });

      //then right after we add the contextMessage as a followup.

      // messages is an array of CleanMessage[] (user msg + AI response)
      if (messages && messages.length > 0) {
        const newConvoId = messages[0].convoId;
        setMiniConvoId(newConvoId);
        setMiniChatHistory(messages);
      }
    } else {
      // Subsequent messages — send to existing mini conversation
      await services.sendMessage({
        content: messageContent,
        role: "user",
        convoId: miniConvoId,
      });
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
