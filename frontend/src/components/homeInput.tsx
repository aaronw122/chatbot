import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
import { useConvo } from "@/context/convoContext";
import { useNavigate } from "react-router";
import services from "../services/index";
import Chats from "./messageHistory";

const HomeInput = () => {
  const convo = useConvo();
  const navigate = useNavigate();

  if (!convo) throw new Error("useConvo not working");

  const {
    newMessage,
    setNewMessage,
    handleMsgChange,
    setOptimisticMsg,
    optimisticMsg,
    setConvos,
  } = convo;

  const createConversation = async () => {
    console.log("message sent", newMessage);
    const optimisticMessage = [
      {
        id: "123",
        convoId: "pending",
        role: "user" as const,
        content: newMessage,
        createdAt: new Date().toISOString(),
      },
    ];
    setOptimisticMsg(optimisticMessage);
    const res = await services.createConversation({
      content: newMessage,
    });
    console.log("optimistic", optimisticMessage);
    navigate(`/chat/${res[0].convoId}`);
    setNewMessage("");
    const updatedConvos = await services.getConversations();
    setConvos(updatedConvos);
  };

  return (
    <div className="w-full">
      {optimisticMsg ? (
        <Chats history={optimisticMsg} />
      ) : (
        <div className="flex items-center justify-center gap-2 w-full">
          <Textarea
            placeholder="ask away"
            className="min-h-0 rounded-lg resize-none border-2 shadow-none focus-visible:ring-1"
            value={newMessage}
            onChange={handleMsgChange}
          >
            {" "}
          </Textarea>
          <Button className="rounded-lg" onClick={() => createConversation()}>
            <Send />
          </Button>
        </div>
      )}
    </div>
  );
};

export default HomeInput;
