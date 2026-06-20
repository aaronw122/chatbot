import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { Provider } from '../../types/types'
import type { CleanMessage, Message } from '../../types/types'

// Server-side allow-list of selectable models, keyed by provider so the
// /api/models route and the per-provider dropdown can index directly.
// This is the single source of truth for model selection — the frontend never
// hard-codes model strings.
export const MODELS: Record<Provider, string[]> = {
  anthropic: [
    'claude-sonnet-4-5-20250929', // current default
    'claude-opus-4-8',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
  ],
}

// Validate a (provider, model) pair against the allow-list. Throws a 400-able
// error if the model is not selectable for that provider.
export function assertModelAllowed(provider: Provider, model: string): void {
  const allowed = MODELS[provider]
  if (!allowed || !allowed.includes(model)) {
    throw new Error(`model "${model}" is not allowed for provider "${provider}"`)
  }
}

// Roles we accept from storage. We coerce anything non-user to 'assistant'.
type ChatRole = 'user' | 'assistant'

type GenerateReplyArgs = {
  provider: Provider
  model: string
  apiKey: string
  messages: Array<CleanMessage | Message>
}

// Normalize our stored messages into { role, content } pairs with string
// content. Storage always persists assistant/user text, so content is a string.
function normalizeMessages(
  messages: Array<CleanMessage | Message>
): Array<{ role: ChatRole; content: string }> {
  return messages.map((msg) => {
    const role: ChatRole = msg.role === 'user' ? 'user' : 'assistant'
    const content = typeof msg.content === 'string' ? msg.content : extractText(msg.content)
    return { role, content }
  })
}

// Defensive text extraction for any non-string content shape (shouldn't happen
// for stored messages, but keeps the normalization total).
function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block && typeof block === 'object' && 'text' in block ? String((block as { text: unknown }).text) : ''
      )
      .join('')
  }
  return ''
}

// Generate an assistant reply using the active provider + key. Normalizes our
// message shape into each SDK's format and returns the assistant text.
export async function generateReply({
  provider,
  model,
  apiKey,
  messages,
}: GenerateReplyArgs): Promise<string> {
  assertModelAllowed(provider, model)
  const normalized = normalizeMessages(messages)

  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      max_tokens: 1000,
      model,
      messages: normalized.map(({ role, content }) => ({ role, content })),
    })
    return message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
  }

  if (provider === 'openai') {
    const client = new OpenAI({ apiKey })
    const completion = await client.chat.completions.create({
      model,
      messages: normalized.map(({ role, content }) => ({ role, content })),
    })
    return completion.choices[0]?.message?.content ?? ''
  }

  // Exhaustiveness guard — unreachable given the Provider union.
  throw new Error(`unsupported provider "${provider as string}"`)
}
