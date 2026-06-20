# Phase 1 — Bring Your Own Key (BYOK)

## Overview
Replace the single shared Anthropic key (`new Anthropic()` reading `ANTHROPIC_API_KEY`) with **per-user, encrypted-at-rest API keys** for **both OpenAI and Anthropic**. Users add their own key(s) in a Settings UI, pick a provider + model, and the backend uses the *active* key to call the *active* provider. Keys are encrypted with AES-256-GCM, stored in Supabase, and **never returned to the browser**.

**Non-goals:** no free credits, no shared key, no streaming changes, no billing/usage metering. Keep the existing non-streaming `messages.create` request/response shape.

**Sequencing:** Phase 0 (end-to-end chat) is done and deployed. This phase is purely additive — chat is currently broken *only* because no LLM is configured, so the "no key configured" gate (Task 6) is what restores a working (gated) product.

---

## Architecture decisions (locked from prior dialogue)
- **Providers:** OpenAI **and** Anthropic, both BYOK.
- **Model selection:** provider + specific model from a dropdown (frontend-driven, validated server-side against an allow-list).
- **Key handling:** store **both** providers' keys; one row per `(user_id, provider)`. A single `is_active` provider per user determines which key+model is used per request.
- **Security:** AES-256-GCM, key from `ENCRYPTION_KEY` env (32 bytes, base64). Encrypted blob + iv + authTag stored. Plaintext key never leaves the backend; API responses return only **masked** metadata (e.g. `sk-…1234`, provider, model, isActive).
- **DB:** Supabase, `user_id` is **text** (matches better-auth ids), consistent with `conversations`/`messages`.

---

## Bucket A — Backend (single agent, `backend/` repo)

All backend work is one cohesive change set (migration + crypto + storage + provider abstraction + routes + getAIResponse rewrite). It touches `index.ts` and `storage.ts` heavily, so it must NOT be split across parallel agents (they'd collide). One backend agent.

### A.1 Migration `0002_user_api_keys.sql`
Create `supabase/migrations/<timestamp>_user_api_keys.sql`:
```sql
create table if not exists user_api_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null,
  provider      text not null check (provider in ('openai','anthropic')),
  encrypted_key text not null,       -- base64(iv).base64(authTag).base64(ciphertext)
  model         text not null,
  is_active     boolean not null default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (user_id, provider)
);
create index if not exists idx_user_api_keys_user_id on user_api_keys(user_id);
```
Apply with `supabase db push` (see [[supabase-chatbot-db]] — project ref `gytflcajqmdjdszceypc`). Note: there is no DB-level "only one active per user" constraint — the storage layer enforces single-active by clearing others on activate (A.4).

### A.2 Encryption util `backend/utils/crypto.ts`
- `encrypt(plaintext: string): string` — AES-256-GCM, random 12-byte IV, returns `iv.authTag.ciphertext` base64-joined.
- `decrypt(blob: string): string` — reverse.
- Key source: `process.env.ENCRYPTION_KEY` (base64, decodes to exactly 32 bytes). Throw a clear error at first use if missing/wrong length. Use Node `crypto` (works under Bun).
- Add `ENCRYPTION_KEY` to `.env.example` with a generation hint: `openssl rand -base64 32`.

### A.3 Provider abstraction `backend/llm/provider.ts`
- `const MODELS = { anthropic: [...], openai: [...] }` — server-side allow-list of selectable models. Anthropic: `claude-sonnet-4-5-20250929` (current default), plus a couple current models. OpenAI: `gpt-4o`, `gpt-4o-mini` (or current). Export for the `/api/models` route.
- `async function generateReply({ provider, model, apiKey, messages }): Promise<string>` — normalizes our `CleanMessage[]`/`Message[]` (role + string content) into each SDK's format and returns assistant text.
  - Anthropic: `new Anthropic({ apiKey })`, `messages.create({ max_tokens: 1000, model, messages })`, extract text from `content`.
  - OpenAI: `new OpenAI({ apiKey })`, `chat.completions.create({ model, messages })`, extract `choices[0].message.content`.
- Add `openai` to `backend/package.json` dependencies (`bun add openai`). Anthropic SDK already present.
- Validate `model` is in the allow-list for `provider`; throw `400`-able error otherwise.

### A.4 Storage: key CRUD (interface + both impls)
Extend `Storage` interface in `backend/db/storage.ts`. Return type for reads is a **masked, no-plaintext** shape. This is the exact, locked `UserKeyMeta` contract (see A.5 "Response shapes"; no longer an "e.g."):
```ts
type UserKeyMeta = {
  provider: 'openai' | 'anthropic';
  model: string;
  isActive: boolean;
  maskedKey: string;   // backend-formatted display string, e.g. "sk-…1234"; frontend never receives raw key material
  updatedAt: string;   // ISO timestamp
};
```
Internal method returns the decrypted material for the request path only.
- `upsertApiKey({ userId, provider, encryptedKey, model }): Promise<UserKeyMeta>` — insert or update on `(user_id, provider)`. **MF5: `upsertApiKey` never reads or writes `is_active`.** Activation happens ONLY via (a) the "first key" branch in `POST /api/keys` — if the user has zero keys, the newly added one is set active — or (b) explicit `POST /api/keys/active` (see A.5). Updating an existing provider's key (rotation) leaves `is_active` unchanged, preventing silent deactivation on key rotation.
- `listApiKeys({ userId }): Promise<UserKeyMeta[]>` — masked metadata only.
- `deleteApiKey({ userId, provider }): Promise<void>`.
- `setActiveProvider({ userId, provider }): Promise<void>` — set chosen provider `is_active=true`, all others for that user `false` (single active).
- `getActiveKey({ userId }): Promise<{ provider, model, apiKey } | null>` — internal; returns **decrypted** key for the request path. Decrypt happens here.
- Implement in **both** `InMemoryStorage` (Map, for tests/local) and `SupabaseStorage`. `maskedKey` is a backend-formatted display string derived from the decrypted key (store nothing extra, or compute on read); the frontend never receives or formats raw key material.

### A.5 Key routes in `index.ts` (all behind `getSession`, owner-scoped)
- `GET /api/models` — returns the allow-list `MODELS`. **Public** — the only unauthenticated `/api/*` route (Open question #2, decided).
- `GET /api/keys` — list current user's masked key metadata.
- `POST /api/keys` — body `{ provider, model, apiKey }`; validate provider+model; `encrypt(apiKey)`; `upsertApiKey`; if it's the user's first key (user has zero keys), mark it active (see MF5 in A.4 — this is one of only two places activation happens). Return masked meta. **Never echo the key.**
- `POST /api/keys/active` — body `{ provider }`; `setActiveProvider`.
- `DELETE /api/keys/:provider` — `deleteApiKey`. **Med7:** if the deleted key was active **and another provider key still exists**, auto-promote the most-recently-updated remaining key (`order by updated_at desc limit 1`; InMemoryStorage mirrors this by picking the max `updatedAt`) to active; only if **no keys remain** does the user fall back to the gated state (keeps CF1's "add a key" gate copy correct).
- Validation: reject unknown provider, model not in allow-list, empty key. Mirror existing error style (`res.status(400).json({error})`).

**Status-code rules (MF3):**
- Unauthenticated (no session) → **401** on all `/api/keys*` routes.
- Key/resource not found for this authenticated user → **404**.
- Note: these new `/api/keys*` routes deliberately use **401-for-no-session**. The legacy `/conversations` route's 404-for-no-session is a known pre-existing inconsistency and must **not** be copied.

**Secret logging (Med1):** Never `console.log` the request body or the key on `POST /api/keys`. The existing routes log `req.body`; the key route must **not** do this.

**Response shapes (MF7) — exact contract for the parallel frontend agent:**
- `GET /api/keys` → array of **configured providers only** (not all providers): `UserKeyMeta[]`, where
  ```ts
  type UserKeyMeta = {
    provider: 'openai' | 'anthropic';
    model: string;
    isActive: boolean;
    maskedKey: string;   // backend-formatted display string, e.g. "sk-…1234"; frontend never receives or formats raw key material
    updatedAt: string;   // ISO timestamp
  };
  ```
- `GET /api/models` → keyed by provider so the per-provider dropdown can index directly:
  ```ts
  type ModelsResponse = Record<'openai' | 'anthropic', string[]>;
  ```
- `POST /api/keys` → returns the created/updated `UserKeyMeta`.

### A.6 Rewrite `getAIResponse` to use the active per-user key
- Change signature to `getAIResponse(convoId, userId)`.
- Inside: `const active = await storage.getActiveKey({ userId })`. If `null` → throw a typed "NO_KEY" error.
- Call `generateReply({ provider: active.provider, model: active.model, apiKey: active.apiKey, messages })`, then `storage.addMessage({ convoId, role: 'assistant', content: text })`.
- Update both call sites: `POST /conversations` (line ~88) and `POST /messages/:id` (line ~178) to pass `session.user.id` and to catch the NO_KEY error → respond `409 { error: "no_api_key", message: "Add an API key in Settings to start chatting." }`.
- Remove `import Anthropic from '@anthropic-ai/sdk'` from `index.ts` (now only used inside `llm/provider.ts`). Remove the shared `ANTHROPIC_API_KEY` reliance.

### A.7 Backend tests
- `crypto.test.ts` — encrypt→decrypt round-trips; tampered authTag throws; wrong-length key throws.
- `keys.test.ts` (supertest) — unauthenticated → **401** (MF3, require 401 specifically); POST key returns masked (no plaintext); list never contains plaintext; set-active flips single active; delete auto-promotes a remaining key (or gates when none remain, per Med7); chat without key → 409.
- Run `bun test`; all green before PR.

---

## Bucket B — Frontend (single agent, `frontend/` repo)

Depends on Bucket A's route contract but can be built in parallel against the documented contract (A.5). One frontend agent.

### B.1 Service layer `frontend/src/services/index.ts`
Add: `getModels()`, `getKeys()`, `addKey({provider, model, apiKey})`, `setActiveProvider(provider)`, `deleteKey(provider)`. Use `withCredentials` as existing calls do.

**MF6 — EXACT URLs the service functions must call:**
- `getKeys()` → `GET ${baseURL}/api/keys`
- `addKey(...)` → `POST ${baseURL}/api/keys`
- `setActiveProvider(...)` → `POST ${baseURL}/api/keys/active`
- `deleteKey(provider)` → `DELETE ${baseURL}/api/keys/${provider}`
- `getModels()` → `GET ${baseURL}/api/models`

Note: these are intentionally `/api`-prefixed, **UNLIKE** the legacy unprefixed chat routes (`/conversations`, `/messages/:id`) — do not drop the `/api` prefix.

### B.2 Settings UI — API keys
- New component `frontend/src/components/settings.tsx` rendered in a shadcn `Dialog` (the project already has `ui/dialog.tsx`).
- Trigger: add a **"Settings"** `DropdownMenuItem` in `profile.tsx` (above "Log out").
- For each provider (OpenAI, Anthropic):
  - Show masked status if a key exists (`sk-…1234`, current model) or "No key" if not.
  - Inputs: password-type API key field + model `<select>` populated from `getModels()`.
  - Save (`addKey`), Remove (`deleteKey`).
- A single **active provider** selector (radio/segmented) calling `setActiveProvider`. Reflect which is active.
- **Never** display a full key; backend only returns masked metadata anyway.

### B.3 "No key configured" gate UX (CF1)
A 409 `no_api_key` can come back from **FOUR** frontend send entry points:
1. `homeInput.tsx`
2. `messageContext.sendMessage` (used by `input.tsx`)
3. `miniInput.tsx` — which calls **BOTH** `createConversation` **AND** `sendMessage`

**Rather than per-component catch blocks, mandate a centralized 409 interceptor in `frontend/src/services/index.ts`** — e.g. an axios response interceptor that detects `status === 409 && data.error === 'no_api_key'` and either surfaces a typed `NoApiKeyError` or triggers the shared "open Settings" handler. **All current and future callers inherit this** — no per-component 409 handling is needed.

When the interceptor fires, surface a friendly inline prompt ("Add an API key in Settings to start chatting") with a button that opens the Settings dialog, instead of a generic error.

### B.4 Frontend build sanity
- Must build with `bunx vite build` cleanly (see [[homeserver-deploy]] — `tsc -b` is not the build path; shared `types.ts` stays `import type`). No new value-imports of backend-only packages.

---

## Bucket C — Integration, deploy, validate (orchestrator + 1 agent, after A & B merge)

### C.1 Env + secrets
- Generate `ENCRYPTION_KEY` (`openssl rand -base64 32`); add to local `.env`/test env and to `~/chatbot/.env.production` on the homeserver. Document in `.env.example`.
- Confirm `USE_SUPABASE=true` on server; `ANTHROPIC_API_KEY` no longer required.

### C.2 Migration apply
- `supabase db push` to apply `user_api_keys` to project `gytflcajqmdjdszceypc`.

### C.3 Deploy
- Native build on homeserver via `deploy-homeserver.sh` (see [[homeserver-deploy]] — must build on server, not cross-build).

### C.4 End-to-end validation (loopy)
- Sign in on easybranch.net, open Settings, add an OpenAI key + an Anthropic key, switch active provider, send a message with each, confirm replies come from the selected provider/model.
- Confirm: no key → 409 gate shows; `GET /api/keys` never returns plaintext (curl check); cross-user isolation (user A can't see/use user B's keys).

---

## Risks / watch-items
- **Bun + Node `crypto`**: AES-256-GCM via `node:crypto` works under Bun; verify in test, not just locally.
- **`ENCRYPTION_KEY` rotation**: out of scope, but note that changing the key invalidates all stored keys (document it; don't build rotation now).
- **Type sharing**: `types.ts` is consumed by the frontend bundle; any new shared key types must be `import type`-safe (no runtime SDK imports leaking to frontend).
- **Provider response shape**: OpenAI vs Anthropic content extraction differ; the normalization in `provider.ts` is the only place that should know SDK specifics.
- **Model allow-list drift**: hard-coded model lists go stale; keep them in one place (`provider.ts`) and surface via `/api/models` so the frontend never hard-codes.
- **A/B parallelism**: both buckets are single-agent; A and B can run concurrently against the A.5 contract. C is strictly after A+B integrate.

## Open questions for review (all resolved)
1. **DECIDED:** active = provider; each provider remembers its own model. (Active is the provider, not a (provider, model) tuple.)
2. **DECIDED:** `/api/models` is **public** — the only unauthenticated `/api/*` route.
3. **DECIDED:** mask via a backend-formatted `maskedKey` string (e.g. `"sk-…1234"`); the frontend never receives or formats raw key material.
