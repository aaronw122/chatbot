import express, { type Request, type Response } from 'express';
import { toNodeHandler, fromNodeHeaders } from "better-auth/node"

import { auth } from "./utils/auth"
import type{WSmap, Message, CleanMessage, Provider} from '../types/types'
import expressWs, { type Application } from 'express-ws';
import cors from 'cors';
import path from 'path';
import type { WebSocket } from 'ws';
import { InMemoryStorage, SupabaseStorage, type Storage } from './db/storage';
import { MODELS, assertModelAllowed, generateReply } from './llm/provider';
import { encrypt } from './utils/crypto';

// Typed error thrown by getAIResponse when the user has no active key configured.
class NoKeyError extends Error {
  constructor() {
    super('NO_KEY')
    this.name = 'NoKeyError'
  }
}

function isProvider(value: unknown): value is Provider {
  return value === 'openai' || value === 'anthropic'
}
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

const storage: Storage = process.env.USE_SUPABASE === 'true' ? new SupabaseStorage()
  : new InMemoryStorage()

app.all("/api/auth/{*any}", toNodeHandler(auth))

//pass through whole new array each Req

const getAIResponse = async (convoId: string, userId: string) => {
  const active = await storage.getActiveKey({ userId })
  if (!active) {
    throw new NoKeyError()
  }

  const updatedMessages = await storage.getMessages({ convoId })
  const text = await generateReply({
    provider: active.provider,
    model: active.model,
    apiKey: active.apiKey,
    messages: updatedMessages,
  })
  return await storage.addMessage({ convoId, role: 'assistant', content: text })
}

app.get('/conversations', async (req: Request, res: Response) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers)
    })

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
    const newConvo = await storage.createConversation({ content: content, userId: session.user.id, save: save })
    const userMsg = await storage.addMessage({ convoId: newConvo.id, content: content, role: "user" })

    const aiMsg = await getAIResponse(newConvo.id, session.user.id)

    const convoWithRes = await storage.getMessages({convoId: newConvo.id})
    res.json(convoWithRes)
  }
  catch (error) {
    if (error instanceof NoKeyError) {
      return res.status(409).json({ error: "no_api_key", message: "Add an API key in Settings to start chatting." })
    }
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

    const { content } = req.body

    const newConvo = await storage.createConversation({ content: content, userId: session.user.id, save: false })
    res.json(newConvo)
  }
  catch(error) {
    console.error('failed to create miniConvo', error)
    res.status(500).json({error: "server error"})
  }
})

app.get('/messages/:id', async (req: Request, res: Response) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers)
    })

    if (!session) {
      return res.status(401).json({ error: "unauthorized" })
    }

    const id = req.params.id as string

    const convo = await storage.getConversation({ convoId: id })
    if (!convo || convo.userId !== session.user.id) {
      return res.status(404).json({ error: "not found" })
    }

    // need to fix axios after as well to send through convoId
    const messages = await storage.getMessages({ convoId: id })
    res.json(messages)
  }
  catch (error) {
      console.error('failed to get messages for convo', error)
      res.status(500).json({error: "server error"})
  }
})

app.post('/messages/:id', async (req: Request, res: Response) => {

  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers)
    })

    if (!session) {
      return res.status(401).json({ error: "unauthorized" })
    }

    const id = req.params.id as string

    const convo = await storage.getConversation({ convoId: id })
    if (!convo || convo.userId !== session.user.id) {
      return res.status(404).json({ error: "not found" })
    }

    const body = req.body

    const post = await storage.addMessage({ convoId: id, role: body.role, content: body.content })

    //refactor client handling so they just append new message into history state

    //getAIResponse performs the addMessage post inside
    const aiMsg = await getAIResponse(id, session.user.id)

    res.json(aiMsg)
  }
  catch (error) {
      if (error instanceof NoKeyError) {
        return res.status(409).json({ error: "no_api_key", message: "Add an API key in Settings to start chatting." })
      }
      console.error('failed to send message', error)
      res.status(500).json({error: "server error"})
  }
})

// ----- BYOK (Phase 1): key management routes (all /api-prefixed) -----

// GET /api/models — public allow-list keyed by provider. Only unauthenticated /api/* route.
app.get('/api/models', (_req: Request, res: Response) => {
  res.json(MODELS)
})

// GET /api/keys — list current user's masked key metadata (configured providers only).
app.get('/api/keys', async (req: Request, res: Response) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
    if (!session) {
      return res.status(401).json({ error: "unauthorized" })
    }

    const keys = await storage.listApiKeys({ userId: session.user.id })
    res.json(keys)
  }
  catch (error) {
    console.error('failed to list api keys', error)
    res.status(500).json({ error: "server error" })
  }
})

// POST /api/keys — add/rotate a key. Never log or echo the key (Med1).
app.post('/api/keys', async (req: Request, res: Response) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
    if (!session) {
      return res.status(401).json({ error: "unauthorized" })
    }

    const { provider, model, apiKey } = req.body ?? {}

    if (!isProvider(provider)) {
      return res.status(400).json({ error: "invalid provider" })
    }
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      return res.status(400).json({ error: "empty key" })
    }
    if (typeof model !== 'string') {
      return res.status(400).json({ error: "invalid model" })
    }
    try {
      assertModelAllowed(provider, model)
    } catch {
      return res.status(400).json({ error: "model not allowed" })
    }

    const userId = session.user.id

    // First-key activation (MF5): if the user has zero keys, mark this one active.
    const existing = await storage.listApiKeys({ userId })
    const hadNoKeys = existing.length === 0

    const encryptedKey = encrypt(apiKey)
    const meta = await storage.upsertApiKey({ userId, provider, encryptedKey, model })

    if (hadNoKeys) {
      await storage.setActiveProvider({ userId, provider })
      meta.isActive = true
    }

    res.json(meta)
  }
  catch (error) {
    // Never log req.body here — it contains the plaintext key.
    console.error('failed to add api key')
    res.status(500).json({ error: "server error" })
  }
})

// POST /api/keys/active — set the active provider and, optionally, its model.
// `model` is optional for back-compat: existing 1-arg { provider } calls still
// flip the active provider. When given, the model is validated here (400 on
// failure) and persisted onto the existing key row — no key re-entry required.
app.post('/api/keys/active', async (req: Request, res: Response) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
    if (!session) {
      return res.status(401).json({ error: "unauthorized" })
    }

    const { provider, model } = req.body ?? {}
    if (!isProvider(provider)) {
      return res.status(400).json({ error: "invalid provider" })
    }
    if (model !== undefined) {
      if (typeof model !== 'string') {
        return res.status(400).json({ error: "invalid model" })
      }
      try {
        assertModelAllowed(provider, model)
      } catch {
        return res.status(400).json({ error: "model not allowed" })
      }
    }

    const userId = session.user.id
    const existing = await storage.listApiKeys({ userId })
    if (!existing.some((k) => k.provider === provider)) {
      return res.status(404).json({ error: "not found" })
    }

    await storage.setActiveProvider({ userId, provider, model })
    res.json({ ok: true })
  }
  catch (error) {
    console.error('failed to set active provider', error)
    res.status(500).json({ error: "server error" })
  }
})

// DELETE /api/keys/:provider — delete a key (Med7 auto-promote handled in storage).
app.delete('/api/keys/:provider', async (req: Request, res: Response) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
    if (!session) {
      return res.status(401).json({ error: "unauthorized" })
    }

    const provider = req.params.provider
    if (!isProvider(provider)) {
      return res.status(400).json({ error: "invalid provider" })
    }

    const userId = session.user.id
    const existing = await storage.listApiKeys({ userId })
    if (!existing.some((k) => k.provider === provider)) {
      return res.status(404).json({ error: "not found" })
    }

    await storage.deleteApiKey({ userId, provider })
    res.json({ ok: true })
  }
  catch (error) {
    console.error('failed to delete api key', error)
    res.status(500).json({ error: "server error" })
  }
})

const PORT = 3000

// Export the configured app + storage so tests can drive routes via supertest
// without binding a port. Skip listen() under test.
export { app, storage }

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`listening on port ${PORT}`)
  })
}
