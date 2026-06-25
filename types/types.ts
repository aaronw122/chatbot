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

// A persisted branch-anchored highlight. Offsets are indices into the source
// message's rendered text for the coordinate space named by `anchorVersion`
// (v1 = bare react-markdown text-node concatenation; v2 = the semantic
// canonical-text stream — see frontend/src/lib/textOffsets.ts and
// buildAnchorModel). `branchConvoId` is the conversation the highlight opens.
export interface Highlight {
  id: string;
  messageId: string;
  branchConvoId: string;
  startOffset: number;
  endOffset: number;
  quote: string;
  userId: string | null;
  createdAt: string;
  // Coordinate-space version the offsets belong to. v1 = pre-renderer
  // all-text-node space; v2 = semantic canonical-text space. Never reinterpret
  // offsets across versions; unknown/future versions are preserved verbatim and
  // rendered as an unresolved fallback rather than a mis-placed inline mark.
  anchorVersion: number;
}

// Request shape when creating a branch from a highlight. Sent to POST
// /conversations alongside the typed question. Offsets + quote + messageId only
// — the backend dereferences messageId for full-response model context.
export interface HighlightRequest {
  messageId: string;
  startOffset: number;
  endOffset: number;
  quote: string;
  // Optional coordinate-space version of the offsets. Omitted by the current
  // (pre-v2-renderer) frontend; the backend defaults a missing value to 1. Once
  // the v2 renderer ships, capture sends 2 explicitly.
  anchorVersion?: number;
}

export type MessageType = Anthropic.MessageParam & { convoId: string }

export interface CreateHighlight {
  messageId: string;
  branchConvoId: string;
  startOffset: number;
  endOffset: number;
  quote: string;
  userId?: string | null;
  // Coordinate-space version of the offsets. Optional at the storage boundary;
  // when omitted the storage layer persists 1 (the pre-renderer v1 space).
  anchorVersion?: number;
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
  highlightRevision: number,
  notifyHighlightCreated: () => void,
}
