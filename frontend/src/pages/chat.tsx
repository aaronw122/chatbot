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

// Desktop horizontal framing for every full-pane chat section, applied so the
// header, message scroll, and composer stay aligned.
//   - Right gutter reserves space for the Branch panel (miniWindow: w-96 +
//     right-6 ≈ 26rem). Ramped: gentler at lg so small laptops keep a usable
//     column (a flat 26rem shrinks it to ~320px), full clearance at xl+.
//   - Left gutter adds Notion-style breathing room between the sidebar and the
//     reading column (the centered column otherwise hugs the sidebar once the
//     right gutter pulls it left, especially with the sidebar expanded).
const GUTTER = "lg:pl-10 lg:pr-[18rem] xl:pl-20 xl:pr-[26rem]";

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

  // Branch (mini-window) state lives in a global context, so without cleanup it
  // bleeds into the next conversation. Close + clear any open branch whenever we
  // leave this chat: the cleanup runs on id change (switching chats) and on
  // unmount (starting a new chat). Keyed on id only — the mini setters are
  // stable, while depending on `mini` (a fresh object each render) would wipe
  // the branch mid-session.
  useEffect(() => {
    return () => {
      mini.setMiniOpen(false);
      mini.setMiniChatHistory(null);
      mini.setSelectedText(null);
      mini.setMiniConvoId(null);
      mini.setMiniMessage(null);
      mini.setSourceMessageId(null);
      mini.setHighlightRange(null);
      mini.setQuote(null);
      mini.setAnchorTop(null);
      mini.setAnchorMaxHeight(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
    <div className="flex h-full min-h-0 flex-col">
      {/* Desktop right gutter (lg+) reserves space for the floating Branch panel
          so it never covers the conversation, which also shifts the reading
          column left-of-center (Notion-style). Header, message scroll, and
          composer each share GUTTER so they stay vertically aligned, and each
          centers a max-w-3xl column inside the remaining left region. The scroll
          container spans the full pane, so its scrollbar sits out at the pane's
          right edge instead of overlapping the right-aligned user bubble. */}
      <div className={GUTTER}>
        <div className="mx-auto w-full max-w-3xl">
          <ChatHeader />
        </div>
      </div>
      {chatHistory ? (
        <>
          {/* The scroll container is the positioning context for the floating
              desktop Branch panel: rendering MiniWindow inside it (absolute,
              data-chat-scroll) makes the panel scroll away with the conversation
              like a comment, rather than following the viewport. */}
          <div
            data-chat-scroll
            className={`relative flex-1 overflow-y-auto ${GUTTER}`}
          >
            <div className="mx-auto w-full max-w-3xl px-4 py-6">
              <MessageHistory
                history={chatHistory}
                highlightsByMessage={highlightsByMessage}
              />
              <div ref={bottomRef} />
            </div>
            <MiniWindow />
          </div>
          <div className={GUTTER}>
            <div className="mx-auto w-full max-w-3xl px-4 pb-4 pt-2">
              <Input
                sendMessage={handleSend}
                newMessage={newMessage}
                handleMsgChange={handleMsgChange}
                id={id!}
                disabled={streaming}
              />
            </div>
          </div>
        </>
      ) : (
        <div className={GUTTER}>
          <div className="mx-auto w-full max-w-3xl px-4">
            <p className="text-muted-foreground py-6 text-sm">loading</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Session;
