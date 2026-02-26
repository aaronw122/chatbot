import express, { type Request, type Response } from 'express';
import { toNodeHandler, fromNodeHeaders } from "better-auth/node"

import { auth } from "./utils/auth"
import Anthropic from '@anthropic-ai/sdk'
import type{WSmap, Message, CleanMessage} from '../types/types'
import expressWs, { type Application } from 'express-ws';
import cors from 'cors';
import path from 'path';
import type { WebSocket } from 'ws';
import { InMemoryStorage, SupabaseStorage, type Storage } from './db/storage';
const app = express()
const allowedOrigins = Array.from(
  new Set(
    [
      process.env.FRONTEND_URL,
      process.env.BETTER_AUTH_URL,
      "http://localhost:5173",
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.replace(/\/+$/, ""))
  )
)

app.use(express.json())
app.use(express.static(path.join(import.meta.dirname, 'dist')))

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}))

const UUIDplaceholder = "00000000-0000-0000-0000-000000000001"

const storage: Storage = process.env.USE_SUPABASE === 'true' ? new SupabaseStorage()
  : new InMemoryStorage()

app.all("/api/auth/{*any}", toNodeHandler(auth))

//pass through whole new array each Req

const getAIResponse = async (convoId: string) => {
  const updatedMessages = await storage.getMessages({ convoId })
    const client = new Anthropic()
    const params: Anthropic.MessageCreateParams = {
      max_tokens: 1000,
      messages: updatedMessages.map(({ id, convoId, createdAt, ...rest }) => rest),
      model: 'claude-sonnet-4-5-20250929'
    }
    const message = await client.messages.create(params)
    return await storage.addMessage({ convoId, role: message.role, content: message.content })
}

app.get('/conversations', async (req: Request, res: Response) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers)
    })

    console.log('session', session)

    if (!session) {
      return res.status(404).json({error: "unauthorized"})
    }

    const convos = await storage.getConversations({ userId: session.user.id })
    res.json(convos)
  }
  catch (error) {
    console.error('failed to get conversation', error)
    res.status(500).json({error: "server error"})
  }
})

app.post('/conversations', async (req: Request, res: Response) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers)
    })

    if (!session) {
      return res.status(404).json({error: "unauthorized"})
    }

    const { content, save } = req.body
    //for now hardcoding userId
    const newConvo = await storage.createConversation({ content: content, userId: session.user.id, save: save })
    const userMsg = await storage.addMessage({ convoId: newConvo.id, content: content, role: "user" })

    const aiMsg = await getAIResponse(newConvo.id)

    console.log('parsed anthropic', aiMsg)

    const convoWithRes = await storage.getMessages({convoId: newConvo.id})
    res.json(convoWithRes)
  }
  catch (error) {
    console.error('failed to add conversation', error)
    res.status(500).json({error: "server error"})
  }
})

app.post('/miniConvo', async (req: Request, res: Response) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers)
    })

    if (!session) {
      return res.status(404).json({ error: "unauthorized" })
    }

    const { content, save, role } = req.body

    const newConvo = await storage.createConversation({ content: content, save: false, role: role })
  }
  catch(error) {
    console.log('failed to create miniConvo', error)
    res.status(500).json({error: "server error"})
  }
})

app.get('/messages/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string
    // need to fix axios after as well to send through convoId
    const messages = await storage.getMessages({ convoId: id })
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

    //getAIResponse performs the addMessage post inside
    const aiMsg = await getAIResponse(id)

    console.log('parsed anthropic', aiMsg)

    //not firing
    res.json(aiMsg)
  }
  catch (error) {
      console.error('failed to send message', error)
      res.status(500).json({error: "server error"})
  }
})

const PORT = 3000

app.listen(PORT, '0.0.0.0', () => {
  console.log(`listening on port ${PORT}`)
})
