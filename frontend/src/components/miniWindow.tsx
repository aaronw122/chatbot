import { useEffect, useRef, useCallback } from "react";
import { useConvo } from "@/context/convoContext";
import MiniMessageHistory from "./miniChats";
import MiniInput from "./miniInput";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { WebSocketMessage } from "../../../types/types";

const MiniWindow = () => {
  const convo = useConvo();
  const webSocket = useRef<WebSocket | null>(null);

  if (!convo) return null;

  const {
    miniOpen,
    setMiniOpen,
    miniChatHistory,
    setMiniChatHistory,
    miniConvoId,
    selectedText,
    setSelectedText,
    setMiniConvoId,
    setMiniMessage,
  } = convo;

  const wsConnect = useCallback(
    function connect() {
      if (!miniConvoId) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${protocol}//localhost:3000/messages/${miniConvoId}/ws`,
      );

      webSocket.current = ws;

      ws.onmessage = (event) => {
        try {
          const data: WebSocketMessage = JSON.parse(event.data);
          if (data.type === "updateChat") {
            setMiniChatHistory((prev) =>
              prev ? [...prev, data.message] : [data.message],
            );
          } else if (data.type === "fullHistory") {
            setMiniChatHistory(data.currentMessages);
          }
        } catch (error) {
          console.error("mini ws parse error", error);
        }
      };

      ws.onclose = (event) => {
        if (event.code !== 1000 && webSocket.current === ws) {
          setTimeout(connect, 4000);
        }
      };

      ws.onerror = (error) => {
        console.error("mini ws error:", error);
      };
    },
    [miniConvoId, setMiniChatHistory],
  );

  useEffect(() => {
    if (!miniConvoId) return;

    wsConnect();

    return () => {
      const ws = webSocket.current;
      webSocket.current = null;
      if (ws) ws.close();
    };
  }, [wsConnect, miniConvoId]);

  const handleClose = () => {
    setMiniOpen(false);
    setMiniChatHistory(null);
    setSelectedText(null);
    setMiniConvoId(null);
    setMiniMessage(null);
    const ws = webSocket.current;
    webSocket.current = null;
    if (ws) ws.close();
  };

  if (!miniOpen) return null;

  return (
    <div className="fixed bottom-6 right-6 w-96 h-[500px] bg-background border rounded-xl shadow-lg flex flex-col z-50">
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <span className="text-sm font-medium">Branch</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {selectedText && (
        <div className="px-4 py-2 border-b bg-muted/50">
          <p className="text-xs text-muted-foreground italic truncate">
            "{selectedText}"
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {miniChatHistory && <MiniMessageHistory history={miniChatHistory} />}
      </div>

      <div className="px-4 py-2 border-t">
        <MiniInput />
      </div>
    </div>
  );
};

export default MiniWindow;
