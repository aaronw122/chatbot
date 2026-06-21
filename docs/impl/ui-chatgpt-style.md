# UI Redesign — ChatGPT-style layout, forklet branding (green, light theme)

## Goal
Rebuild the frontend to follow the familiar clean-chat layout convention (the ChatGPT-style arrangement: left conversation sidebar, centered conversation column, bottom composer, centered empty state) but rendered as **forklet**: green accent, light theme, the project's own branding and icons.

**Decisions (locked):** Light theme only · header model switcher (ChatGPT parity) · keep the text-selection → mini-window "branch" feature · full overhaul.

**IP guardrail:** This replicates a *generic, widely-used chat layout pattern* — NOT OpenAI's proprietary assets. Do **not** import, embed, or recreate OpenAI/ChatGPT logos, wordmarks, illustrations, or icon set. Use forklet's name and the project's existing `lucide-react` icons. No reference to "ChatGPT"/"OpenAI" in UI copy.

## Current state (grounding)
- Single git repo (frontend/ + backend/). React 19 + Vite + Tailwind + shadcn. `lucide-react` present.
- Theme already has a green primary (`--primary: oklch(0.6386 0.1404 150.68)`) and light-green card (`--card`, used for the user bubble) in `frontend/src/index.css`.
- Surfaces: sidebar = `components/convoList.tsx` (+ `newChat`, `convoTitle`, `profile`); chat = `pages/chat.tsx` → `messageHistory` → `message`; composer = `components/input.tsx` + `components/homeInput.tsx`; empty/home state = `App.tsx`; settings dialog = `components/settings.tsx` (BYOK); branch feature = `message.tsx` selection → `miniWindow`/mini context.
- Branding is inconsistent: sidebar says "EasyBranch", home says "forklet" / "grow your curiosity". Target: **forklet** everywhere.

---

## Bucket A — Design foundation (1 agent, MUST merge before Bucket B)
Everything else builds on this, so it lands first and the Bucket B agents consume its tokens/conventions (prevents the parallel-agents-produce-inconsistent-styles failure).

### A.1 Design tokens + spec (`frontend/src/index.css` + `frontend/DESIGN.md`)
- Audit/确认 the light-theme token set: green primary (keep current green), neutral gray scale for sidebar/borders/text, surface backgrounds (white main, very-light-gray sidebar), radii, shadows.
- Write a short `frontend/DESIGN.md` documenting the exact tokens + reusable class conventions (message column max-width, sidebar width, composer styling, spacing scale) so Bucket B agents produce a consistent look. This is the contract for Bucket B.
- Confirm/define: sidebar bg, hover/active row colors, user-bubble green, assistant text color, composer border/focus ring (green), font stack.

### A.2 Branding sweep
- Replace all "EasyBranch"/"easy branch" with **forklet**. The only two literal "EasyBranch"/"easy branch" strings are in `convoList.tsx` (sidebar header `convoList.tsx:44`) and `App.tsx` (logged-out branch) — a grep for "EasyBranch" will catch only these two.
- Page `<title>`: in `frontend/index.html` the `<title>` is currently the Vite default `"frontend"` (NOT "EasyBranch", so a grep for "EasyBranch" won't surface it) — set it to **forklet** outright.
- Favicon: currently the default `vite.svg`. Leave unless trivial.
- Keep the "grow your curiosity." tagline for the empty state.

### A.3 App layout shell
- Establish the two-pane shell (fixed sidebar + flexible main column) cleanly in `main.tsx`/layout so the chat column centers with a max width.
- **Centering ownership (binding rule — also document in the A.1 DESIGN.md deliverable):** The shell owns the two-pane geometry, the centered scroll region, and the column `max-width` + horizontal padding. DESIGN.md must document exactly which element owns the centered-column `max-width` + horizontal padding and which element is the scroll container. The composer is page-rendered (B3 is presentational, wired per-page), so **composer *placement* is per-page, not shell-owned**: the in-chat composer is pinned at the bottom of the chat column, and the empty-state composer is centered on the page. Binding rule for downstream agents: **B2/B4/B5 render content-only and MUST NOT add their own `mx-auto`/`max-w-*` wrappers** — column centering lives in the shell only.
- **Current double-centering to undo:** `main.tsx` `justify-center` + `App.tsx` `lg:mx-50` + `chat.tsx` `mx-auto max-w-3xl`. Collapse all of these into the single shell-owned centered column.
- **File ownership (MF2):** A.3 owns ONLY the `main.tsx` shell wrapper — remove the outer margin classes there; do NOT restyle `App.tsx` internals. B5 owns everything inside `App.tsx`.

---

## Bucket A2 — Backend: active-model update (1 small agent, parallel with A)
The header model switcher (B4) must change the active provider's model **without** re-entering the key. Current routes: `setActiveProvider({provider})` flips active; model is only set via `addKey` (which needs the key). Add:
- **`POST /api/keys/active`** — extend to optionally accept `{ provider, model? }`: set provider active AND, if `model` given (validated via `assertModelAllowed`), update that provider's stored `model` (no key required, no re-encryption). This applies only to a provider that already has a key row — keep the existing 404-if-not-configured guard; "no key required" means no re-entry of the key value, not creating a keyless row. Keep back-compat (model optional).
- Storage: add/extend `setActiveProvider({userId, provider, model?})` on the interface + both impls to update the `model` column when provided. Never touches `encrypted_key`. Write `model` onto the `user_api_keys` row for `(userId, provider)` — the same row `getActiveKey` reads — so no chat-path change is required.
- Tests: switching model for an existing provider persists; invalid model → 400; unauth → 401.
- This is the only backend change; keep it isolated so it can merge independently.
- **Frontend service (assigned to B4, see B4):** the frontend `setActiveProvider` service fn in `frontend/src/services/index.ts` currently posts `{ provider }` only — it MUST be extended to `setActiveProvider(provider, model?)` posting `{ provider, model? }`, with `model` optional for back-compat so the existing `settings.tsx` call (1-arg) keeps working. Without this the header switcher (B4) silently no-ops.

---

## Bucket B — Surfaces (parallel agents, after A + A2 merge; all frontend/)

### B1 Sidebar (`convoList`, `newChat`, `convoTitle`, `profile`)
- forklet header (wordmark, green), prominent **"New chat"** button.
- Conversation list: clean rows, hover + active (current route) states, truncation, subtle grouping/spacing. Empty state ("No conversations yet").
- Bottom account area: avatar + name/email, menu with **Settings** (opens BYOK dialog) and **Log out** (already in `profile.tsx` — restyle, add Settings entry if not already surfaced there).

### B2 Chat surface (`chat.tsx`, `messageHistory`, `message`)
- Remove the existing `mx-auto max-w-3xl` centering wrapper from `chat.tsx` (centering now lives in the shell per A.3); render chat content only.
- Centered column, generous vertical rhythm. User message = green bubble, right-aligned; assistant = plain markdown, left-aligned, comfortable line length.
- Hover action on assistant messages: **copy** (lucide `Copy`).
- **Keep the branch feature**: text-selection → floating "reply"/branch button → `miniWindow`. Restyle the full branch-feature surface to match the new look (green accent): `miniWindow.tsx`, `miniInput.tsx`, `miniChats.tsx`, `miniMessage.tsx`, `miniMessageHistory.tsx`, AND the inline reply/branch button in `message.tsx` (it is raw inline markup ~`message.tsx:57-77`, NOT a separate component — `replyButton.tsx` is a dead empty file). Do not remove the mini context wiring or break `@floating-ui/dom` positioning.
- The mini composer (`miniInput.tsx`) + mini message bubbles (`miniMessage.tsx`) MUST consume the same DESIGN.md composer + bubble conventions as B3/B2 so they do not diverge.
- Remove leftover `console.log` in `messageHistory.tsx`/`message.tsx`.

### B3 Composer (`input`, `homeInput`)
- Composer: rounded container, **auto-growing** textarea (grows with content, max height then scrolls), send button (lucide `Send`/arrow) inset on the right, green when enabled / disabled when empty. Enter-to-send, Shift+Enter newline.
- **Shared composer contract (binding):** build the composer as a PRESENTATIONAL component with an injected submit — `<Composer placeholder value onChange onSubmit disabled />`. It owns no data-fetching/mutation logic itself. The in-chat instance passes `onSubmit={() => sendMessage(id)}`; the empty-state instance (B5) passes `onSubmit={createConversation}`.
- **Out of scope for the composer:** the optimistic-history branch currently inside `homeInput.tsx` (where it renders `<Chats>` instead of the input) does NOT move into the composer — it stays in B5/`App.tsx`.
- Placeholder: **"ask follow up"** for the in-chat composer (locked). Shared composer component used by both the in-chat input and the empty-state input; the empty-state instance may use a first-message placeholder (e.g. "ask away") since "ask follow up" implies an ongoing thread.

### B4 Header + model switcher (new `components/chatHeader.tsx`)
- **Extend the frontend service signature (MF6, owned by B4):** `setActiveProvider` in `frontend/src/services/index.ts` currently posts `{ provider }` only — extend it to `setActiveProvider(provider, model?)` posting `{ provider, model? }`. `model` is optional for back-compat so the existing 1-arg call in `settings.tsx` keeps working. **Without this change the header switcher silently no-ops** (the model never reaches the backend).
- Slim top bar in the chat column. Left: active **provider + model dropdown** populated from `GET /api/models` and the user's configured keys (`GET /api/keys` → which providers have keys + current model/active). Selecting an option calls the extended `setActiveProvider(provider, model)` → `POST /api/keys/active` (A2) to switch provider and/or model inline.
- If no key configured: show a subtle "Add a key" affordance that opens Settings (reuse the existing 409 gate handler/`settingsContext`).
- Reflects the active selection; updates optimistically.
- On a failed `POST /api/keys/active` (400/network), roll back the optimistic selection and surface a brief error; reconcile actual state via `GET /api/keys`. Handle the partial state where some providers have no key (don't show a switch that will 404).

### B5 Empty / home state (`App.tsx`)
- Centered greeting (forklet wordmark + "grow your curiosity.") with the shared composer centered on the page (ChatGPT empty-state convention). On submit, behaves like `homeInput` today (create conversation → navigate). Logged-out state: forklet + sign-in (existing `SignIn`), restyled.

### B6 Settings dialog restyle (`settings.tsx`)
- Restyle the existing BYOK dialog to match the new tokens (spacing, inputs, green primary buttons, masked-key display). No behavior change to the BYOK contract.

---

## Bucket C — Integration & verify (orchestrator)
- Merge A + A2 first, then B1–B6 onto the integration branch.
- **Intra-B dependency:** **B5 depends on B3** — the empty-state consumes the shared presentational composer defined in B3, so B3's `<Composer>` component must land (or its contract be fixed) before B5 wires the empty state. Sequence B3 before B5 (or have B5 build against B3's locked signature).
- **Visual cohesion check** (the key risk for parallel UI work): one agent reviews the merged result against `DESIGN.md` — consistent tokens, spacing, green usage, no two surfaces diverging. Fix drift.
- `bunx vite build` must pass (no SDK value-imports; types stay `import type`).
- Deploy to easybranch.net (native build) and eyeball: sidebar, chat (user bubble + assistant markdown), composer (auto-grow, enter-to-send), header model switch actually changes the model used, branch/mini-window still works, settings dialog, empty state.

---

## Risks / watch-items
- **Parallel UI inconsistency** — mitigated by A landing first + `DESIGN.md` as the shared spec + the B-stage cohesion review. This is the #1 risk.
- **B4 ↔ A2 dependency** — the header switcher is the one cross-cutting piece; it depends on the A2 backend endpoint. B4 must not ship a model switch with no backend to persist it.
- **Branch/mini-window regression** — `message.tsx` carries the selection/floating-button logic; restyle without breaking the `@floating-ui/dom` positioning or the mini context calls.
- **Build hygiene** — keep `types/types.ts` `import type`-only; composer/header must not pull SDK value-imports. `vite build` (not `tsc -b`) is the gate.
- **Auto-grow textarea** — common source of layout jank; cap max-height and handle paste.

## Decisions (resolved)
1. **Green** — keep the current `--primary` green.
2. **Composer placeholder** — "ask follow up" (in-chat). Empty state may use a first-message variant.
3. **Model switcher** — one dropdown listing each configured provider's models; pick (provider, model) together in one go (persisted via the extended `POST /api/keys/active`, A2).
