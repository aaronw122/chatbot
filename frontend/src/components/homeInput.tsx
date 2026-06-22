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
        <Composer
          placeholder="ask away"
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
