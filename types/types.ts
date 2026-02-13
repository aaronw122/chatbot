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
  id: string,
  handleMsgChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void,
  sendMessage: (id: string) => void,
  newChat: () => void,
  newMessage: string
}

export type convoContext = {
  currentView: "newChat" | "chat",
  setCurrentView: React.Dispatch<React.SetStateAction<"newChat" | "chat">>,
  convoId: string;
  setConvoId: React.Dispatch<React.SetStateAction<string>>,
  newMessage: string,
  setNewMessage: React.Dispatch<React.SetStateAction<string>>,
  selectConvo: (id: string) => void,
  handleMsgChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void,
  sendMessage: (id: string) => void,
  createConversation: () => void,
  newChat: () => void
}
