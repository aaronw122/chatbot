import ConvoList from "./components/convoList";
import Session from "./components/session";
import { useState } from "react";
import services from "./services/index";
import HomeInput from "./components/homeInput";
import { useConvo } from "./context/convoContext";

function App() {
  //websocket wikll automatically send back new message, update all messages

  // const [currentView, setCurrentView] = useState<"newChat" | "chat">("newChat");
  // const [convoId, setConvoId] = useState<string>("");
  // const [newMessage, setNewMessage] = useState("");

  // const selectConvo = (id: string) => {
  //   setConvoId(id);
  //   setCurrentView("chat");
  // };

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

  // const createConversation = async () => {
  //   console.log("message sent", newMessage);
  //   const res = await services.createConversation({
  //     content: newMessage,
  //   });
  //   setConvoId(res.convoId);
  //   setCurrentView("chat");
  //   setNewMessage("");
  // };

  // const newChat = async () => {
  //   setCurrentView("newChat");
  //   console.log("newChatClicked");
  // };
  //

  const convo = useConvo();

  if (!convo) throw new Error("useConvo not working");

  const { currentView } = convo;

  return (
    <div className="flex flex-row mx-10 my-5 h-screen">
      <ConvoList />
      <div className="flex-1 h-full">
        {currentView === "newChat" ? (
          <div className="flex flex-col justify-center h-full lg:mx-80 md:mx-20 sm:mx-15 my-5 gap-1">
            <h1 className="text-center">
              {"  "}
              bubble{" "}
            </h1>
            <HomeInput />
          </div>
        ) : (
          <div className="mx-10 h-full">
            <Session />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
