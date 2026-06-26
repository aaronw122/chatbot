# Branch — anchored, Google-Docs-style highlight comments

Revision: 2

> Rev 2 supersedes rev 1. Rev 1 persisted the highlight as a `highlight text` +
> `source_message_id` pointer on `conversations` and showed it only as a `↳`
> quote chip **inside** the branch window — it never marked the response itself.
> Rev 2 implements the actual ask: **persistent, clickable highlights rendered in
> the response, like Google Docs comments.** See
> `notes/persistent-highlight-branches.md` (intent spec v1) for the source intent.

## Goal

When a user highlights text in an assistant response and asks a follow-up, the
highlighted span is **saved and rendered as a colored mark inside that response**
(Google-Docs-comment style). The mark persists across reloads. Clicking it
reopens the branch's mini-window with its full saved history. Multiple highlights
per response are allowed and may **overlap / nest**; overlap regions render
darker, and clicking the darker region opens the inner (more-specific) branch.
Hitting **fullscreen** promotes a branch to a full standalone conversation that
appears in the sidebar.

**Sequencing:** Builds on Phase 2 streaming (the mini-window streams through the
shared `streamReply` orchestrator). Stacks on
`feat/phase-2-streaming-integration`.

## Locked decisions (from intent spec v1)

1. **Anchor = text offsets, not the quoted string.** A highlight is
   `message_id` + `start_offset` + `end_offset` into the message's **rendered
   plain-text** (text-node concatenation in document order). Offsets are robust
   because assistant messages are immutable — none of Google Docs' anchor-drift
   machinery is needed. The quoted substring is *also* stored, but only for model
   context + tooltip/fallback, never for anchoring.
2. **Persistence = a `highlights` table** (not columns on `conversations`):
   `(id, message_id, branch_convo_id, start_offset, end_offset, quote, user_id, created_at)`.
   One source message can have many highlights; ranges may overlap/nest. The
   branch is still an ordinary `conversations` row, linked back via the highlight.
3. **Many per message, overlapping/nested allowed.** Rendering uses a
   **segment-sweep**: break the message text at every highlight boundary, render
   each segment with a shade proportional to how many highlights cover it.
4. **Overlap routing.** Clicking a segment opens a branch. If a segment is covered
   by >1 highlight (darker), it routes to the **innermost / most-specific**
   highlight — defined as the smallest covering range, tie-broken by
   most-recently-created. (Matches the user's "click the bolder area → subthread".)
5. **Regenerate clears highlights.** A highlight is anchored to one message row.
   `message_id ... on delete cascade` → replacing/regenerating a message deletes
   its highlight rows (marks vanish cleanly — no marks pointing at wrong text).
   The **branch conversation survives** the source message's deletion (it is a
   separate `conversations` row; it simply loses its anchor/mark). Deleting the
   **branch** removes its highlight (`branch_convo_id ... on delete cascade`).
6. **No text mangling.** The branch's first user message contains **only the
   user's typed question**. Stop concatenating `'"highlight" text'` into content.
7. **Full original response = hidden model context** (kept from rev 1). On every
   branch turn, the generation path dereferences the highlight's `message_id` to
   the full source response and prepends a context preamble so the model answers
   with knowledge of the whole response, not just the snippet.
8. **Fullscreen → standalone sidebar conversation.** Branches are created with
   `save = false` (hidden from the main sidebar). A **fullscreen** action sets
   `save = true`, promoting the branch into the sidebar conversation list; it then
   opens as a normal full conversation (existing `/chat/:id` routing). The inline
   mark on the source response remains either way.

## Out of scope (DON'T — from spec)

- No sharing / read-only shared links yet (purely additive later — add a
  denormalized response snapshot then).
- No re-anchoring highlights on regenerate (they cascade-delete; see #5).
- No branching from within a branch (no highlight handler in mini-window replies).
- No highlight-management UI (no manage panel, rename, color-picker). Create →
  click-to-open → optional delete-on-close only.

## Current state (grounding)

- `frontend/src/components/message.tsx` — assistant message renders content via
  `<Markdown>{content}</Markdown>` (line ~66) inside `<div className="prose ...">`.
  `mouseUpHandler` (~33-57) shows a floating "reply" button; on click it sets
  `mini.setSelectedText(text)` + opens the mini-window. The Message **receives its
  own `id`** (source message id) at the call site (`messageHistory.tsx:12`) but
  does **not destructure it yet** — needed for both offset capture and rendering.
- `frontend/src/components/messageHistory.tsx` — maps `chatHistory` → `<Message>`.
- `frontend/src/context/miniContext.tsx` — `selectedText`, `miniConvoId`,
  `miniChatHistory`, `miniOpen`, etc.
- `frontend/src/components/miniInput.tsx` — first message builds
  `contextMessage = '"selectedText" messageContent'` (THE concatenation to remove)
  then `createConversation({ content })` (save defaults true → persisted), streams
  `firstReply`; follow-ups stream via `streamReply(..., seedUser)`.
- `frontend/src/components/miniWindow.tsx` — fixed bottom-right card
  (`h-[500px] w-96`), renders `selectedText` sub-header + `MiniMessageHistory` +
  `MiniInput`. Only a close (X) button — no fullscreen affordance.
- `frontend/src/context/messageContext.tsx` — `streamReply` orchestrator (shared).
- `frontend/src/services/index.ts` — `createConversation` (POST `/conversations`),
  `getMessages`, `streamMessage` (NDJSON).
- `backend/index.ts` — `POST /conversations` creates convo + first user message
  (`backend/index.ts:193-209`, `withReply` legacy path); `streamAIResponse` /
  `getAIResponse` build the prompt from `storage.getMessages(convoId)`. Unused
  `POST /miniConvo` route (~223-242) creates `save:false` convos — repurpose-able.
- `backend/db/storage.ts` — `createConversation` (title from first 4 words),
  `getMessages`, `getConversations`, `saveConversation` (flips `save`→true, the
  unwired "promote" primitive). InMemory + Supabase impls; DB is snake_case,
  storage code camelCase.
- `supabase/migrations/` — `conversations(id, user_id, title, created_at,
  updated_at, save)`, `messages(id, convo_id, role, content, created_at)`. **No**
  highlights/branch/parent tables. RLS enabled on public tables (see memory) —
  new tables need an RLS policy.
- `types/types.ts` — `Conversation`, `CleanMessage`; neither carries highlight data.

## Bucket A — Backend

### A.1 Migration — `highlights` table
New versioned migration `supabase/migrations/<ts>_highlights.sql`:
```sql
create table if not exists highlights (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  branch_convo_id uuid not null references conversations(id) on delete cascade,
  start_offset int not null,
  end_offset int not null,
  quote text not null,
  user_id text,
  created_at timestamptz not null default now(),
  check (end_offset > start_offset)
);
create index if not exists idx_highlights_message_id on highlights(message_id);
create index if not exists idx_highlights_branch_convo_id on highlights(branch_convo_id);

-- RLS (backend service_role + better-auth/postgres both bypass; see memory)
alter table highlights enable row level security;
```
Branches default to `save = false` so they stay out of the main sidebar until
promoted (no schema change — `conversations.save` already exists; we just stop
defaulting branch creation to saved).

### A.2 Storage layer (`db/storage.ts`)
- `createHighlight({ messageId, branchConvoId, startOffset, endOffset, quote, userId })`
  → inserts a row (InMemory + Supabase; map camelCase ↔ `start_offset` etc.).
- `getHighlightsByConvo(convoId)` → all highlights whose `message_id` belongs to
  a message in `convoId` (join messages on convo_id). Used to render marks when a
  conversation loads.
- `getHighlightByBranch(branchConvoId)` → the single highlight that opened a branch
  (for generation-time context assembly). Returns `{ messageId, quote, ... }`.
- `createConversation` gains optional `{ save = true }` so branch creation can pass
  `save: false`.
- `saveConversation(convoId)` already flips `save`→true — reuse as the fullscreen
  "promote" primitive (A.3).

### A.3 Endpoints (`index.ts`)
- `POST /conversations` accepts an optional `highlight` object:
  `{ content, highlight?: { messageId, startOffset, endOffset, quote } }`.
  When present: create the convo with `save: false`, then `createHighlight(...)`
  linking `branch_convo_id = newConvoId`; return `{ convoId, highlightId }`.
  When absent: unchanged (normal convo, `save: true`).
- `GET /conversations/:id/highlights` → `getHighlightsByConvo(id)` for the
  frontend to render marks on load. (Or fold highlights into the existing messages
  response — pick whichever keeps the message payload clean.)
- `PATCH /conversations/:id` `{ save: true }` → `saveConversation` (fullscreen
  promotion).
- **Branch context assembly** (generation path, `streamAIResponse` + `getAIResponse`):
  before calling the provider, `getHighlightByBranch(convoId)`; if present, fetch
  the source message's content and **prepend a context preamble** to the
  normalized messages, e.g.:
  `"For context, you previously wrote:\n\n<source response>\n\nThe user
  highlighted: \"<quote>\". Their question follows."`
  Then the branch's own messages. Scoped to branch convos only; normal convos
  unchanged.

### A.4 Backend tests (`backend/tests/`)
- `createHighlight` persists + `getHighlightsByConvo` / `getHighlightByBranch`
  return it (offsets + quote round-trip).
- `POST /conversations` with `highlight` creates a `save:false` convo + a linked
  highlight row; without it, a normal `save:true` convo and no highlight.
- Branch generation includes the source response + quote in the messages passed
  to the mocked provider; a normal convo does not.
- Deleting a message cascade-deletes its highlights; the branch convo survives.
- Deleting a branch convo cascade-deletes its highlight.

## Bucket B — Frontend

### B.1 Capture offsets on reply (`message.tsx` + `miniContext.tsx`)
- Destructure `id` in `Message`; give the assistant content a container `ref`.
- On reply-button click, compute the selection's **start/end offsets in the
  container's rendered plain text** (walk text nodes, accumulate length, map the
  `Range` start/end into that flat coordinate space). Capture `quote` = selected
  string.
- Add to miniContext: `sourceMessageId`, `highlightRange {start,end}`, `quote`
  (+ setters). Reply button sets all of them alongside opening the window.

### B.2 Send structured branch request (`miniInput.tsx` + `services/index.ts`)
- Stop concatenating. First message: `createConversation({ content: typedText,
  highlight: { messageId: sourceMessageId, startOffset, endOffset, quote } })`,
  take `{ convoId }`, seed history, stream `firstReply`. Follow-ups: typed text
  only (backend re-derives context from the branch's highlight).
- `services.createConversation` request type gains the optional `highlight` object,
  passed through in the POST body.

### B.3 Render persistent marks (`message.tsx` — the core)
- On load, fetch the conversation's highlights (B.5) and pass each message its
  highlights (keyed by `message_id`).
- **Segment-sweep renderer:** after markdown renders, walk the container's text
  nodes; for the message's highlight ranges, split text nodes at every boundary
  and wrap each covered sub-range in a `<mark>`. Each segment's shade scales with
  **coverage depth** (number of highlights covering it) — deeper = darker. A
  segment carries the list of covering highlight ids ordered by specificity
  (smallest range first, then most-recent).
  - Implementation note: do this as a post-render DOM pass in a layout effect over
    the container ref (decoupled from react-markdown internals), OR via a rehype
    plugin — pick the post-render DOM pass first; it handles ranges crossing
    element boundaries (split per text node, wrap each piece).
- **Click routing:** clicking a segment opens the branch of its **first**
  (most-specific) covering highlight → reopen the mini-window loaded with that
  branch (`miniConvoId = highlight.branchConvoId`, fetch its messages into
  `miniChatHistory`). Darker overlap region → inner subthread, per decision #4.

### B.4 Mini-window: reopen + fullscreen (`miniWindow.tsx` + `miniContext.tsx`)
- **Reopen path:** opening a branch from a mark loads its messages
  (`getMessages(branchConvoId)` → `miniChatHistory`) instead of resetting to a
  fresh branch. Show the `↳ <quote>` reference above the history.
- **Quote chip before first send:** above the composer, show `↳ <quote>` with an
  `✕` to dismiss (clears the pending highlight; branch then carries full-response
  context but no anchor/mark).
- **Fullscreen button:** add a fullscreen/maximize control. On click: `PATCH
  /conversations/:id { save: true }`, close the mini-window, and navigate to
  `/chat/:branchConvoId` (now in the sidebar). The source response's mark remains.

### B.5 Load highlights with a conversation (`services` + `chat.tsx`)
- When a conversation's messages load (main chat), also `GET
  /conversations/:id/highlights` and distribute them to the matching messages so
  marks render on (re)load and SPA nav.

### B.6 Build sanity
`cd frontend && bun run build` clean.

## Bucket C — Integrate, deploy, validate

- Apply migration to Supabase project `gytflcajqmdjdszceypc`
  (`supabase db push`). Confirm RLS enabled on `highlights`.
- Deploy via homeserver flow (build natively on server — see memory).
- **Loopy validation** (curl + Claude-in-Chrome):
  1. Highlight text in a response → ask a follow-up → the highlighted span shows a
     colored mark; the user bubble shows **only the typed text**.
  2. Reload the page → the mark is still there; clicking it reopens the branch with
     its saved history.
  3. Make a second highlight **overlapping** the first → both render; overlap is
     darker; clicking the darker region opens the inner branch, the lighter region
     the outer branch.
  4. Branch reply demonstrably uses **full-response** context (ask something only
     answerable from the un-highlighted part of the response).
  5. Hit **fullscreen** on a branch → it appears in the sidebar and opens as a full
     conversation; survives reload.
  6. Regenerate the source message (or delete it) → its marks disappear cleanly.
  7. DB check: `highlights` row has correct `message_id`, offsets, `quote`,
     `branch_convo_id`; branch convo `save=false` until promoted.

## ENSURE (acceptance — from spec)

- **Persist across reload:** mark renders after reload; click reopens branch +
  history.
- **Overlapping highlights render + route:** both render; overlap darker; bolder
  region → inner subthread, lighter → outer branch.
- **Fullscreen → sidebar convo:** promotes to a full standalone conversation in
  the sidebar; survives reload.
- **Regenerate clears highlights:** replacing a message removes its highlights
  cleanly (cascade) — no orphaned/mis-anchored marks.
- **No text mangling:** branch first message = typed question only; highlight is
  structured data.
- **Full-response context:** branch reply reflects knowledge of the whole source
  response, not just the snippet.

## Risks / watch-items

- **Offset coordinate space.** Selection offsets must be captured and re-applied
  in the **same** space (rendered text-node concatenation). Markdown→DOM means a
  highlight can cross element boundaries — the renderer must wrap per text-node
  sub-range, not assume a single span. This is the hardest part; prototype B.3
  early on a multi-paragraph / code-block response.
- **Whitespace normalization.** Be consistent about how text-node walking treats
  whitespace/`\n` so capture and render offsets agree (round-trip a fixture).
- **Overlap routing tie-breaks.** Smallest-range-then-most-recent; partial
  (non-nested) overlap defaults to most-recent — acceptable per spec, revisit only
  if it bites.
- **Context size/cost.** Prepending the full response every branch turn grows
  tokens; acceptable per decision #7. Watch very long source responses.
- **camelCase ↔ snake_case** mapping for the new `highlights` columns in
  SupabaseStorage.
- **RLS** must be enabled on `highlights` (backend service_role + better-auth
  bypass; see memory) — otherwise the table is unprotected.

## Deferred (not this phase)

- Cross-user-shareable branches (add a denormalized response snapshot then).
- Highlight-management UI (delete/rename/recolor, hover preview of the Q&A).
- Branching from within a branch (highlight handler in mini-window replies).
- Re-anchoring highlights after regenerate (currently cascade-delete).
