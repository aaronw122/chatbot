import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { Provider } from '../../types/types'
import type { CleanMessage, Message } from '../../types/types'

// Server-side allow-list of selectable models, keyed by provider so the
// /api/models route and the per-provider dropdown can index directly.
// This is the single source of truth for model selection — the frontend never
// hard-codes model strings.
// Current as of June 2026. Model strings churn fast — when these go stale,
// this is the only place to update (the frontend reads them via /api/models).
export const MODELS: Record<Provider, string[]> = {
  anthropic: [
    'claude-opus-4-8',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
  ],
  openai: [
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
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
  // Optional output cap. Set on the owner-funded free path to bound per-query
  // spend; omitted for BYOK (Anthropic keeps its existing 1000 default, OpenAI
  // stays uncapped — today's behavior). See backend/index.ts FREE_TIER_MAX_TOKENS.
  maxTokens?: number
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

// Shared head for both reply paths: validate the (provider, model) pair and
// normalize stored messages into { role, content } pairs. Factored out so
// generateReply (non-streaming) and streamReply (streaming) stay in lockstep.
function prepareReply({
  provider,
  model,
  messages,
}: GenerateReplyArgs): Array<{ role: ChatRole; content: string }> {
  assertModelAllowed(provider, model)
  return normalizeMessages(messages)
}

// Generate an assistant reply using the active provider + key. Normalizes our
// message shape into each SDK's format and returns the assistant text.
export async function generateReply(args: GenerateReplyArgs): Promise<string> {
  const { provider, model, apiKey, maxTokens } = args
  const normalized = prepareReply(args)

  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      max_tokens: maxTokens ?? 1000,
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
      // Cap only when set (owner-funded free path); BYOK omits it → uncapped.
      ...(maxTokens ? { max_completion_tokens: maxTokens } : {}),
    })
    return completion.choices[0]?.message?.content ?? ''
  }

  // Exhaustiveness guard — unreachable given the Provider union.
  throw new Error(`unsupported provider "${provider as string}"`)
}

// Stream an assistant reply token-by-token. Yields each non-empty text delta as
// it arrives from the provider SDK. Shares the validate+normalize head with
// generateReply via prepareReply. The optional AbortSignal is forwarded to the
// SDK call so an upstream disconnect aborts the provider stream (saves tokens).
export async function* streamReply(
  args: GenerateReplyArgs,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const { provider, model, apiKey, maxTokens } = args
  const normalized = prepareReply(args)
  const sdkMessages = normalized.map(({ role, content }) => ({ role, content }))

  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey })
    const stream = client.messages.stream(
      {
        max_tokens: maxTokens ?? 1000,
        model,
        messages: sdkMessages,
      },
      { signal }
    )
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const text = event.delta.text
        if (text) yield text
      }
    }
    return
  }

  if (provider === 'openai') {
    const client = new OpenAI({ apiKey })
    // Cap only when set (owner-funded free path); BYOK omits it → uncapped.
    // GPT-5.x rejects the legacy max_tokens, so use max_completion_tokens.
    const stream = await client.chat.completions.create(
      {
        model,
        messages: sdkMessages,
        stream: true,
        ...(maxTokens ? { max_completion_tokens: maxTokens } : {}),
      },
      { signal }
    )
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content
      if (text) yield text
    }
    return
  }

  // Exhaustiveness guard — unreachable given the Provider union.
  throw new Error(`unsupported provider "${provider as string}"`)
}
