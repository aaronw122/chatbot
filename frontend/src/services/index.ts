import axios from 'axios'
import type { Provider, UserKeyMeta, ModelsResponse, UsageResponse } from '../types/byok'
import type { Highlight, HighlightRequest } from '../../../types/types'

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim()
const baseURL = configuredApiUrl || (import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin)

axios.defaults.withCredentials = true;

// --- Centralized 409 "no_api_key" gate (CF1) ---
// A single response interceptor surfaces the backend's 409 no_api_key gate to
// the whole app. Any current or future send path (homeInput, messageContext
// sendMessage, miniInput create+send) inherits this without its own catch block.
export class NoApiKeyError extends Error {
  constructor(message = 'Add an API key in Settings to start chatting.') {
    super(message)
    this.name = 'NoApiKeyError'
  }
}

type NoApiKeyHandler = (error: NoApiKeyError) => void
let noApiKeyHandler: NoApiKeyHandler | null = null

// The Settings dialog registers a handler so the interceptor can prompt the user
// to add a key (open Settings) instead of every caller showing a generic error.
export const onNoApiKey = (handler: NoApiKeyHandler | null) => {
  noApiKeyHandler = handler
}

// Shared no-key trigger (M2). BOTH the axios interceptor (non-streaming paths)
// and the native-fetch streaming path (streamMessage) funnel through this so the
// Settings dialog opens identically. A bare `throw NoApiKeyError` would NOT open
// Settings — only invoking the registered handler does.
export const triggerNoApiKey = (message?: string) => {
  const noKeyError = new NoApiKeyError(message)
  if (noApiKeyHandler) noApiKeyHandler(noKeyError)
  return noKeyError
}

// --- Free-tier gate (402 exhausted / 503 unavailable) ---
// The owner-funded free tier surfaces two gate statuses, both pre-flush JSON:
//   - 402 free_tier_exhausted  → "You've used your N free messages."
//   - 503 free_tier_unavailable → "Free trial is temporarily unavailable."
// Both funnel through ONE trigger into the SAME Settings dialog (server provides
// the copy). This is a SEPARATE handler slot from onNoApiKey so the two gates
// stay independently registrable.
export class FreeTierError extends Error {
  constructor(message = 'Add an API key in Settings to keep chatting.') {
    super(message)
    this.name = 'FreeTierError'
  }
}

type FreeTierHandler = (error: FreeTierError) => void
let freeTierHandler: FreeTierHandler | null = null

// The Settings dialog registers a handler so a 402/503 opens Settings instead of
// every caller showing a generic error.
export const onFreeTierGate = (handler: FreeTierHandler | null) => {
  freeTierHandler = handler
}

// Shared free-tier trigger. BOTH the streaming path (streamMessage, primary) and
// the axios interceptor (defensive fallback for the non-streaming withReply path)
// funnel through this so the Settings dialog opens identically. A bare throw would
// NOT open Settings — only invoking the registered handler does.
export const triggerFreeTierGate = (message?: string) => {
  const freeTierError = new FreeTierError(message)
  if (freeTierHandler) freeTierHandler(freeTierError)
  return freeTierError
}

// --- Free-balance indicator refresh (§9) ---
// Reserve-before-call means freeUsed already includes the in-flight reservation
// while a stream is running, so the "N free messages left" indicator must refresh
// on the NDJSON `done` frame — NOT on send dispatch (which would briefly
// double-subtract). streamMessage fires this when it dispatches the done frame;
// the indicator (chatHeader) registers a listener that re-fetches getUsage().
type UsageChangedHandler = () => void
let usageChangedHandler: UsageChangedHandler | null = null

export const onUsageChanged = (handler: UsageChangedHandler | null) => {
  usageChangedHandler = handler
}

const triggerUsageChanged = () => {
  if (usageChangedHandler) usageChangedHandler()
}

axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status
    const data = error?.response?.data
    if (status === 409 && data?.error === 'no_api_key') {
      const noKeyError = triggerNoApiKey(data?.message)
      return Promise.reject(noKeyError)
    }
    // Secondary/fallback: the streaming path (streamMessage) bypasses axios, so
    // this only fires for the non-streaming withReply create path (no live caller
    // today). Both gate statuses route through the same free-tier trigger.
    if (
      (status === 402 && data?.error === 'free_tier_exhausted') ||
      (status === 503 && data?.error === 'free_tier_unavailable')
    ) {
      const freeTierError = triggerFreeTierGate(data?.message)
      return Promise.reject(freeTierError)
    }
    return Promise.reject(error)
  },
)

const getConversations = async () => {
  const response = await axios.get(`${baseURL}/conversations`)
  return response.data
}

// Response when a conversation is created from a highlight (branch). Without a
// highlight the backend returns the message array (unchanged home path).
export type CreateBranchResponse = { convoId: string; highlightId: string }

const createConversation = async (convoReq: {
  content: string
  save?: true | false
  withReply?: boolean
  highlight?: HighlightRequest
}) => {
  const response = await axios.post(`${baseURL}/conversations`, convoReq)
  return response.data
}

// Fetch all highlights anchored to messages in a conversation. Used to render
// persistent marks on load / SPA nav.
const getHighlights = async (convoId: string): Promise<Highlight[]> => {
  const response = await axios.get(`${baseURL}/conversations/${convoId}/highlights`)
  return response.data
}

// Promote a branch to a standalone sidebar conversation (fullscreen). The
// backend flips `save` -> true.
const promoteConversation = async (convoId: string): Promise<void> => {
  const response = await axios.patch(`${baseURL}/conversations/${convoId}`, { save: true })
  return response.data
}

const getMessages = async (convoId : string) => {
  const response = await axios.get(`${baseURL}/messages/${convoId}`)
  return response.data
}

const sendMessage = async (newReq: { content: string, role: "user" | "assistant", convoId: string }) => {
  const response = await axios.post(`${baseURL}/messages/${newReq.convoId}`, newReq)
  return response.data
}

// --- Streaming send (B.1) ---
// Streams an assistant reply over POST /messages/:convoId using native `fetch`
// (axios cannot stream in the browser). Two request shapes match the backend
// contract:
//   - normal send:      { content, role:'user', convoId }
//   - first reply after /conversations create: { firstReply: true } (no content)
// The success body is an NDJSON stream (application/x-ndjson); non-ok responses
// (409/401/404/500) are plain JSON, so we fork on `res.ok` and only read the
// body as a stream when ok.
export type StreamOpts = {
  content?: string
  firstReply?: boolean
  onChunk: (text: string) => void
  onError: () => void
  onDone: () => void
  signal?: AbortSignal
}

const streamMessage = async (
  convoId: string,
  { content, firstReply, onChunk, onError, onDone, signal }: StreamOpts,
): Promise<void> => {
  const body = firstReply
    ? { firstReply: true }
    : { content, role: 'user', convoId }

  const res = await fetch(`${baseURL}/messages/${convoId}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    const errBody = await res.json().catch(() => null)
    if (res.status === 409 && errBody?.error === 'no_api_key') {
      // Same handler the axios interceptor fires — opens Settings.
      triggerNoApiKey(errBody?.message)
      return
    }
    // PRIMARY free-tier gate. The pre-flush reserve/gate returns a JSON status,
    // so res.ok is false and the body is plain JSON — handle it HERE (not the
    // axios interceptor, which never sees the streaming response). Do NOT bare
    // throw: a throw becomes a generic "interrupted" bubble and never opens
    // Settings. Pass the server copy through unchanged.
    if (
      (res.status === 402 && errBody?.error === 'free_tier_exhausted') ||
      (res.status === 503 && errBody?.error === 'free_tier_unavailable')
    ) {
      triggerFreeTierGate(errBody?.message)
      return
    }
    throw new Error(errBody?.error ?? `stream failed: ${res.status}`)
  }

  if (!res.body) throw new Error('stream failed: no response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // Parse one complete NDJSON line, dispatching to the right callback.
  const dispatch = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let frame: { type?: string; text?: string }
    try {
      frame = JSON.parse(trimmed)
    } catch {
      // Skip malformed lines rather than tearing down the whole stream.
      return
    }
    if (frame.type === 'chunk') {
      onChunk(frame.text ?? '')
    } else if (frame.type === 'error') {
      onError()
    } else if (frame.type === 'done') {
      onDone()
      // Refresh the free-balance indicator now that the in-flight reservation has
      // settled (reserve-before-call already counted it; refreshing earlier would
      // double-subtract).
      triggerUsageChanged()
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // Split on newlines; keep the trailing partial line in the buffer.
    let newlineIdx = buffer.indexOf('\n')
    while (newlineIdx !== -1) {
      const line = buffer.slice(0, newlineIdx)
      buffer = buffer.slice(newlineIdx + 1)
      dispatch(line)
      newlineIdx = buffer.indexOf('\n')
    }
  }
  // Flush any trailing complete frame left without a terminating newline.
  buffer += decoder.decode()
  if (buffer.trim()) dispatch(buffer)
}

const resetMessages = async () => {
  const response = await axios.post(`${baseURL}/reset`)
  return response.data
}

// --- BYOK key management (MF6 — these routes are /api-prefixed, UNLIKE the
// legacy unprefixed /conversations and /messages/:id chat routes) ---
const getModels = async (): Promise<ModelsResponse> => {
  const response = await axios.get(`${baseURL}/api/models`)
  return response.data
}

const getKeys = async (): Promise<UserKeyMeta[]> => {
  const response = await axios.get(`${baseURL}/api/keys`)
  return response.data
}

// GET /api/usage — owner-funded free-tier balance for the session user. Backs the
// free-balance indicator (§9) and the exhaustion popup copy (§8). 401 if no session.
const getUsage = async (): Promise<UsageResponse> => {
  const response = await axios.get(`${baseURL}/api/usage`)
  return response.data
}

const addKey = async (keyReq: { provider: Provider, model: string, apiKey: string }): Promise<UserKeyMeta> => {
  const response = await axios.post(`${baseURL}/api/keys`, keyReq)
  return response.data
}

// Switch the active provider and, optionally, its model in one call. `model` is
// optional for back-compat: the existing 1-arg call in settings.tsx keeps flipping
// the active provider only. When given, the backend validates the model and
// persists it onto the existing key row (no key re-entry) — this is what makes the
// header model switcher (B4) actually persist the selection.
const setActiveProvider = async (provider: Provider, model?: string): Promise<void> => {
  const response = await axios.post(`${baseURL}/api/keys/active`, { provider, model })
  return response.data
}

const deleteKey = async (provider: Provider): Promise<void> => {
  const response = await axios.delete(`${baseURL}/api/keys/${provider}`)
  return response.data
}

export default {
  getMessages,
  sendMessage,
  streamMessage,
  resetMessages,
  getConversations,
  createConversation,
  getHighlights,
  promoteConversation,
  getModels,
  getKeys,
  getUsage,
  addKey,
  setActiveProvider,
  deleteKey,
}
