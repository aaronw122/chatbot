import WebSocket from 'ws';
import Anthropic from '@anthropic-ai/sdk'
import type ChangeEvent from 'react'

export type WSmap = Map<string, Set<WebSocket>>


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

export interface ChatProps {
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
  newMessage: string,
  setNewMessage: React.Dispatch<React.SetStateAction<string>>,
  optimisticMsg: CleanMessage[],
  setOptimisticMsg: React.Dispatch<React.SetStateAction<CleanMessage[] | null>>,
  handleMsgChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void,
  sendMessage: (id: string) => void
}
