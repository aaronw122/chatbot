import { useEffect, useRef } from "react";
import MessageHistory from "../components/messageHistory";
import Input from "../components/input";
import MiniWindow from "../components/miniWindow";
import ChatHeader from "@/components/chatHeader";
import { useParams, useLocation } from "react-router";
import { useConvo } from "@/context/convoContext";

import services from "../services/index";
import { useMessage } from "@/context/messageContext";

type ChatLocationState = { streamFirst?: string } | null;

const Session = () => {
  const convo = useConvo();
  const message = useMessage();
  const location = useLocation();

  if (!convo) throw new Error("useConvo not working");
  if (!message) throw new Error("useMessage not working");
  //pull id from react router link when clicked

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

  // Tracks which convo id the create→stream handoff already fired for, so it
  // runs exactly once per fresh convo (and survives the StrictMode double-invoke)
  // even though the load effect now re-runs whenever the :id param changes.
  const handoffIdRef = useRef<string | null>(null);

  // Keep the latest message (and the streaming typing indicator) in view as the
  // history grows — without this, a freshly-sent message or incoming tokens can
  // land below the fold and feel like nothing happened.
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [chatHistory]);

  // Load the active conversation. Re-runs whenever the :id param changes —
  // React Router reuses this component across /chat/A → /chat/B, so without an
  // `id` dependency a sidebar click would change the URL but never reload the
  // messages (the conversation would appear "stuck" / unsaved until a reload).
  //
  // Special case: arriving from a fresh create (homeInput navigates with
  // state.streamFirst), we seed the user's first message and stream the reply
  // instead of refetching — refetching would clobber/race the live stream.
  useEffect(() => {
    const state = location.state as ChatLocationState;
    const streamFirst = state?.streamFirst;

    const kickoffFirstReply = (firstMessage: string) => {
      // Clear the home-page pre-nav optimistic bubble now that this page owns
      // the live state.
      setOptimisticMsg(null);
      // Seed the user's first message into chatHistory; /conversations already
      // persisted it, so the stream is fired with firstReply:true (no content).
      const seeded = [
        {
          id: crypto.randomUUID(),
          convoId: id!,
          role: "user" as const,
          content: firstMessage,
          createdAt: new Date().toISOString(),
        },
      ];
      setChatHistory(seeded);
      streamReply(id!, { firstReply: true, setChatHistory });
    };

    // Fresh-create handoff: fire once per new convo. The per-id guard also
    // absorbs the StrictMode double-invoke without clobbering the live stream.
    if (streamFirst) {
      if (handoffIdRef.current === id) return;
      handoffIdRef.current = id!;
      kickoffFirstReply(streamFirst);
      return;
    }

    // Existing convo (sidebar click / direct load / switch): show the loading
    // state, then fetch this conversation's messages.
    setOptimisticMsg(null);
    setChatHistory(null);
    services.getMessages(id!).then((r) => setChatHistory(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Subsequent sends in an existing convo: stream the reply, live-appending the
  // optimistic user message + growing assistant message into chatHistory.
  const handleSend = (convoId: string) => {
    const content = newMessage.trim();
    if (!content || streaming) return;
    setNewMessage("");
    streamReply(convoId, { content, setChatHistory, seedUser: true });
  };

  // Centering + scroll container live in the shell (main.tsx) per DESIGN.md.
  // This page renders content-only: a column-height flex with a header, a
  // message list, and the bottom-pinned composer.
  return (
    <div className="flex h-full flex-col">
      <ChatHeader />
      {chatHistory ? (
        <>
          <div className="flex-1 overflow-y-auto py-6">
            <MessageHistory history={chatHistory} />
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
