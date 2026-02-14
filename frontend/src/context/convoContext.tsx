import { useContext, createContext, useState } from "react";
import services from "../services/index";
import type {
  CleanMessage,
  convoContext,
  Conversation,
} from "../../../types/types";

//creating context object
const ConvoContext = createContext<convoContext | null>(null);

//group useContext and ConvoContext so children dont need to imprt useContext AND convoContext
export function useConvo() {
  return useContext(ConvoContext);
}

//any children we nest inside the useContext will receive all these variables
export function ConvoProvider({ children }: { children: React.ReactNode }) {
  const [newMessage, setNewMessage] = useState("");
  const [optimisticMsg, setOptimisticMsg] = useState<CleanMessage[] | null>(
    null,
  );
  const [convos, setConvos] = useState<null | Conversation[]>(null);

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
    <ConvoContext.Provider
      value={{
        newMessage,
        setNewMessage,
        handleMsgChange,
        sendMessage,
        optimisticMsg,
        setOptimisticMsg,
        convos,
        setConvos,
      }}
    >
      {children}
    </ConvoContext.Provider>
  );
}
