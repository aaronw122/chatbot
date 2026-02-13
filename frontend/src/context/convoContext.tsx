import { useContext, createContext, useState } from "react";
import services from "../services/index";
import type { convoContext } from "../../../types/types";

const ConvoContext = createContext<convoContext | null>(null);

//any children we nest inside the useContext will receive it.
export function ConvoProvider({ children }: { children: React.ReactNode }) {
  const [currentView, setCurrentView] = useState<"newChat" | "chat">("newChat");
  const [convoId, setConvoId] = useState<string>("");
  const [newMessage, setNewMessage] = useState("");

  const selectConvo = (id: string) => {
    setConvoId(id);
    setCurrentView("chat");
  };

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

  const createConversation = async () => {
    console.log("message sent", newMessage);
    const res = await services.createConversation({
      content: newMessage,
    });
    setConvoId(res.convoId);
    setCurrentView("chat");
    setNewMessage("");
  };

  const newChat = async () => {
    setCurrentView("newChat");
    setNewMessage("");
    console.log("newChatClicked");
  };

  return (
    <ConvoContext.Provider
      value={{
        currentView,
        setCurrentView,
        convoId,
        setConvoId,
        newMessage,
        setNewMessage,
        selectConvo,
        handleMsgChange,
        sendMessage,
        createConversation,
        newChat,
      }}
    >
      {children}
    </ConvoContext.Provider>
  );
}

export function useConvo() {
  return useContext(ConvoContext);
}
