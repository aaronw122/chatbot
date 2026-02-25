import { useContext, createContext, useState } from "react";
import services from "../services/index";
import type { messageContext, CleanMessage } from "../../../types/types";

const MessageContext = createContext<messageContext | null>(null);

export const useMessage = () => {
  return useContext(MessageContext);
};

export function MessageProvider({ children }: { children: React.ReactNode }) {
  const [newMessage, setNewMessage] = useState("");
  const [optimisticMsg, setOptimisticMsg] = useState<CleanMessage[] | null>(
    null,
  );

  const handleMsgChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewMessage(event.target.value);
    console.log(event.target.value);
  };

  const sendMessage = async (id: string) => {
    console.log("message sent", newMessage);
    setNewMessage("");
    await services.sendMessage({
      content: newMessage,
      role: "user",
      convoId: id,
    });
  };

  return (
    <MessageContext.Provider
      value={{
        newMessage,
        setNewMessage,
        optimisticMsg,
        setOptimisticMsg,
        handleMsgChange,
        sendMessage,
      }}
    >
      {children}
    </MessageContext.Provider>
  );
}
