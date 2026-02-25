import { useContext, createContext, useState } from "react";
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
  //home page
  const [convos, setConvos] = useState<null | Conversation[]>(null);

  //normal chat + home
  // const [newMessage, setNewMessage] = useState("");
  // const [optimisticMsg, setOptimisticMsg] = useState<CleanMessage[] | null>(
  //   null,
  // );
  const [chatHistory, setChatHistory] = useState<CleanMessage[] | null>(null);

  //miniChat - clean up later
  // const [miniMessage, setMiniMessage] = useState<null | string>(null);
  // const [miniChatHistory, setMiniChatHistory] = useState<null | CleanMessage[]>(
  //   null,
  // );
  // const [miniOpen, setMiniOpen] = useState<true | false>(false);
  // const [selectedText, setSelectedText] = useState<string | null>(null);
  // const [convoMsg, setConvoMsg] = useState<string | null>(null);
  // const [miniConvoId, setMiniConvoId] = useState<string | null>(null);

  // const handleMsgChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
  //   setNewMessage(event.target.value);
  //   console.log(event.target.value);
  // };

  // const sendMessage = async (id: string) => {
  //   console.log("message sent", newMessage);
  //   setNewMessage("");
  //   await services.sendMessage({
  //     content: newMessage,
  //     role: "user",
  //     convoId: id,
  //   });
  // };

  return (
    <ConvoContext.Provider
      value={{
        convos,
        setConvos,
        chatHistory,
        setChatHistory,
      }}
    >
      {children}
    </ConvoContext.Provider>
  );
}
