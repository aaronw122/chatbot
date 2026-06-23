# Phase 2 — Streaming responses

Revision: 3 (post-review round 2)
Status: IMPLEMENTED on `feat/phase-2-streaming-integration` (Buckets A + B; 50 backend tests pass, frontend build clean). Integration fix: mini-window inline reply restored via opt-in `withReply` on `/conversations`. Bucket C (deploy + loopy validation) pending.

## Goal

Stream assistant replies token-by-token instead of waiting for the full
completion and dumping it at once. Same product, better perceived latency.

**Sequencing:** Phases 0 (chat) and 1 (BYOK) are done and deployed. This is
purely additive — the existing non-streaming path keeps working until each
surface is switched over.

## Current state (grounding)

- `backend/llm/provider.ts` → `generateReply()` awaits the full SDK completion
  and returns a `string`.
- `backend/index.ts` → `getAIResponse(convoId, userId)` loads the active key,
  calls `generateReply`, persists the assistant message via
  `storage.addMessage`, and returns the saved row. Two call sites:
  - `POST /conversations` (first message in a new convo)
  - `POST /messages/:id` (reply in an existing convo)
  - No-key case throws `NoKeyError` → caught → `409 {error:'no_api_key'}`.
- Frontend `services/index.ts` uses `axios` (`withCredentials`), with a global
  `409 no_api_key` response interceptor (`NoApiKeyError`).
- `messageContext.sendMessage()` POSTs and **discards** the result; the chat
  list refreshes separately. (Streaming changes this — see B3.)

## Locked decisions

These are the forks where guessing wrong = rework. Defaults chosen; flagged
where product judgment was applied.

1. **Transport: chunked `fetch` + `ReadableStream`, NOT `EventSource`.**
   EventSource can't POST and is awkward with the better-auth cookie. We POST
   the user message and read the response body as a stream. Body is **NDJSON**
   (`application/x-ndjson`): one JSON object per line, each
   `{"type":"chunk","text":"..."}`, `{"type":"error"}`, or `{"type":"done"}`.
   JSON-escaped token text can never collide with the control frames, so the
   in-band error sentinel (decisions #2/#3) is unambiguous. `axios` can't stream
   in the browser, so streaming calls use native `fetch` (cookies via
   `credentials: 'include'`); the existing axios services stay for everything
   else.

2. **Mid-stream errors:** the no-key `409` gate is checked **before** the first
   byte is sent (key load happens first), so the existing `409 no_api_key`
   contract is preserved for that case. If the provider errors **after**
   streaming has started, we can't change the HTTP status — so we emit a
   sentinel error line and the client surfaces an inline "⚠ response
   interrupted" affordance. Pre-stream provider errors (bad key, quota) still
   return a normal JSON error status.

3. **Persistence on disconnect:** accumulate chunks server-side; persist the
   assistant message when the stream completes normally. On client disconnect
   (`req`/`res` close before completion) **persist the partial text** so the
   user sees what generated rather than losing it. On a provider error
   mid-stream, persist whatever accumulated (may be empty — that's fine).

4. **Scope this phase — split create from first reply.** `POST /conversations`
   STAYS a non-streaming JSON call with its current response shape (message
   array / convo row carrying `convoId`): it creates the convo and persists the
   user's first message but does NOT call the LLM. Both existing consumers
   (`homeInput.tsx` and `miniInput.tsx`) keep working unchanged — `miniInput` is
   a second consumer of this shape, preserved precisely because we keep it
   non-streaming. The streamed first assistant reply is then produced by the
   **same** streaming `POST /messages/:id` path the chat page uses. So this
   phase streams exactly one server route. The branch/mini-convo (`/miniConvo`)
   stays non-streaming for now — short side panel, lower value. Deferred, not
   silently skipped.

## Bucket A — Backend

### A.1 `provider.ts`: `streamReply()`

Add alongside `generateReply` (don't replace it — mini-convo still uses it).

```ts
export async function* streamReply(args: GenerateReplyArgs): AsyncGenerator<string> { ... }
```

- Reuse `assertModelAllowed` + `normalizeMessages` (factor the shared head out).
- Anthropic: `client.messages.stream({...})`, iterate text deltas
  (`for await (const event of stream)` → `content_block_delta` text).
- OpenAI: `client.chat.completions.create({ ..., stream: true })`, iterate
  `chunk.choices[0]?.delta?.content`.
- Yield each non-empty text delta. No `max_tokens` on the OpenAI path
  (GPT-5.x param-minimal compat, matching existing `generateReply`).

### A.2 `index.ts`: streaming send handler

Factor a `streamAIResponse(convoId, userId, res)` helper that mirrors
`getAIResponse` but streams:

1. Load active key. If none → throw `NoKeyError` (caller catches → `409`
   **before** any bytes written).
2. **Persist the incoming user message ONLY when `body.content` is a non-empty
   string** (C1-R2). When the body signals a first-reply-after-create (the
   marker — see below), SKIP the user insert and stream the assistant reply over
   the already-seeded history (the user message `/conversations` just
   persisted). **Ownership rule:** `/conversations` OWNS the first user message;
   `/messages/:id` owns the user message only for subsequent sends. The
   skip-signal the handler keys on MUST be the EXACT same signal the frontend
   sends (one source of truth) — use the `{firstReply:true}` marker (empty/no
   user content).
3. `res.setHeader('Content-Type', 'application/x-ndjson')` (use `res.setHeader`,
   NOT `res.writeHead` — `writeHead` would drop the CORS headers set by upstream
   middleware) + `res.setHeader('X-Accel-Buffering', 'no')`. Flush headers.
4. `for await (const delta of streamReply(...))`: accumulate into a buffer and
   write one NDJSON line per delta: `res.write(JSON.stringify({type:'chunk',text:delta})+'\n')`.
5. **Single-fire persistence guard + single terminal frame (MF1-A1).** `let
   persisted=false; let streamCompleted=false;`. Set `streamCompleted=true`
   immediately before the normal end (after the loop). `req.on('close')` fires
   on normal completion too, so the close listener treats it as a real
   disconnect only if `!streamCompleted`. Both the close path and the
   normal/`finally` path funnel into ONE `finalize({ errored }: { errored:
   boolean })` that: returns early if `persisted`, sets `persisted=true`, calls
   `storage.addMessage({ convoId, role:'assistant', content: buffer })` exactly
   once (full OR partial), then emits **exactly one terminal frame** —
   `{type:'error'}` when `errored`, otherwise `{type:'done'}`, never both, never
   the error frame separately — and `res.end()`s only if `!res.writableEnded`.
   **Exactly one terminal frame is emitted per stream.**
6. Provider error after first byte → call `finalize({ errored:true })` (persists
   partial, emits the single `{type:'error'}` terminal, ends). Normal end →
   `finalize({ errored:false })`.

Wire **only `POST /messages/:id`** to this streaming helper. `POST
/conversations` stays the non-streaming JSON handler (creates convo + persists
the user's first message, no LLM call — see decision #4); the client then
triggers the streamed first reply over `POST /messages/:id` with the
`{firstReply:true}` marker so the user message is not written twice.

### A.3 Backend tests

- `streamReply` yields concatenated text matching a mocked SDK stream
  (provider module is mocked, same pattern as `keys.test.ts`).
- No-key path still returns `409` (header not yet sent).
- Stream completion persists the assembled assistant message.

## Bucket B — Frontend (after A merges)

### B.1 `services/index.ts`: streaming send

Add a `streamMessage` that uses native `fetch` (not axios). **Non-ok responses
(409/401/404/500) are JSON; success is the NDJSON stream** — fork on
`res.ok`/content-type, only `getReader()` when `res.ok`:

```ts
const res = await fetch(`${baseURL}/messages/${convoId}`, {
  method: 'POST', credentials: 'include',
  headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ content, role:'user', convoId }),
})
if (!res.ok) {
  const body = await res.json().catch(() => null)
  if (res.status === 409 && body?.error === 'no_api_key') {
    triggerNoApiKey(body?.message); return   // same handler the axios interceptor fires
  }
  throw new Error(body?.error ?? `stream failed: ${res.status}`)
}
const reader = res.body!.getReader(); const dec = new TextDecoder()
// split buffered text on '\n', JSON.parse each complete line →
// {type:'chunk'} onChunk(text) | {type:'error'} | {type:'done'}
// keep the trailing partial line in the buffer across reads
```

**Shared no-key handler (M2).** Export a module-level `triggerNoApiKey(message)`
from `services/index.ts`. The existing axios interceptor opens Settings by
invoking `noApiKeyHandler` as a side effect — a bare `throw NoApiKeyError`
would NOT open it. Route BOTH the axios interceptor and the fetch path through
`triggerNoApiKey` so the Settings dialog opens identically.

### B.2 New-convo flow (create, then stream)

`createConversation` stays the non-streaming axios call returning the convo
(with `convoId`) — `homeInput.tsx` and `miniInput.tsx` are unchanged. After
create, navigate into the new convo and fire `streamMessage` against `POST
/messages/:convoId` for the first assistant reply (same reader path as B.1).
**Send the first-reply marker (C1-R2):** the create-then-stream handoff POSTs
`{firstReply:true}` with NO user content, so the backend SKIPs the user insert
and does not duplicate the message `/conversations` already persisted.
Follow-up sends in an existing convo keep `{content, role:'user'}` and persist
as today. The marker MUST match the exact signal A.2's handler keys on.
The freshly-created state (seeded user message + live streaming assistant
message) must survive the route transition — see B.3 mount-effect guard.

### B.3 `messageContext` / `chat.tsx`: live append

`chat.tsx` renders `convo.chatHistory` (the array `MessageHistory` keys on
`el.id`); it fetches only on mount and `sendMessage` discards its result — there
is **no** post-send refetch today.

- **Live append into `convo.chatHistory`** (M6): on send, append the optimistic
  user message AND a growing assistant message directly into `convo.chatHistory`,
  growing its `content` as chunks arrive. Do NOT drive the convo surface via
  `optimisticMsg` — `chat.tsx` doesn't render it and wipes it on mount, so that
  prong renders nothing. Reserve `optimisticMsg` solely for the home-page
  pre-navigation bubble.
- **Placeholder id** (M7): the streaming assistant message has no DB id until
  the server persists it. Assign a client `crypto.randomUUID()` so
  `MessageHistory`'s `el.id` key is stable while streaming. (`randomUUID` needs
  a secure context — fine on HTTPS/localhost.)
- **Empty bubble before first token** (Medium): the assistant bubble appended on
  send is empty until the first chunk — show a typing indicator (or defer the
  append until the first chunk arrives) so it doesn't render as a blank row.
- **End-of-stream replace, not append** (M5): on `{type:'done'}`, do ONE
  `getMessages` refetch and REPLACE `chatHistory` wholesale (resolves the
  placeholder id → real persisted id). Replacing rather than appending avoids
  the triple-render / double-row problem.
- **Mount-effect guard** (C1): when arriving from a fresh create with live
  streamed state, the mount effect must NOT `setOptimisticMsg(null)` + refetch
  over the freshly-seeded streaming first message — skip the wipe/refetch in
  that case so the in-flight stream isn't clobbered.
- **Terminal `{type:'error'}` does NOT trigger the done refetch (MF1-A1):** the
  `{type:'error'}` terminal must NOT fire the `done` wholesale replace-refetch
  path (that would overwrite the "⚠ interrupted" affordance with the persisted
  partial, which has no interrupted field). Instead it clears the streaming flag
  and leaves the accumulated partial + "⚠ interrupted" note in place. Render the
  inline "⚠ response interrupted" note on that message.
- **Composer re-enables on EVERY termination (MF1-A3):** the streaming flag
  clears and the composer re-enables on every stream termination —
  `{type:'done'}`, `{type:'error'}`, fetch rejection, and reader EOF/abort —
  funneled through ONE client-side `finally`. Add a client inactivity timeout
  (no chunk for N seconds → treat as interrupted: clear flag, re-enable, show
  the interrupted note). On the happy path, re-enable only AFTER the
  end-of-stream replace-refetch resolves (avoids a refetch-vs-new-send race); on
  error / EOF / rejection, re-enable immediately without a refetch. Minimal
  retry path: composer re-enabled → user sends a new message (a dedicated retry
  button stays deferred).
- While streaming, the composer send is disabled (reuse `disabled` prop).

### B.4 Build sanity

`vite build` clean; manual smoke on the integration branch before deploy.

## Bucket C — Integration, deploy, validate

- Deploy via `deploy-homeserver.sh` (native build on homeserver — Bun segfaults
  cross-building on Apple Silicon).
- Loopy validation on easybranch.net: send a message, confirm tokens stream in
  (not a single dump); reload mid-convo and confirm the persisted reply is
  intact; confirm the no-key `409` gate still opens Settings.
- Confirm streaming survives the Cloudflare tunnel: no `Content-Length`
  (response is chunked), no compression on the stream path, and chunks arrive
  incrementally (not batched). `X-Accel-Buffering` is inert here — don't rely
  on it.

## Risks / watch-items

- **Cloudflare tunnel buffering** — if chunks arrive batched instead of
  incrementally, the tunnel or an intermediate proxy is buffering.
  `X-Accel-Buffering: no` is an nginx directive and is inert for a Cloudflare
  tunnel (harmless to set, but it won't be the lever). The real CF levers are:
  no `Content-Length` (so the response is chunked), no compression on the
  stream, and keeping this on the Bucket C validation checklist. Verify in C.
- **Express 5 streaming** — ensure no global middleware (compression, body
  re-serialization) buffers the response. Check what's mounted before the route.
- **Partial-persist correctness** — interrupted streams persist partial text;
  the end-of-stream replace-refetch (B.3) avoids double-rendering.
- **Reloaded partials are silently untruncated (known limitation)** — storage
  has no `interrupted` field, so a partial reply persisted on disconnect renders
  as a normal complete message on reload (no truncation marker). The "⚠
  interrupted" affordance is in-session only. Adding an `interrupted` flag to the
  message schema is deferred — not addressed this phase.
- **Branch/mini-convo deferred** — explicitly out of scope; still uses
  `generateReply`. Note in the final report.

## Deferred (not this phase)

- Streaming for the branch/mini-convo side panel.
- Stop/cancel button (abort the fetch + server stream mid-flight).
  - **Impl-note (dismissed M4):** `streamReply` could take an optional
    `AbortSignal` wired to `req`-close to abort the upstream SDK stream and save
    tokens — this is the server half of Stop/cancel. Deferred with the button.
- Token usage / cost display.
