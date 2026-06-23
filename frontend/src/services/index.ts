import axios from 'axios'
import type { Provider, UserKeyMeta, ModelsResponse } from '../types/byok'

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

axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status
    const data = error?.response?.data
    if (status === 409 && data?.error === 'no_api_key') {
      const noKeyError = triggerNoApiKey(data?.message)
      return Promise.reject(noKeyError)
    }
    return Promise.reject(error)
  },
)

const getConversations = async () => {
  const response = await axios.get(`${baseURL}/conversations`)
  return response.data
}

const createConversation = async (convoReq: { content: string, save?: true | false, withReply?: boolean }) => {
  const response = await axios.post(`${baseURL}/conversations`, convoReq)
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
  getModels,
  getKeys,
  addKey,
  setActiveProvider,
  deleteKey,
}
