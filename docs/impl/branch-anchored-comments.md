# Branch — anchored, context-aware comments

Revision: 1

## Goal

Make the highlight→branch flow behave like a Google-Docs comment anchored to a
response: the branch carries the **full original response** as model context,
shows the highlighted snippet as a grayed reference (not stuffed into the user's
message), and is persisted via a pointer back to the source response so it can
be revisited later.

**Sequencing:** Builds directly on the Phase 2 streaming work (the mini-window
now streams through the shared `streamReply` orchestrator). This stacks on
`feat/phase-2-streaming-integration`.

## Locked decisions (from dialogue)

1. **Model context = full original response + highlight + user question.** When
   a branch generates a reply, the model receives the entire response the user
   branched from, plus which snippet they highlighted, plus their question. Sent
   on every turn of the branch (not just the first).
2. **Persistence = pointer-only.** Add to `conversations`:
   - `source_message_id uuid references messages(id) on delete set null` — the
     response the branch was created from (also the "click back to original"
     link). `on delete set null` so deleting the source doesn't delete the branch.
   - `highlight text` — the user-selected substring (can't be derived from the
     id; needed for the grayed reference AND to tell the model what was
     highlighted).
   - **No denormalized snapshot of the response text** (YAGNI). If/when
     cross-user sharing lands, add a snapshot column then — purely additive.
3. **Display.** The highlight becomes a grayed `↳` reference, ChatGPT-style:
   - Before sending: a quote chip above the mini composer with the snippet and
     an `✕` to dismiss (clears the highlight; the branch then has no specific
     anchor but still carries full-response context).
   - After sending / on the first message: a grayed `↳ <snippet>` line above the
     user's first message bubble.
   - The user's message bubble shows **only what they typed** — stop
     concatenating `'"highlight" text'` into the message content.
4. **Full original response is hidden context** — never rendered in the branch
   window (it's dereferenced from `source_message_id` at generation time), only
   the `↳` reference is shown.

## Current state (grounding)

- `frontend/src/components/message.tsx` — the assistant message renders a
  "reply" button; on click it sets `mini.setSelectedText(text)` + opens the
  mini-window. The Message receives its own `id` (the source message id) and
  `content` (the full response) as props — both available at click time.
- `frontend/src/context/miniContext.tsx` — holds `selectedText`, `miniConvoId`,
  `miniChatHistory`, `miniOpen`, etc.
- `frontend/src/components/miniInput.tsx` — first message: builds
  `contextMessage = '"selectedText" messageContent'` (THE concatenation to
  remove) and `createConversation({ content })` (save defaults true → persisted),
  then streams `firstReply`; follow-ups stream via `streamReply(..., seedUser)`.
- `frontend/src/components/miniWindow.tsx` — renders `selectedText` in a
  sub-header today; renders `miniChatHistory` via `MiniMessageHistory`.
- `backend/index.ts` — `POST /conversations` creates the convo + persists the
  user's first message (no LLM unless `withReply`). `streamAIResponse` /
  `getAIResponse` build the model prompt from `storage.getMessages(convoId)`.
- `backend/db/storage.ts` — `createConversation`, `getMessages`,
  `getConversations`; both InMemory + Supabase impls. `conversations` columns:
  id, user_id, title, created_at, updated_at, save. `messages`: id, convo_id,
  role, content, created_at.

## Bucket A — Backend

### A.1 Migration
New versioned migration `supabase/migrations/<ts>_branch_anchors.sql`:
```sql
alter table conversations
  add column if not exists source_message_id uuid references messages(id) on delete set null,
  add column if not exists highlight text;
create index if not exists idx_conversations_source_message_id on conversations(source_message_id);
```
Apply via `supabase db push`.

### A.2 Storage layer (`db/storage.ts`)
- `createConversation` accepts optional `{ highlight?, sourceMessageId? }` and
  persists them (both InMemory + Supabase impls; map camelCase ↔ snake_case
  `source_message_id`).
- The conversation shape returned by `getConversations` / a single-convo getter
  includes `highlight` + `sourceMessageId` so the frontend can render the
  reference on revisit. Add a `getConversation({ convoId })` getter if one
  doesn't exist (needed by A.3 to read source_message_id during generation).

### A.3 Context assembly (`index.ts`)
- `POST /conversations` accepts `{ content, highlight?, sourceMessageId? }` and
  passes them to `storage.createConversation`.
- In the generation path (`streamAIResponse` + `getAIResponse`): before calling
  the provider, load the convo; if `source_message_id` is set, fetch that
  message's content and **prepend a context preamble** to the normalized
  messages — e.g. a leading user/system turn:
  `"For context, you previously wrote:\n\n<source response>\n\nThe user
  highlighted: \"<highlight>\". Their question follows."`
  Then the branch's own messages. This gives full context every turn.
- Keep this scoped to branch convos (source_message_id not null); normal convos
  unchanged.

### A.4 Backend tests
- `createConversation` persists + returns `highlight` + `sourceMessageId`.
- Generation for a branch convo includes the source response + highlight in the
  messages passed to the (mocked) provider; a normal convo does not.

## Bucket B — Frontend

### B.1 Capture source on reply (`miniContext.tsx` + `message.tsx`)
- Add `sourceMessageId: string | null` (+ setter) to miniContext.
- `message.tsx` reply button: also `mini.setSourceMessageId(id)` (the assistant
  message's own id) alongside `setSelectedText(text)`.

### B.2 Send structured branch request (`miniInput.tsx`)
- Stop concatenating the highlight into content. First message:
  `createConversation({ content: typedText, highlight: selectedText,
  sourceMessageId })`, then stream `firstReply`. Follow-ups unchanged (typed
  text only; backend re-derives context from the convo's source_message_id).
- `services.createConversation` request type gains `highlight?` +
  `sourceMessageId?`, passed through in the POST body.

### B.3 Grayed reference UI
- A small `BranchQuote` element rendering `↳ <snippet>` in muted/italic style.
- Before first send: show it above the mini composer with an `✕` that clears
  `selectedText` (+ `sourceMessageId`). (Replaces the current sub-header
  display.)
- After send / when `miniChatHistory` exists: render the `↳ <snippet>` reference
  above the first user message in the branch window.
- User + assistant bubbles render as today (typed text only — no concatenation).

### B.4 Build sanity
`cd frontend && bun run build` clean.

## Bucket C — Integrate, deploy, validate

- Apply migration to the Supabase project (`gytflcajqmdjdszceypc`).
- Deploy via `deploy-homeserver.sh`.
- Loopy validation: highlight text in a response → branch → confirm (a) the user
  bubble shows only the typed text, (b) the grayed `↳` reference shows above the
  composer (dismissable) and above the sent message, (c) the reply reflects
  knowledge of the **full** original response (not just the snippet), (d) the
  convo row has `source_message_id` + `highlight` in the DB.

## ENSURE (acceptance)

- Branch reply demonstrably uses full-response context (ask something only
  answerable from the un-highlighted part of the response).
- User message bubble contains only the typed text.
- Highlight renders as a grayed `↳` reference (above composer + above message),
  dismissable before send.
- `conversations.source_message_id` + `highlight` persisted for branches; null
  for normal convos.
- Deleting the source message nulls the pointer without deleting the branch.

## Risks / watch-items

- **Context size/cost** — prepending the full response every branch turn grows
  tokens; acceptable per decision #1. Watch for very long source responses.
- **camelCase ↔ snake_case** — `source_message_id` mapping in SupabaseStorage
  (the DB is snake_case; storage code is camelCase).
- **Revisit path** — branches are persisted (save defaults true), so they may
  appear in the main sidebar history. Whether branches should be hidden from the
  main history until "promoted to full screen" is a SEPARATE future decision
  (the Google-Docs/full-screen vision) — out of scope here; note only.

## Deferred (not this phase)

- Denormalized response snapshot for cross-user-shareable branches.
- "Click back to original" navigation using `source_message_id`.
- Promote-branch-to-full-conversation (full-screen) flow.
- Hiding branch convos from the main sidebar history.
