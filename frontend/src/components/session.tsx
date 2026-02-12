import { useState, useEffect, useRef, useCallback } from "react";
import Chats from "../components/chats";
import Input from "../components/input";
import NewChat from "../components/newChat";
import services from "../services/index";

const Session = ({ id }: { id: string }) => {
  const [socketConnect, setSocketConnect] = useState<true | false>(false);
  const webSocket = useRef<WebSocket | null>(null);
  const [history, setHistory] = useState([]);
  const [newMessage, setNewMessage] = useState("");

  const wsConnect = useCallback(function connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//localhost:3000/chat/ws`);

    webSocket.current = ws;

    ws.onopen = () => {
      console.log("socket connected!");
      setSocketConnect(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "updateChat") {
          console.log("data.history", data.history);
          setHistory(data.history);
        }
      } catch (error) {
        console.error("failed to parse message", error);
      }
    };

    ws.onclose = (event) => {
      setSocketConnect(false);
      console.log("websocket disconnected!");

      if (event.code === 1008) {
        console.log("chat not found");
      } else if (webSocket.current !== null) {
        setTimeout(connect, 4000);
      }
    };

    ws.onerror = (error) => {
      console.log("websocket error:", error);
      setSocketConnect(false);
    };
    //no deps for now, but when we refactor arrayy there will be - id, maybe whatever we use to switch views
  }, []);

  useEffect(() => {
    wsConnect();

    //unmounting logic. not needed for now, but ikelhy in future.
    return () => {
      const ws = webSocket.current;
      webSocket.current = null;
      if (ws) {
        ws.close();
      }
    };
  }, [wsConnect]);

  useEffect(() => {
    services.getMessages(id).then((r) => setHistory(r));
  }, [id]);

  //will have new deps in future,

  const handleMsgChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewMessage(event.target.value);
    console.log(event.target.value);
  };

  const sendMessage = async () => {
    console.log("message sent", newMessage);
    setNewMessage("");
    await services.sendMessage({
      content: newMessage,
      role: "user",
      convoId: id,
    });
  };

  const newChat = async () => {
    console.log("newChatClicked");
    await services.resetMessages();
  };

  return (
    <div className="flex flex-col">
      <NewChat newChat={newChat} />
      {socketConnect ? <p> connected </p> : <p> disconnected </p>}
      <Chats history={history} />
      <Input
        sendMessage={sendMessage}
        newMessage={newMessage}
        handleMsgChange={handleMsgChange}
      />
    </div>
  );
};

export default Session;
