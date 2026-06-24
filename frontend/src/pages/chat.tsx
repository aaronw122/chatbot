import { useEffect, useRef, useState } from "react";
import MessageHistory from "../components/messageHistory";
import Input from "../components/input";
import MiniWindow from "../components/miniWindow";
import ChatHeader from "@/components/chatHeader";
import { useParams, useLocation } from "react-router";
import { useConvo } from "@/context/convoContext";
import { useMessage } from "@/context/messageContext";
import { useMini } from "@/context/miniContext";
import services from "../services/index";
import type { Highlight } from "../../../types/types";

type ChatLocationState = { streamFirst?: string } | null;

const Session = () => {
  const convo = useConvo();
  const message = useMessage();
  const mini = useMini();
  const location = useLocation();

  if (!convo) throw new Error("useConvo not working");
  if (!message) throw new Error("useMessage not working");
  if (!mini) throw new Error("useMini not working");

  const { id } = useParams();
  const { setChatHistory, chatHistory } = convo;
  const {
    handleMsgChange,
    newMessage,
    setNewMessage,
    setOptimisticMsg,
    streaming,
    streamReply,
  } = message;

  const handoffIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [highlightsByMessage, setHighlightsByMessage] = useState<
    Record<string, Highlight[]>
  >({});

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [chatHistory]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setHighlightsByMessage({});

    services
      .getHighlights(id)
      .then((highlights) => {
        if (!active) return;
        const grouped: Record<string, Highlight[]> = {};
        for (const highlight of highlights) {
          (grouped[highlight.messageId] ??= []).push(highlight);
        }
        setHighlightsByMessage(grouped);
      })
      .catch(() => {
        if (active) setHighlightsByMessage({});
      });

    return () => {
      active = false;
    };
  }, [id, mini.highlightRevision]);

  useEffect(() => {
    if (!id) return;
    const state = location.state as ChatLocationState;
    const streamFirst = state?.streamFirst;

    if (streamFirst) {
      if (handoffIdRef.current === id) return;
      handoffIdRef.current = id;
      setOptimisticMsg(null);
      setChatHistory([
        {
          id: crypto.randomUUID(),
          convoId: id,
          role: "user",
          content: streamFirst,
          createdAt: new Date().toISOString(),
        },
      ]);
      void streamReply(id, { firstReply: true, setChatHistory });
      return;
    }

    let active = true;
    setOptimisticMsg(null);
    setChatHistory(null);
    services.getMessages(id).then((messages) => {
      if (active) setChatHistory(messages);
    });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleSend = (convoId: string) => {
    const content = newMessage.trim();
    if (!content || streaming) return;
    setNewMessage("");
    void streamReply(convoId, { content, setChatHistory, seedUser: true });
  };

  return (
    <div className="flex h-full flex-col">
      <ChatHeader />
      {chatHistory ? (
        <>
          <div className="flex-1 overflow-y-auto py-6">
            <MessageHistory
              history={chatHistory}
              highlightsByMessage={highlightsByMessage}
            />
            <div ref={bottomRef} />
          </div>
          <div className="pb-4 pt-2">
            <Input
              sendMessage={handleSend}
              newMessage={newMessage}
              handleMsgChange={handleMsgChange}
              id={id!}
              disabled={streaming}
            />
          </div>
          <MiniWindow />
        </>
      ) : (
        <p className="text-muted-foreground py-6 text-sm">loading</p>
      )}
    </div>
  );
};

export default Session;
