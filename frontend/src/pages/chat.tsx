import { useEffect, useState } from "react";
import MessageHistory from "../components/messageHistory";
import Input from "../components/input";
import MiniWindow from "../components/miniWindow";
import ChatHeader from "@/components/chatHeader";
import { useParams } from "react-router";
import { useConvo } from "@/context/convoContext";

import services from "../services/index";
import { useMessage } from "@/context/messageContext";
import type { Highlight } from "../../../types/types";

const Session = () => {
  const convo = useConvo();
  const message = useMessage();

  if (!convo) throw new Error("useConvo not working");
  if (!message) throw new Error("useMessage not working");
  //pull id from react router link when clicked

  const { id } = useParams();

  const { setChatHistory, chatHistory } = convo;

  const { handleMsgChange, sendMessage, newMessage, setOptimisticMsg } =
    message;

  // B.5: highlights for this conversation, grouped by source message id so
  // each Message renders its persistent marks on load and SPA nav.
  const [highlightsByMessage, setHighlightsByMessage] = useState<
    Record<string, Highlight[]>
  >({});

  //on initial render (and on conversation switch) we load messages + highlights
  useEffect(() => {
    if (!id) return;
    setOptimisticMsg(null);
    setHighlightsByMessage({});
    services.getMessages(id).then((r) => setChatHistory(r));
    services
      .getHighlights(id)
      .then((hs) => {
        const grouped: Record<string, Highlight[]> = {};
        for (const h of hs) {
          (grouped[h.messageId] ??= []).push(h);
        }
        setHighlightsByMessage(grouped);
      })
      .catch(() => setHighlightsByMessage({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  //then, on subsequent chat messages, we update

  // Centering + scroll container live in the shell (main.tsx) per DESIGN.md.
  // This page renders content-only: a column-height flex with a header, a
  // message list, and the bottom-pinned composer.
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
          </div>
          <div className="pb-4 pt-2">
            <Input
              sendMessage={sendMessage}
              newMessage={newMessage}
              handleMsgChange={handleMsgChange}
              id={id!}
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
