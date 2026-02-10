import { useState, useEffect } from "react";
import services from "./services/index";
import Chats from "./components/chats";
import Input from "./components/input";
import "./App.css";

function App() {
  const [history, setHistory] = useState([]);
  const [newMessage, setNewMessage] = useState("");

  useEffect(() => {
    services.getAllMessages().then((r) => setHistory(r));
  }, []);

  const handleMsgChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewMessage(event.target.value);
    console.log(event.target.value);
  };

  const sendMessage = async () => {
    console.log("message sent", newMessage);
    await services.sendMessage({ content: newMessage });
    setNewMessage("");
  };

  const newChat = async () => {
    console.log("newChatClicked");
    await services.resetMessages();
  };

  //websocket wikll automatically send back new message....

  return (
    <>
      <h1> Chatbot </h1>
      <div>
        <Chats history={history} />
        <Input
          sendMessage={sendMessage}
          newMessage={newMessage}
          handleMsgChange={handleMsgChange}
        />
      </div>
    </>
  );
}

export default App;
