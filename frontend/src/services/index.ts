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

axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status
    const data = error?.response?.data
    if (status === 409 && data?.error === 'no_api_key') {
      const noKeyError = new NoApiKeyError(data?.message)
      if (noApiKeyHandler) noApiKeyHandler(noKeyError)
      return Promise.reject(noKeyError)
    }
    return Promise.reject(error)
  },
)

const getConversations = async () => {
  const response = await axios.get(`${baseURL}/conversations`)
  return response.data
}

const createConversation = async (convoReq: { content: string, save?: true | false}) => {
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
  resetMessages,
  getConversations,
  createConversation,
  getModels,
  getKeys,
  addKey,
  setActiveProvider,
  deleteKey,
}
