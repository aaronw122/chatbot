import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import Anthropic from '@anthropic-ai/sdk'
import type{WSmap, Message, CleanMessage} from '../types/types'
import expressWs, { type Application } from 'express-ws';
import cors from 'cors';
import type { WebSocket } from 'ws';
import { InMemoryStorage, type Storage } from './storage';
import { mcpContent } from '@anthropic-ai/sdk/helpers/beta/mcp.js';
import { idText } from 'typescript';
const app = express()

app.use(express.json())

expressWs(app)

const wsApp = app as unknown as Application;

const storage: Storage = new InMemoryStorage();

app.use(cors({ origin: 'http://localhost:5173' }))

type claudeResponse = {
  id: string,
  type: "message" | "image",
  role: "assistant" | "user",
  content: { type: "text"; text: string }[],
  stop_reason: "end_turn" | "max_tokens" | "tool_use" | null;
  stop_sequence: string | null,
  usage?: {
    input_tokens: number,
    output_tokens: number
  },
}

const wsMap: WSmap = new Map<string, Set<WebSocket>>

//pass through whole new array each Req

//right now its simpler, so i will pass through a mock string, but likely will want enabled for multiple chats nayways
const sendNewMessage = (id: string, message: CleanMessage) => {
  //send id of 1 thru the post request
  const connections = wsMap.get(id)

  console.log('updating chat, connections:', connections)

  if (connections) {
    connections.forEach(ws => {
      console.log('ready state?', ws.readyState)

      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'updateChat',
          message
        }))
        console.log('ws send event may dupe', message)
      }
    });
  }
}

const getAIResponse = async (convoId: string) => {
  const updatedMessages = await storage.getConversation({ convoId })
    const client = new Anthropic()
    const params: Anthropic.MessageCreateParams = {
      max_tokens: 1000,
      messages: updatedMessages.map(({ id, convoId, createdAt, ...rest }) => rest),
      model: 'claude-haiku-4-5-20251001'
    }
    const message = await client.messages.create(params)
    return await storage.addMessage({ convoId, role: message.role, content: message.content })
}

wsApp.ws('/messages/:id/ws', async (ws: WebSocket, req) => {
  try {
    const id = req.params.id as string;
    //later will check for id generally and have some checks on if the id even exists in history object
    if (!wsMap.has(id)) {
      wsMap.set(id, new Set())
    }

    wsMap.get(id)!.add(ws);

    //once we refactor, fetch exact sessionId history, then check if exists + send.

    const currentMessages = await storage.getConversation({convoId: id})

    if (currentMessages) {
      ws.send(JSON.stringify({
        type: 'fullHistory',
        currentMessages
      }));
    }

    ws.on('close', () => {
      const connections = wsMap.get(id)
      if (connections) {
        connections.delete(ws)
        if (connections.size === 0) {
          wsMap.delete(id)
        }
      }
    })
    ws.on('error', (error) => {
      console.error('websocket error:', error)
    })
  }

  catch (error) {
    console.log('websocket error', error)
    ws.close()
  }
})

app.get('/conversations', async (req: Request, res: Response) => {
  try {
    const convos = await storage.getConversations({ userId: "1" })
    console.log('convos list', convos)
    res.json(convos)
  }
  catch (error) {
    console.error('failed to get conversation', error)
    res.status(500).json({error: "server error"})
  }
})

app.post('/conversations', async (req: Request, res: Response) => {
  try {
    const { content, save } = req.body
    //for now hardcoding userId
    const newConvo = await storage.createConversation({ content: content, userId: '1', save: save })
    await storage.addMessage({ convoId: newConvo.id, content: content, role: "user" })
    const aiMsg = await getAIResponse(newConvo.id)

    console.log('parsed anthropic', aiMsg)

    const convoWithRes = await storage.getConversation({convoId: newConvo.id})
    sendNewMessage(newConvo.id, aiMsg)
    res.json(convoWithRes)
  }
  catch (error) {
    console.error('failed to add conversation', error)
    res.status(500).json({error: "server error"})
  }
})

app.get('/messages/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string
    // need to fix axios after as well to send through convoId
    const messages = await storage.getConversation({ convoId: id })
    console.log('messages express', messages)
    res.json(messages)
  }
  catch (error) {
      console.error('failed to get messages for convo', error)
      res.status(500).json({error: "server error"})
  }
})

app.post('/messages/:id', async (req: Request, res: Response) => {

  try {
    const id = req.params.id as string
    console.log('messages id', id)

    const body = req.body
    console.log('request body', body)

    const post = await storage.addMessage({ convoId: id, role: body.role, content: body.content })

    console.log('post', post)
    //refactor client handling so they just append new message into history state
    sendNewMessage(id, post)

    //getAIResponse performs the addMessage post inside
    const aiMsg = await getAIResponse(id)

    console.log('parsed anthropic', aiMsg)

    sendNewMessage(id, aiMsg)

    //not firing
    return res.status(200).json({message: "newMessage sent"})
  }
  catch (error) {
      console.error('failed to send message', error)
      res.status(500).json({error: "server error"})
  }
})

const PORT = 3000

app.listen(PORT, () => {
  console.log(`listening on port ${PORT}`)
})
