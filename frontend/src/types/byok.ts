// TEMPORARY local type aliases for the BYOK contract (A.5 of phase-1-byok plan).
//
// The backend agent OWNS `types/types.ts` and is adding `Provider` and
// `UserKeyMeta` there as plain literal types in parallel. Once that lands, the
// frontend should import those from `types/types.ts`. These aliases match the
// locked contract exactly so the integration merge lines up.
export type Provider = 'openai' | 'anthropic'

export type UserKeyMeta = {
  provider: Provider
  model: string
  isActive: boolean
  maskedKey: string // backend-formatted display string, e.g. "sk-…1234"
  updatedAt: string // ISO timestamp
}

// GET /api/models is keyed by provider so each provider dropdown indexes directly.
export type ModelsResponse = Record<Provider, string[]>

export const PROVIDERS: Provider[] = ['openai', 'anthropic']

export const PROVIDER_LABELS: Record<Provider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
}
