import WebSocket from 'ws';
import Anthropic from '@anthropic-ai/sdk'

export type WSmap = Map<string, Set<WebSocket>>


export type Message =
  Anthropic.MessageParam &
  { id: string, convoId: string, createdAt: string}


}
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
  save: true | false;
}

export interface CreateConversation {
  content: string;
  userId: string;
  save?: true | false;
}

export interface MessageType {
  convoId: string;
  role: "user" | "assistant";
  content: string,
}
