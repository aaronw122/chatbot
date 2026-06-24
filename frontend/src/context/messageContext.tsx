import { useContext, createContext, useState, useRef } from "react";
import services from "../services/index";
import type { messageContext, CleanMessage } from "../../../types/types";

// Phase 2 streaming additions. Kept local to the frontend so the shared
// `types/types.ts` (owned by the backend agent) stays untouched and we avoid
// integration conflicts. Augments the existing messageContext shape.
type StreamingMessageContext = messageContext & {
  // True while a streamed assistant reply is in flight; composer is disabled.
  streaming: boolean;
  // Streaming orchestrator (B.3). Live-appends a growing assistant message into
  // chatHistory (setter injected from convoContext) and re-enables the composer
  // on every termination.
  streamReply: (
    convoId: string,
    args: {
      content?: string;
      firstReply?: boolean;
      setChatHistory: React.Dispatch<
        React.SetStateAction<CleanMessage[] | null>
      >;
      seedUser?: boolean;
    },
  ) => Promise<void>;
};

const MessageContext = createContext<StreamingMessageContext | null>(null);

export const useMessage = () => {
  return useContext(MessageContext);
};

// No-chunk-for-this-long → treat the stream as interrupted (B.3 inactivity
// timeout). The Cloudflare tunnel + provider latency can be slow, so keep this
// generous enough to avoid false positives on a healthy-but-slow first token.
const INACTIVITY_MS = 45_000;

export function MessageProvider({ children }: { children: React.ReactNode }) {
  const [newMessage, setNewMessage] = useState("");
  const [optimisticMsg, setOptimisticMsg] = useState<CleanMessage[] | null>(
    null,
  );
  // Composer is disabled while a stream is in flight (B.3).
  const [streaming, setStreaming] = useState(false);

  // Tracks the active inactivity timer so terminal handling can clear it.
  const inactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMsgChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewMessage(event.target.value);
  };

  // Core streaming orchestrator (B.3). Live-appends an optimistic user message
  // (when sending content) plus an assistant bubble that shows a typing
  // indicator immediately and then grows as chunks arrive — all into
  // `chatHistory`. Every termination (done / error / fetch reject / EOF /
  // inactivity) funnels through ONE finally that re-enables the composer.
  //
  // `setChatHistory` is injected by the caller (chat.tsx passes the main convo
  // setter; miniInput passes the branch-window setter) so this context doesn't
  // depend on either convo context — the same orchestrator drives both surfaces.
  const streamReply = async (
    convoId: string,
    {
      content,
      firstReply,
      setChatHistory,
      seedUser,
    }: {
      content?: string;
      firstReply?: boolean;
      setChatHistory: React.Dispatch<
        React.SetStateAction<CleanMessage[] | null>
      >;
      // When true, seed the optimistic user message into chatHistory before
      // streaming (normal sends). For firstReply handoff the user message is
      // already seeded by the caller, so they pass false.
      seedUser?: boolean;
    },
  ) => {
    const assistantId = crypto.randomUUID();
    let receivedChunk = false; // at least one content chunk has landed
    let errored = false;

    // Seed the optimistic user bubble (subsequent sends). The home → chat and
    // branch first-message handoffs seed the user message in the caller instead.
    if (seedUser && content) {
      const userMsg: CleanMessage = {
        id: crypto.randomUUID(),
        convoId,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      };
      setChatHistory((prev) => [...(prev ?? []), userMsg]);
    }

    setStreaming(true);

    // Show the assistant bubble IMMEDIATELY with empty content — Message renders
    // empty assistant content as an animated typing indicator, giving instant
    // feedback during the tunnel/model latency before the first token.
    const assistantMsg: CleanMessage = {
      id: assistantId,
      convoId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
    };
    setChatHistory((prev) => [...(prev ?? []), assistantMsg]);

    // Drop the placeholder assistant bubble (used when the stream ends with no
    // content at all, e.g. a 409 no-key handled by triggerNoApiKey — we don't
    // want a stray typing/interrupted bubble in that case).
    const removeAssistant = () => {
      setChatHistory((prev) =>
        prev ? prev.filter((m) => m.id !== assistantId) : prev,
      );
    };

    const clearInactivity = () => {
      if (inactivityRef.current) {
        clearTimeout(inactivityRef.current);
        inactivityRef.current = null;
      }
    };

    // Mark the streaming assistant message as interrupted in-place (error / EOF
    // / inactivity). Appends a sentinel line to the message body; it renders
    // inline as plain text (no dedicated component affordance) so the user sees
    // the reply was interrupted.
    const markInterrupted = () => {
      setChatHistory((prev) => {
        if (!prev) return prev;
        return prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `${m.content}\n\n⚠ response interrupted` }
            : m,
        );
      });
    };

    let settled = false;
    // Inactivity watchdog: if no chunk lands within INACTIVITY_MS, treat the
    // stream as interrupted (clear flag, mark message, resolve). Re-armed on
    // each chunk.
    const armInactivity = (resolve: () => void) => {
      clearInactivity();
      inactivityRef.current = setTimeout(() => {
        if (settled) return;
        settled = true;
        errored = true;
        markInterrupted();
        resolve();
      }, INACTIVITY_MS);
    };

    try {
      await new Promise<void>((resolve, reject) => {
        armInactivity(resolve);

        services
          .streamMessage(convoId, {
            content,
            firstReply,
            onChunk: (text) => {
              receivedChunk = true;
              armInactivity(resolve);
              setChatHistory((prev) => {
                if (!prev) return prev;
                return prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + text }
                    : m,
                );
              });
            },
            onError: () => {
              if (settled) return;
              settled = true;
              errored = true;
              clearInactivity();
              markInterrupted();
              resolve();
            },
            onDone: () => {
              if (settled) return;
              settled = true;
              clearInactivity();
              resolve();
            },
          })
          .then(() => {
            // Reader EOF / 409-no-key early return without a terminal frame.
            if (settled) return;
            settled = true;
            clearInactivity();
            // Got partial content but no `done` frame → interrupted. No content
            // at all (e.g. 409 handled by triggerNoApiKey) → drop the empty
            // placeholder bubble entirely.
            if (receivedChunk) {
              errored = true;
              markInterrupted();
            } else {
              removeAssistant();
            }
            resolve();
          })
          .catch((err) => {
            if (settled) return;
            settled = true;
            errored = true;
            clearInactivity();
            markInterrupted();
            reject(err);
          });
      });

      // Happy path: replace chatHistory wholesale from the persisted server
      // state (resolves placeholder id → real id). Skip the refetch on error /
      // interruption so the "⚠ interrupted" affordance survives (MF1-A1).
      if (!errored) {
        const fresh = await services.getMessages(convoId);
        setChatHistory(fresh);
      }
    } catch {
      // Fetch rejection already surfaced the interrupted affordance above.
    } finally {
      // ONE re-enable point for EVERY termination (MF1-A3). On the happy path
      // this runs only after the replace-refetch resolves (avoids a
      // refetch-vs-new-send race); on error/EOF it runs without a refetch.
      clearInactivity();
      setStreaming(false);
    }
  };

  // Legacy signature kept for callers that only have an id (none stream).
  // Non-streaming fallback — retained for safety / mini paths.
  const sendMessage = async (id: string) => {
    setNewMessage("");
    await services.sendMessage({
      content: newMessage,
      role: "user",
      convoId: id,
    });
  };

  return (
    <MessageContext.Provider
      value={{
        newMessage,
        setNewMessage,
        optimisticMsg,
        setOptimisticMsg,
        handleMsgChange,
        sendMessage,
        streaming,
        streamReply,
      }}
    >
      {children}
    </MessageContext.Provider>
  );
}
