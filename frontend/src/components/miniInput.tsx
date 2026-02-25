import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
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

  return (
    <div className="flex items-center gap-2">
      <Textarea
        placeholder="ask a follow-up..."
        className="min-h-0 rounded-lg resize-none border-2 shadow-none focus-visible:ring-1 text-sm"
        value={miniMessage ?? ""}
        onChange={handleChange}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
      />
      <Button size="sm" className="rounded-lg" onClick={handleSend}>
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
};

export default MiniInput;
