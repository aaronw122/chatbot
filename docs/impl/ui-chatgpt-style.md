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
- Replace all "EasyBranch"/"easy branch" with **forklet** (sidebar header `convoList.tsx:44`, `App.tsx` logged-out title, page `<title>`, favicon if trivial). Keep the "grow your curiosity." tagline for the empty state.

### A.3 App layout shell
- Establish the two-pane shell (fixed sidebar + flexible main column) cleanly in `main.tsx`/layout so the chat column centers with a max width and the composer pins to the bottom. Remove the ad-hoc `m-10`/`mx-50` margins in `main.tsx`/`App.tsx` in favor of the shell.

---

## Bucket A2 — Backend: active-model update (1 small agent, parallel with A)
The header model switcher (B4) must change the active provider's model **without** re-entering the key. Current routes: `setActiveProvider({provider})` flips active; model is only set via `addKey` (which needs the key). Add:
- **`POST /api/keys/active`** — extend to optionally accept `{ provider, model? }`: set provider active AND, if `model` given (validated via `assertModelAllowed`), update that provider's stored `model` (no key required, no re-encryption). Keep back-compat (model optional).
- Storage: add/extend `setActiveProvider({userId, provider, model?})` on the interface + both impls to update the `model` column when provided. Never touches `encrypted_key`.
- Tests: switching model for an existing provider persists; invalid model → 400; unauth → 401.
- This is the only backend change; keep it isolated so it can merge independently.

---

## Bucket B — Surfaces (parallel agents, after A + A2 merge; all frontend/)

### B1 Sidebar (`convoList`, `newChat`, `convoTitle`, `profile`)
- forklet header (wordmark, green), prominent **"New chat"** button.
- Conversation list: clean rows, hover + active (current route) states, truncation, subtle grouping/spacing. Empty state ("No conversations yet").
- Bottom account area: avatar + name/email, menu with **Settings** (opens BYOK dialog) and **Log out** (already in `profile.tsx` — restyle, add Settings entry if not already surfaced there).

### B2 Chat surface (`chat.tsx`, `messageHistory`, `message`)
- Centered column, generous vertical rhythm. User message = green bubble, right-aligned; assistant = plain markdown, left-aligned, comfortable line length.
- Hover action on assistant messages: **copy** (lucide `Copy`).
- **Keep the branch feature**: text-selection → floating "reply"/branch button → `miniWindow`. Restyle the floating button + mini-window to match the new look (green accent). Do not remove the mini context wiring.
- Remove leftover `console.log` in `messageHistory.tsx`/`message.tsx`.

### B3 Composer (`input`, `homeInput`)
- Composer: rounded container, **auto-growing** textarea (grows with content, max height then scrolls), send button (lucide `Send`/arrow) inset on the right, green when enabled / disabled when empty. Enter-to-send, Shift+Enter newline.
- Placeholder: **"ask follow up"** for the in-chat composer (locked). Shared composer component used by both the in-chat input and the empty-state input; the empty-state instance may use a first-message placeholder (e.g. "ask away") since "ask follow up" implies an ongoing thread.

### B4 Header + model switcher (new `components/chatHeader.tsx`)
- Slim top bar in the chat column. Left: active **provider + model dropdown** populated from `GET /api/models` and the user's configured keys (`GET /api/keys` → which providers have keys + current model/active). Selecting an option calls the extended `POST /api/keys/active` (A2) to switch provider and/or model inline.
- If no key configured: show a subtle "Add a key" affordance that opens Settings (reuse the existing 409 gate handler/`settingsContext`).
- Reflects the active selection; updates optimistically.

### B5 Empty / home state (`App.tsx`)
- Centered greeting (forklet wordmark + "grow your curiosity.") with the shared composer centered on the page (ChatGPT empty-state convention). On submit, behaves like `homeInput` today (create conversation → navigate). Logged-out state: forklet + sign-in (existing `SignIn`), restyled.

### B6 Settings dialog restyle (`settings.tsx`)
- Restyle the existing BYOK dialog to match the new tokens (spacing, inputs, green primary buttons, masked-key display). No behavior change to the BYOK contract.

---

## Bucket C — Integration & verify (orchestrator)
- Merge A + A2 first, then B1–B6 onto the integration branch.
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
