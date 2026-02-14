import { useState, useEffect, useRef, useCallback } from "react";
import Chats from "../components/messageHistory";
import Input from "../components/input";
import NewChat from "../components/newChat";
import type { WebSocketMessage, CleanMessage } from "../../../types/types";
import { useParams } from "react-router";
import { useConvo } from "@/context/convoContext";

const Session = () => {
  const [socketConnect, setSocketConnect] = useState<true | false>(false);
  const webSocket = useRef<WebSocket | null>(null);
  const [chatHistory, setChatHistory] = useState<CleanMessage[] | []>([]);

  const convo = useConvo();

  if (!convo) throw new Error("useConvo not working");

  //pull id from react router link when clicked

  const { id } = useParams();

  const { handleMsgChange, sendMessage, newMessage, setOptimisticMsg } = convo;

  //optimistic render
  useEffect(() => {
    setOptimisticMsg(null);
  }, []);

  const wsConnect = useCallback(
    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//localhost:3000/messages/${id}/ws`);

      webSocket.current = ws;

      ws.onopen = () => {
        console.log("socket connected!");
        setSocketConnect(true);
      };

      ws.onmessage = (event) => {
        try {
          const data: WebSocketMessage = JSON.parse(event.data);
          console.log("event data", event.data);
          if (data.type === "updateChat") {
            console.log("data.history", data.message);
            setChatHistory((prev) => [...prev, data.message]);
          } else if (data.type === "fullHistory") {
            setChatHistory(data.currentMessages);
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
        } else if (webSocket.current === ws) {
          setTimeout(connect, 4000);
        }
      };

      ws.onerror = (error) => {
        console.log("websocket error:", error);
        setSocketConnect(false);
      };
      //no deps for now, but when we refactor arrayy there will be - id, maybe whatever we use to switch views
    },
    [id],
  );

  useEffect(() => {
    wsConnect();

    return () => {
      const ws = webSocket.current;
      webSocket.current = null;
      if (ws) {
        ws.close();
      }
    };
  }, [wsConnect]);

  //will have new deps in future,
  return (
    <div className="flex flex-col h-full pb-5 mx-auto w-full max-w-3xl px-4">
      <div className="flex-1 overflow-y-auto">
        <Chats history={chatHistory} />
      </div>
      <Input
        sendMessage={sendMessage}
        newMessage={newMessage}
        handleMsgChange={handleMsgChange}
        id={id!}
      />
    </div>
  );
};

export default Session;
