import { useConvo } from "@/context/convoContext";
import { useNavigate } from "react-router";
import services from "../services/index";
import Chats from "./messageHistory";
import { useMessage } from "@/context/messageContext";
import Composer from "./composer";

const HomeInput = () => {
  const convo = useConvo();
  const message = useMessage();
  const navigate = useNavigate();

  if (!convo) throw new Error("useConvo not working");

  const { setConvos } = convo;

  if (!message) throw new Error("useMessage not working");

  const {
    newMessage,
    setNewMessage,
    handleMsgChange,
    setOptimisticMsg,
    optimisticMsg,
  } = message;

  const createConversation = async () => {
    const content = newMessage;
    // Pre-navigation optimistic bubble (home page only). chat.tsx clears this on
    // mount once it owns the live streaming state (B.3 — optimisticMsg is
    // reserved for this pre-nav bubble, not the convo surface).
    const optimisticMessage = [
      {
        id: "123",
        convoId: "pending",
        role: "user" as const,
        content,
        createdAt: new Date().toISOString(),
      },
    ];
    setOptimisticMsg(optimisticMessage);
    // POST /conversations stays non-streaming JSON: it creates the convo and
    // persists this first user message (no LLM call). The streamed first
    // assistant reply is fired by chat.tsx via the streamFirst handoff (B.2).
    const res = await services.createConversation({
      content,
    });
    setNewMessage("");
    // Hand the first message to chat.tsx so it can seed the user bubble and
    // stream the assistant reply with the {firstReply:true} marker (no double
    // user insert).
    navigate(`/chat/${res[0].convoId}`, { state: { streamFirst: content } });
    const updatedConvos = await services.getConversations();
    setConvos(updatedConvos);
  };

  return (
    <div className="w-full">
      {optimisticMsg ? (
        <Chats history={optimisticMsg} />
      ) : (
        <Composer
          placeholder="ask away"
          autoFocus
          value={newMessage}
          onChange={(value) =>
            handleMsgChange({
              target: { value },
            } as React.ChangeEvent<HTMLTextAreaElement>)
          }
          onSubmit={createConversation}
        />
      )}
    </div>
  );
};

export default HomeInput;
