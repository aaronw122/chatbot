import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import Anthropic from '@anthropic-ai/sdk'
import type{WSmap, Message} from '../types/types'
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


//user history
let history: (Anthropic.MessageParam & { id: string })[] = [
  {
    role: "user",
    content: "hey claude why did britain lose the revolutionary war?",
    id: "1"
  },
  {
    role: "assistant",
    content: "Britain struggled to sustain a war fought 3,000 miles across the Atlantic, with overstretched supply lines and difficulty reinforcing troops, while facing a population that knew the terrain and was fighting for its own homeland.The entry of France, Spain, and the Netherlands turned a colonial rebellion into a global conflict, stretching British military resources to the breaking point and ultimately making the war unsustainable.",
    id: "2"
  }
]

const wsMap: WSmap = new Map<string, Set<WebSocket>>

//pass through whole new array each Req

//right now its simpler, so i will pass through a mock string, but likely will want enabled for multiple chats nayways
const sendNewMessage = (id: string, message: (Anthropic.MessageParam & { id: string })) => {
  //send id of 1 thru the post request
  const connections = wsMap.get('1')

  console.log('updating chat, connections:', connections)

  if (connections) {
    connections.forEach(ws => {
      console.log('ready state?', ws.readyState)

      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'updateChat',
          message
        }))
      }
    });
  }
}

const getAIResponse = async (convoId: string) => {
  const updatedMessages = storage.getConversation({ convoId })
    const client = new Anthropic()
    const params: Anthropic.MessageCreateParams = {
      max_tokens: 1000,
      messages: updatedMessages.map(({ id, convoId, createdAt, ...rest }) => rest),
      model: 'claude-haiku-4-5-20251001'
    }
    const message = await client.messages.create(params)
    return storage.addMessage({ convoId, role: message.role, content: message.content })
}

const getResponseParse = async (message: Message) => {
  if (typeof message.content === 'string' || typeof !message.content[0]) return null
  if (message.content[0]!.type === 'text') {
    const parsedMsg = {
      id: message.id,
      convoId: message.convoId,
      role: "assistant",
      content: message.content[0].text,
      createdAt: message.createdAt
    }
    return parsedMsg
  }
  return null
}

wsApp.ws('/messages/:id/ws', (ws: WebSocket, req) => {
  const id = req.params.id as string;
  //later will check for id generally and have some checks on if the id even exists in history object

  if (!wsMap.has(id)) {
    wsMap.set(id, new Set())
  }

  wsMap.get(id)!.add(ws);

  //once we refactor, fetch exact sessionId history, then check if exists + send.

  const currentMessages = storage.getConversation({convoId: id})

  if (currentMessages) {
    ws.send(JSON.stringify({
      type: 'updateChat',
      currentMessages
    }));
  }

  ws.on('close', () => {
    const connections = wsMap.get('1')
    if (connections) {
      connections.delete(ws)
      if (connections.size === 0) {
        wsMap.delete('1')
      }
    }
  })

  ws.on('error', (error) => {
    console.error('websocket error:', error)
  })

})

app.get('/conversations', async (req: Request, res: Response) => {
  const convos = storage.getConversations({ userId: "1" })
  console.log('convos list', convos)
  res.json(convos)
})

app.post('/conversations', async (req: Request, res: Response) => {
  const { content, save } = req.body
  //for now hardcoding userId
  const newConvo = storage.createConversation({ content: content, userId: '1', save: save })
  storage.addMessage({ convoId: newConvo.id, content: content, role: "user" })
  const aiMsg = await getAIResponse(newConvo.id)
  const aiMsgParsed = await getResponseParse(aiMsg);

  console.log('parsed anthropic', aiMsgParsed)

  const convoWithRes = storage.getConversation({convoId: newConvo.id})
  sendNewMessage('1', aiMsg)
  res.json(convoWithRes)
})

app.get('/messages/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string
  // need to fix axios after as well to send through convoId
  const messages = storage.getConversation({ convoId: id })
  console.log('messages express', messages)
  res.json(messages)
})

app.post('/messages/:id', async (req: Request, res: Response) => {

  const id = req.params.id as string

  const body = req.body

  const post = storage.addMessage({ convoId: id, role: body.role, content: body.content })

  //refactor client handling so they just append new message into history state
  sendNewMessage('1', post)

  const aiMsg = await getAIResponse(id)

  const aiMsgParsed = getResponseParse(aiMsg);

  console.log('parsed anthropic', aiMsgParsed)
  sendNewMessage('1', aiMsg)

  res.json(aiMsg.content)
})

const PORT = 3000

app.listen(PORT, () => {
  console.log(`listening on port ${PORT}`)
})
