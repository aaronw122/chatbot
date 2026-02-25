import WebSocket from 'ws';
import Anthropic from '@anthropic-ai/sdk'


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

export type MessageType = Anthropic.MessageParam & { convoId: string }

export type Content = Anthropic.MessageParam["content"]

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
}
