import type WebSocket from 'ws';
import type Anthropic from '@anthropic-ai/sdk'


export type WSmap = Map<string, Set<WebSocket>>


export type VoidFunc = (event: React.ChangeEvent<HTMLInputElement>) => void

export type Message =
  Anthropic.MessageParam &
  { id: string, convoId: string, createdAt: string }
//will have to write a mapping layer for anthropic so i can properly just pull the content(text out and add here)

export interface Messages {
  messages: Message[];
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  save?: true | false;
}

export interface CreateConversation {
  content: string;
  userId: string;
  save?: true | false;
}

// A persisted branch-anchored highlight. Offsets are UTF-16 indices into the
// source message's canonical-text stream — the single coordinate system
// produced by buildAnchorModel (see frontend/src/lib/anchorModel.ts), stored in
// the `start_offset`/`end_offset` columns. `branchConvoId` is the conversation
// the highlight opens.
export interface Highlight {
  id: string;
  messageId: string;
  branchConvoId: string;
  startOffset: number;
  endOffset: number;
  quote: string;
  userId: string | null;
  createdAt: string;
}

// Request shape when creating a branch from a highlight. Sent to POST
// /conversations alongside the typed question. Offsets + quote + messageId only
// — the backend dereferences messageId for full-response model context.
export interface HighlightRequest {
  messageId: string;
  startOffset: number;
  endOffset: number;
  quote: string;
}

export type MessageType = Anthropic.MessageParam & { convoId: string }

export interface CreateHighlight {
  messageId: string;
  branchConvoId: string;
  startOffset: number;
  endOffset: number;
  quote: string;
  userId?: string | null;
}

export type Content = Anthropic.MessageParam["content"]

// BYOK (Phase 1) — plain literal types. Do NOT add runtime/value imports of the
// OpenAI or Anthropic SDKs to this file: it is bundled by the frontend and a
// value import breaks `vite build`. SDK value-imports stay in backend/llm/provider.ts.
export type Provider = 'openai' | 'anthropic';

export type UserKeyMeta = {
  provider: Provider;
  model: string;
  isActive: boolean;
  maskedKey: string;   // backend-formatted display string, e.g. "sk-…1234"
  updatedAt: string;   // ISO timestamp
};

export interface CleanMessage {
  id: string,
  convoId: string,
  role: "assistant" | "user",
  content: string,
  createdAt: string
}

export interface MessageProps {
  //optional, only need for bubble
  id?: string,
  content: string,
  role: "assistant" | "user",
  // highlights anchored to this message (assistant only); rendered as marks
  highlights?: Highlight[],
}

export type WebSocketMessage = | {
  type: "updateChat",
  message: CleanMessage
} | {type: "fullHistory",
  currentMessages: CleanMessage[]
}

export type SessionType = {
  handleMsgChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void,
  sendMessage: (id: string) => void,
  newMessage: string
}

export type convoContext = {
  convos: Conversation[] | null,
  setConvos: React.Dispatch<React.SetStateAction<null | Conversation[]>>,
  chatHistory: CleanMessage[] | null,
  setChatHistory: React.Dispatch<React.SetStateAction<CleanMessage[] | null>>,
}

export type messageContext = {
  newMessage: string,
  setNewMessage: React.Dispatch<React.SetStateAction<string>>,
  optimisticMsg: CleanMessage[] | null,
  setOptimisticMsg: React.Dispatch<React.SetStateAction<CleanMessage[] | null>>,
  handleMsgChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void,
  sendMessage: (id: string) => void,
}

export type miniContext = {
  miniMessage: string | null,
  setMiniMessage: React.Dispatch<React.SetStateAction<string | null>>,
  miniChatHistory: CleanMessage[] | null,
  setMiniChatHistory: React.Dispatch<React.SetStateAction<CleanMessage[] | null>>,
  miniOpen: boolean,
  setMiniOpen: React.Dispatch<React.SetStateAction<boolean>>,
  selectedText: string | null,
  setSelectedText: React.Dispatch<React.SetStateAction<string | null>>,
  miniConvoId: string | null,
  setMiniConvoId: React.Dispatch<React.SetStateAction<string | null>>,
  // --- branch-anchored highlights (set by the reply button before first send) ---
  // source assistant message the pending highlight anchors to
  sourceMessageId: string | null,
  setSourceMessageId: React.Dispatch<React.SetStateAction<string | null>>,
  // flat offsets of the pending highlight in that message's plain text
  highlightRange: { start: number; end: number } | null,
  setHighlightRange: React.Dispatch<
    React.SetStateAction<{ start: number; end: number } | null>
  >,
  // the highlighted substring (model context + chip/tooltip), never anchoring
  quote: string | null,
  setQuote: React.Dispatch<React.SetStateAction<string | null>>,
  // top offset (px) within the chat scroll content where the floating desktop
  // branch panel anchors, captured from the highlight/selection at open time so
  // the panel scrolls away with that text like a comment (null = unanchored)
  anchorTop: number | null,
  setAnchorTop: React.Dispatch<React.SetStateAction<number | null>>,
  highlightRevision: number,
  notifyHighlightCreated: () => void,
}
