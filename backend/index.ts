import express, { type Request, type Response } from 'express';
import { toNodeHandler, fromNodeHeaders } from "better-auth/node"

import { auth } from "./utils/auth"
import type{WSmap, Message, CleanMessage, Provider} from '../types/types'
import expressWs, { type Application } from 'express-ws';
import cors from 'cors';
import path from 'path';
import type { WebSocket } from 'ws';
import { storage } from './db/storage';
import { MODELS, assertModelAllowed, generateReply, streamReply } from './llm/provider';
import { encrypt } from './utils/crypto';

// Typed error thrown by getAIResponse when the user has no active key configured.
class NoKeyError extends Error {
  constructor() {
    super('NO_KEY')
    this.name = 'NoKeyError'
  }
}

// Thrown (pre-flush) when a free-tier user has consumed their FREE_TIER_LIMIT
// free replies → 402 free_tier_exhausted → frontend opens Settings to add a key.
class FreeTierExhaustedError extends Error {
  constructor() {
    super('FREE_TIER_EXHAUSTED')
    this.name = 'FreeTierExhaustedError'
  }
}

// Thrown when the shared owner key fails on the free path (bad/rate-limited/quota)
// BEFORE any output is delivered → 503 free_tier_unavailable. A post-flush failure
// (mid-stream) cannot become a status code — it surfaces as an NDJSON {type:'error'}
// frame instead (Policy A).
class FreeTierUnavailableError extends Error {
  constructor() {
    super('FREE_TIER_UNAVAILABLE')
    this.name = 'FreeTierUnavailableError'
  }
}

function isProvider(value: unknown): value is Provider {
  return value === 'openai' || value === 'anthropic'
}

// Free-tier limit is the single source of truth for both the exhaustion gate and
// the 402 copy — never hardcode "5".
const FREE_TIER_LIMIT = Number(process.env.FREE_TIER_LIMIT ?? '5')

// Output cap applied ONLY on the owner-funded free path (passed as maxTokens to
// generate/streamReply). Bounds per-query spend on the owner key — important for
// providers like OpenAI whose BYOK path is otherwise uncapped. BYOK requests
// never receive this (Anthropic keeps its built-in 1000 default, OpenAI uncapped).
const FREE_TIER_MAX_TOKENS = 1000

// Free-tier config. A blank FREE_TIER_KEY disables the tier (behavior reverts to
// today's no_api_key gate on first send). When enabled, the forced model is
// validated against the provider allow-list; an invalid model DISABLES the tier
// (logs a warning) rather than 500ing on every free send.
type FreeTierConfig =
  | { enabled: false }
  | { enabled: true; provider: Provider; model: string; apiKey: string }

function computeFreeTierConfig(): FreeTierConfig {
  const apiKey = process.env.FREE_TIER_KEY ?? ''
  if (!apiKey) return { enabled: false }

  const provider = process.env.FREE_TIER_PROVIDER ?? 'openai'
  const model = process.env.FREE_TIER_MODEL ?? 'gpt-5.4-mini'

  if (!isProvider(provider)) {
    console.warn(`free tier disabled: invalid FREE_TIER_PROVIDER "${provider}"`)
    return { enabled: false }
  }
  try {
    assertModelAllowed(provider, model)
  } catch {
    console.warn(`free tier disabled: FREE_TIER_MODEL "${model}" is not allow-listed for "${provider}"`)
    return { enabled: false }
  }
  if (!Number.isFinite(FREE_TIER_LIMIT) || FREE_TIER_LIMIT <= 0) {
    console.warn(`free tier disabled: invalid FREE_TIER_LIMIT "${process.env.FREE_TIER_LIMIT}"`)
    return { enabled: false }
  }
  return { enabled: true, provider, model, apiKey }
}

// Memoized accessor keyed on FREE_TIER_KEY. In production the env is fixed before
// startup, so this computes exactly ONCE (preserving the "read once at startup"
// contract — no per-request env reads). The memo key only matters under the test
// harness, where every suite shares one process + one cached index module: it lets
// a suite that sets FREE_TIER_KEY enable the tier without leaking the enabled
// state into sibling suites that expect it off (their no-key sends must 409).
let cachedFreeTierKey: string | null = null
let cachedFreeTierConfig: FreeTierConfig | null = null
function freeTier(): FreeTierConfig {
  const apiKey = process.env.FREE_TIER_KEY ?? ''
  if (cachedFreeTierConfig !== null && cachedFreeTierKey === apiKey) {
    return cachedFreeTierConfig
  }
  cachedFreeTierKey = apiKey
  cachedFreeTierConfig = computeFreeTierConfig()
  return cachedFreeTierConfig
}

// Validate + log at startup (disable rather than 500 per request on a bad model).
freeTier()

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

// `storage` is the shared singleton from ./db/storage (imported above). It lives
// there, not here, so utils/auth can import it without a circular dependency.

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

// Resolve which key/model/provider a reply should use, implementing the 4-step
// flow: BYOK active key (unlimited, their dime) → else owner-funded free tier
// (FORCED to the cheap Haiku config, ignoring any UI selection) → else NoKeyError.
type ResolvedKey = { provider: Provider; model: string; apiKey: string; isFree: boolean }

const resolveKey = async (userId: string): Promise<ResolvedKey> => {
  const active = await storage.getActiveKey({ userId })
  if (active) {
    return { provider: active.provider, model: active.model, apiKey: active.apiKey, isFree: false }
  }
  const config = freeTier()
  if (config.enabled) {
    // Free branch OVERRIDES provider/model with the forced cheap config.
    return {
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey,
      isFree: true,
    }
  }
  throw new NoKeyError()
}

// ONE shared reserve/gate/release helper used IDENTICALLY by both generation
// entry points so the refund policy + count-cap cannot drift between the
// streaming and non-streaming paths (M2). Returns the resolved key plus a
// `release()` the caller invokes per its terminal-outcome refund predicate (§4).
//
// BYOK path: no-op release, the free counter is never touched.
// Free path: reserve-before-call (THE algorithm) — increment FIRST; if the new
// count exceeds the limit, refund immediately + throw FreeTierExhaustedError.
type ReservedSlot = ResolvedKey & { release: () => Promise<void> }

const reserveFreeSlot = async (userId: string): Promise<ReservedSlot> => {
  const resolved = await resolveKey(userId)
  if (!resolved.isFree) {
    return { ...resolved, release: async () => {} }
  }

  // Reserve a slot atomically (returns the new count). Over the limit → refund
  // the reservation and treat as exhausted (also caps write-amplification from
  // exhausted users' repeated sends — the counter doesn't climb unboundedly).
  const count = await storage.incrementFreeUsage({ userId })
  if (count > FREE_TIER_LIMIT) {
    await storage.releaseFreeUsage({ userId })
    throw new FreeTierExhaustedError()
  }

  let released = false
  const release = async () => {
    if (released) return
    released = true
    await storage.releaseFreeUsage({ userId })
  }
  return { ...resolved, release }
}

const getAIResponse = async (convoId: string, userId: string) => {
  // Reserve/gate runs BEFORE generateReply (and outside the try/catch below), so
  // a FreeTierExhaustedError / storage error is never mis-mapped to a 503.
  const slot = await reserveFreeSlot(userId)

  const updatedMessages = await storage.getMessages({ convoId })
  const providerMessages = await assembleProviderMessages(convoId, updatedMessages)

  let text: string
  try {
    text = await generateReply({
      provider: slot.provider,
      model: slot.model,
      apiKey: slot.apiKey,
      messages: providerMessages,
      // Cap output only on the owner-funded free path.
      maxTokens: slot.isFree ? FREE_TIER_MAX_TOKENS : undefined,
    })
  } catch (err) {
    // Non-streaming refund predicate: release ONLY if generateReply throws before
    // returning (output is atomic — never release after a returned reply).
    if (slot.isFree) {
      await slot.release()
      // Owner-key failure on the free path → 503 (pre-output), not a raw 500.
      throw new FreeTierUnavailableError()
    }
    // BYOK-key failures keep today's behavior.
    throw err
  }
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
  // M4 ordering invariant: reserveFreeSlot runs AFTER getActiveKey (wrapped by
  // resolveKey) but STRICTLY BEFORE writeNdjsonHeaders — the only window where a
  // NoKeyError→409 / FreeTierExhaustedError→402 can still be returned as JSON.
  const slot = await reserveFreeSlot(userId)

  const updatedMessages = await storage.getMessages({ convoId })
  const providerMessages = await assembleProviderMessages(convoId, updatedMessages)

  writeNdjsonHeaders(res)

  // Abort the upstream SDK stream if the client disconnects (saves tokens).
  const abort = new AbortController()

  let buffer = ''
  let persisted = false
  let streamCompleted = false
  let clientDisconnected = false
  // Streaming refund predicate = "zero chunks delivered" (M1). Set the instant
  // the first {type:'chunk'} is written; the free slot is consumed once this is
  // true (or any text persists). Only a pre-first-chunk failure refunds.
  let deliveredAnyChunk = false

  // Single-fire terminal: persists the assembled message exactly once and emits
  // exactly one terminal frame ({error} when errored, else {done}). Never both,
  // never the error frame in addition to done. Owns the free-slot release
  // decision — the one place that knows both "did we deliver anything" and "how
  // did we terminate."
  const finalize = async ({ errored }: { errored: boolean }) => {
    if (persisted) return
    persisted = true
    // Refund ONLY on a pre-first-chunk failure. Complete / error-after-chunk /
    // disconnect-after-chunk all CONSUME the slot (a real reply was delivered).
    if (slot.isFree && !deliveredAnyChunk) {
      await slot.release().catch((err) => console.error('failed to release free slot', err))
    }
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
        provider: slot.provider,
        model: slot.model,
        apiKey: slot.apiKey,
        messages: providerMessages,
        // Cap output only on the owner-funded free path.
        maxTokens: slot.isFree ? FREE_TIER_MAX_TOKENS : undefined,
      },
      abort.signal
    )) {
      if (!delta) continue
      buffer += delta
      deliveredAnyChunk = true
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
    // Defensive coverage for the withReply path (currently no live frontend caller).
    if (error instanceof FreeTierExhaustedError) {
      return res.status(402).json({
        error: "free_tier_exhausted",
        message: `You've used your ${FREE_TIER_LIMIT} free messages. Add your own API key to keep chatting.`,
      })
    }
    if (error instanceof FreeTierUnavailableError) {
      return res.status(503).json({
        error: "free_tier_unavailable",
        message: "Free trial is temporarily unavailable — add your own API key to continue.",
      })
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
      // The gate runs pre-flush (M4 ordering invariant), so these only fire while
      // headers are still unsent → safe to return a JSON status.
      if (error instanceof FreeTierExhaustedError) {
        return res.status(402).json({
          error: "free_tier_exhausted",
          message: `You've used your ${FREE_TIER_LIMIT} free messages. Add your own API key to keep chatting.`,
        })
      }
      if (error instanceof FreeTierUnavailableError) {
        return res.status(503).json({
          error: "free_tier_unavailable",
          message: "Free trial is temporarily unavailable — add your own API key to continue.",
        })
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

// GET /api/usage — free-tier balance for the session user. Session-gated like the
// other /api routes (401 in the /api/keys form, NOT the /conversations 404 form).
// hasOwnKey uses the SAME predicate as the §4 billing gate (getActiveKey() !== null),
// not listApiKeys().length, so the frontend and the routing logic never disagree.
app.get('/api/usage', async (req: Request, res: Response) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
    if (!session) {
      return res.status(401).json({ error: "unauthorized" })
    }

    const userId = session.user.id
    const active = await storage.getActiveKey({ userId })
    const hasOwnKey = active !== null
    // Anonymous-first gate (§3): the frontend reads this FRESH at gate-fire time to
    // branch signup-wall vs BYOK popup — never a mount-captured useSession() value.
    const isAnonymous = (session.user as { isAnonymous?: boolean }).isAnonymous ?? false

    if (!freeTier().enabled) {
      // Free tier off: frontend hides the indicator / free-tier messaging.
      return res.json({
        freeUsed: 0,
        freeLimit: FREE_TIER_LIMIT,
        freeRemaining: 0,
        hasOwnKey,
        freeTierEnabled: false,
        isAnonymous,
      })
    }

    const freeUsed = await storage.getFreeUsage({ userId })
    const freeRemaining = Math.max(FREE_TIER_LIMIT - freeUsed, 0)
    res.json({
      freeUsed,
      freeLimit: FREE_TIER_LIMIT,
      freeRemaining,
      hasOwnKey,
      freeTierEnabled: true,
      isAnonymous,
    })
  }
  catch (error) {
    console.error('failed to get usage', error)
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
