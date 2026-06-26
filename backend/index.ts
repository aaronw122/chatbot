import express, { type Request, type Response } from 'express';
import { toNodeHandler, fromNodeHeaders } from "better-auth/node"

import { auth } from "./utils/auth"
import type{WSmap, Message, CleanMessage, Provider} from '../types/types'
import expressWs, { type Application } from 'express-ws';
import cors from 'cors';
import path from 'path';
import type { WebSocket } from 'ws';
import { InMemoryStorage, SupabaseStorage, type Storage } from './db/storage';
import { MODELS, assertModelAllowed, generateReply, streamReply } from './llm/provider';
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

// NDJSON headers via setHeader (NOT writeHead) so the CORS headers set by the
// cors() middleware survive. X-Accel-Buffering disables nginx buffering (inert
// for the Cloudflare tunnel, harmless to set).
function writeNdjsonHeaders(res: Response) {
  res.setHeader('Content-Type', 'application/x-ndjson')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
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

// Branch context assembly. If `convoId` is a branch (it has a highlight whose
// branch_convo_id points at it), dereference the highlight's source message to
// its full content and PREPEND a single context preamble so the model answers
// with knowledge of the whole source response, not just the highlighted snippet
// (plan decision #7). Normal (non-branch) convos are returned unchanged. Only
// the message array passed to the provider changes — persistence is untouched.
const assembleProviderMessages = async (
  convoId: string,
  baseMessages: Array<CleanMessage | Message>
): Promise<Array<CleanMessage | Message>> => {
  const highlight = await storage.getHighlightByBranch(convoId)
  if (!highlight) return baseMessages

  const source = await storage.getMessage({ id: highlight.messageId })
  // If the source message was regenerated/deleted (cascade should have removed
  // the highlight, but guard anyway), fall back to the branch's own messages.
  if (!source) return baseMessages

  const preamble: CleanMessage = {
    id: `preamble-${convoId}`,
    convoId,
    role: 'user',
    content:
      `For context, here is an earlier response you gave:\n\n` +
      `${source.content}\n\n` +
      `The user highlighted this part: "${highlight.quote}". Their question about it follows.`,
    createdAt: new Date().toISOString(),
  }

  return [preamble, ...baseMessages]
}

const getAIResponse = async (convoId: string, userId: string) => {
  const active = await storage.getActiveKey({ userId })
  if (!active) {
    throw new NoKeyError()
  }

  const updatedMessages = await storage.getMessages({ convoId })
  const providerMessages = await assembleProviderMessages(convoId, updatedMessages)
  const text = await generateReply({
    provider: active.provider,
    model: active.model,
    apiKey: active.apiKey,
    messages: providerMessages,
  })
  return await storage.addMessage({ convoId, role: 'assistant', content: text })
}

// Streaming counterpart of getAIResponse. Loads the active key (throwing
// NoKeyError BEFORE any byte is written so the 409 gate is preserved), then
// streams the assistant reply as NDJSON: one {type:'chunk',text} line per
// delta, terminated by exactly one {type:'done'} XOR {type:'error'} frame.
// Accumulates the full (or partial) text and persists it exactly once via a
// single-fire finalize, regardless of whether the stream completes normally,
// errors mid-flight, or the client disconnects.
const streamAIResponse = async (convoId: string, userId: string, req: Request, res: Response) => {
  const active = await storage.getActiveKey({ userId })
  if (!active) {
    // No bytes written yet — caller catches and returns 409.
    throw new NoKeyError()
  }

  const updatedMessages = await storage.getMessages({ convoId })
  const providerMessages = await assembleProviderMessages(convoId, updatedMessages)

  writeNdjsonHeaders(res)

  // Abort the upstream SDK stream if the client disconnects (saves tokens).
  const abort = new AbortController()

  let buffer = ''
  let persisted = false
  let streamCompleted = false
  let clientDisconnected = false

  // Single-fire terminal: persists the assembled message exactly once and emits
  // exactly one terminal frame ({error} when errored, else {done}). Never both,
  // never the error frame in addition to done.
  const finalize = async ({ errored }: { errored: boolean }) => {
    if (persisted) return
    persisted = true
    try {
      await storage.addMessage({ convoId, role: 'assistant', content: buffer })
    } catch (err) {
      console.error('failed to persist streamed assistant message', err)
    }
    if (!res.writableEnded) {
      res.write(JSON.stringify({ type: errored ? 'error' : 'done' }) + '\n')
      res.end()
    }
  }

  // 'close' fires on normal completion too, so it's only a real disconnect when
  // it arrives before streamCompleted is set. A real disconnect aborts the
  // upstream SDK stream and finalizes the (partial) persist as a non-error.
  // NOTE: we track disconnect via our own flag — req.closed reflects the INCOMING
  // request stream (closed once the body is fully read, even while the response
  // is still open), so it cannot distinguish a disconnect from a provider error.
  res.on('close', () => {
    if (streamCompleted) return
    clientDisconnected = true
    abort.abort()
    void finalize({ errored: false })
  })

  try {
    for await (const delta of streamReply(
      {
        provider: active.provider,
        model: active.model,
        apiKey: active.apiKey,
        messages: providerMessages,
      },
      abort.signal
    )) {
      if (!delta) continue
      buffer += delta
      res.write(JSON.stringify({ type: 'chunk', text: delta }) + '\n')
    }
    streamCompleted = true
    await finalize({ errored: false })
  } catch (err) {
    // A disconnect aborts the SDK stream and surfaces here; the close listener
    // already finalized (or will) — finalize is single-fire so this is safe.
    // A genuine provider error (still connected) is a real error → errored:true.
    streamCompleted = true
    const wasRealError = !clientDisconnected
    if (wasRealError) {
      console.error('stream errored mid-flight', err)
    }
    await finalize({ errored: wasRealError })
  }
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

    const { content, save, withReply, highlight: highlightRequest } = req.body

    // Branch creation (highlight present): create a HIDDEN (save:false) branch
    // conversation anchored to a span of an existing assistant message. Persist
    // the user's typed question, then record the highlight linking this new
    // convo back to the source message. Return { convoId, highlightId } — NOT
    // the message array (the frontend opens a mini-window from this shape).
    if (highlightRequest) {
      const { messageId, startOffset, endOffset, quote } = highlightRequest
      const sourceMessage = typeof messageId === 'string'
        ? await storage.getMessage({ id: messageId })
        : null
      const sourceConversation = sourceMessage
        ? await storage.getConversation({ convoId: sourceMessage.convoId })
        : null

      // NOTE: startOffset/endOffset and `quote` live in the FRONTEND's rendered
      // text-node coordinate space (see frontend/src/lib/textOffsets.ts), NOT
      // the raw markdown stored in source.content. They are opaque to the
      // backend — persisted only so the frontend can re-render the mark, and
      // `quote` is used for the model preamble + tooltip. Do NOT validate them
      // against source.content (rendered text strips markdown / collapses
      // whitespace, so any formatted reply would fail). Validate shape only.
      const hasValidOffsets =
        Number.isInteger(startOffset) &&
        Number.isInteger(endOffset) &&
        startOffset >= 0 &&
        endOffset > startOffset
      const hasValidQuote =
        typeof quote === 'string' &&
        quote.trim().length > 0 &&
        quote.length <= 10_000

      if (
        !sourceMessage ||
        sourceMessage.role !== 'assistant' ||
        !sourceConversation ||
        sourceConversation.userId !== session.user.id ||
        !hasValidOffsets ||
        !hasValidQuote
      ) {
        return res.status(400).json({ error: "invalid highlight" })
      }

      const branchConversation = await storage.createConversation({ content: content, userId: session.user.id, save: false })
      try {
        await storage.addMessage({ convoId: branchConversation.id, content: content, role: "user" })
        const createdHighlight = await storage.createHighlight({
          messageId,
          branchConvoId: branchConversation.id,
          startOffset,
          endOffset,
          quote,
          userId: session.user.id,
        })
        return res.json({ convoId: branchConversation.id, highlightId: createdHighlight.id })
      } catch (error) {
        await storage.deleteConversation({ convoId: branchConversation.id }).catch((rollbackError) => {
          console.error('failed to roll back branch conversation', rollbackError)
        })
        throw error
      }
    }

    // De-LLM'd (Phase 2): by default create the convo + persist the user's first
    // message only. The streamed first assistant reply is produced by the
    // streaming POST /messages/:id path (with the {firstReply:true} marker), so
    // the main-chat (homeInput) path does NOT call the LLM here — doing so would
    // double-generate the first reply.
    const newConvo = await storage.createConversation({ content: content, userId: session.user.id, save: save })
    const userMsg = await storage.addMessage({ convoId: newConvo.id, content: content, role: "user" })

    // Opt-in inline reply: the mini-window (miniInput) is NON-streaming and
    // expects [userMsg, assistantReply] back from create. When `withReply` is
    // truthy, generate + persist the assistant reply here (the pre-streaming
    // shape). Preserve the NoKeyError → 409 gate so the mini-window surfaces the
    // key gate too.
    if (withReply) {
      await getAIResponse(newConvo.id, session.user.id)
    }

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

// GET /conversations/:id/highlights — all highlights anchored to messages in
// this conversation, for the frontend to render marks on load. Owner-scoped.
app.get('/conversations/:id/highlights', async (req: Request, res: Response) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers)
    })

    if (!session) {
      return res.status(401).json({ error: "unauthorized" })
    }

    const conversationId = req.params.id as string

    const conversation = await storage.getConversation({ convoId: conversationId })
    if (!conversation || conversation.userId !== session.user.id) {
      return res.status(404).json({ error: "not found" })
    }

    const conversationHighlights = await storage.getHighlightsByConvo(conversationId)
    res.json(conversationHighlights)
  }
  catch (error) {
    console.error('failed to get highlights for convo', error)
    res.status(500).json({ error: "server error" })
  }
})

// PATCH /conversations/:id { save: true } — fullscreen promotion: flip a hidden
// branch (save:false) into a saved, sidebar-visible conversation. Owner-scoped.
app.patch('/conversations/:id', async (req: Request, res: Response) => {
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

    const { save } = req.body ?? {}
    if (save !== true) {
      return res.status(400).json({ error: "unsupported patch" })
    }

    const updated = await storage.saveConversation({ convoId: id })
    res.json(updated)
  }
  catch (error) {
    console.error('failed to patch conversation', error)
    res.status(500).json({ error: "server error" })
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

    const body = req.body ?? {}

    // Ownership rule: /conversations OWNS the first user message; /messages/:id
    // owns it only for subsequent sends. Persist the incoming user message ONLY
    // when body.content is a non-empty string. A {firstReply:true} marker (no/
    // empty content) signals a first-reply-after-create: SKIP the user insert
    // and stream the assistant reply over the already-seeded history. This skip
    // signal is the single source of truth the frontend must match.
    const hasUserContent = typeof body.content === 'string' && body.content.length > 0
    if (hasUserContent) {
      await storage.addMessage({ convoId: id, role: body.role ?? 'user', content: body.content })
    }

    // Stream the assistant reply as NDJSON. NoKeyError is thrown before any byte
    // is written, so the 409 gate below is safe.
    await streamAIResponse(id, session.user.id, req, res)
  }
  catch (error) {
      if (error instanceof NoKeyError) {
        // Header not yet sent (key load happens before flushHeaders) — JSON 409.
        return res.status(409).json({ error: "no_api_key", message: "Add an API key in Settings to start chatting." })
      }
      console.error('failed to send message', error)
      // If headers were already flushed we cannot change status — end quietly;
      // streamAIResponse's finalize handles the terminal/persist on stream errors.
      if (!res.headersSent) {
        res.status(500).json({error: "server error"})
      } else if (!res.writableEnded) {
        res.end()
      }
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

// SPA fallback: client-side routes (e.g. /chat/:id, /signup) are owned by
// react-router in the browser. On a hard reload or direct link, the request
// reaches this server instead — serve index.html so the SPA boots and routes.
// Registered AFTER all API/static handlers so it only catches unmatched routes;
// unknown /api paths still 404 as JSON rather than returning HTML.
app.get(/.*/, (req: Request, res: Response) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: "not found" })
  }
  res.sendFile(path.join(import.meta.dirname, 'dist', 'index.html'))
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
