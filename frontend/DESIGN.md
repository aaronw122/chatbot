# forklet — Design System Contract

This is the **binding design contract** for the UI redesign (ChatGPT-style clean-chat
layout, **forklet** branding, light theme, green accent). Bucket A owns it; all Bucket B
surface agents (B1–B6) MUST consume these tokens and conventions so the parallel work
produces one consistent look.

**IP guardrail:** Replicate the *generic* clean-chat layout pattern only. Do NOT import,
embed, or recreate OpenAI/ChatGPT logos, wordmarks, illustrations, or icon sets. No
"ChatGPT"/"OpenAI" strings in UI copy. Use the forklet name + the project's existing
`lucide-react` icons.

---

## 1. Design tokens (source of truth: `frontend/src/index.css`)

Light theme only. All tokens are CSS custom properties on `:root`, exposed to Tailwind v4
via `@theme inline` as `--color-*`. **Always reference tokens through Tailwind utility
classes** (`bg-background`, `text-foreground`, `bg-primary`, `border-border`, etc.) — do
NOT hardcode hex/oklch values in components.

### Color tokens (exact values)

| Token | Value (oklch) | Tailwind class | Use |
|-------|---------------|----------------|-----|
| `--background` | `1 0 0` (white) | `bg-background` | Main chat column surface |
| `--foreground` | `0.145 0 0` (near-black) | `text-foreground` | Default text, assistant message text |
| `--card` | `0.9 0.0548 154.4` (light green) | `bg-card` | **User message bubble** |
| `--card-foreground` | `0.145 0 0` | `text-card-foreground` | Text inside the user bubble |
| `--primary` | `0.6386 0.1404 150.68` (green) | `bg-primary` / `text-primary` | Accent: send button (enabled), active states, wordmark accent, primary buttons |
| `--primary-foreground` | `0.985 0 0` (near-white) | `text-primary-foreground` | Text/icon on green primary |
| `--secondary` | `0.97 0 0` | `bg-secondary` | Subtle neutral fills |
| `--muted` | `0.97 0 0` | `bg-muted` | Subtle backgrounds |
| `--muted-foreground` | `0.556 0 0` (mid gray) | `text-muted-foreground` | Secondary/placeholder text, timestamps, hints |
| `--accent` | `0.97 0 0` | `bg-accent` | Hover fills on neutral rows |
| `--accent-foreground` | `0.205 0 0` | `text-accent-foreground` | Text on accent hover |
| `--destructive` | `0.577 0.245 27.325` (red) | `text-destructive` / `bg-destructive` | Errors, log out, delete |
| `--border` | `0.922 0 0` (light gray) | `border-border` | All borders/dividers in main column |
| `--input` | `0.922 0 0` | `border-input` | Input/composer borders |
| `--ring` | `0.6386 0.1404 150.68` (**green**) | `ring-ring` | Focus ring — **green**, used by composer/input focus |

### Sidebar surface tokens

The sidebar uses a distinct very-light-gray surface so it reads as a separate pane from
the white main column.

| Token | Value (oklch) | Tailwind class | Use |
|-------|---------------|----------------|-----|
| `--sidebar` | `0.967 0 0` (very light gray) | `bg-sidebar` | Sidebar background |
| `--sidebar-foreground` | `0.145 0 0` | `text-sidebar-foreground` | Sidebar text |
| `--sidebar-primary` | `0.6386 0.1404 150.68` (green) | `bg-sidebar-primary` | Sidebar accent / active highlight |
| `--sidebar-primary-foreground` | `0.985 0 0` | `text-sidebar-primary-foreground` | Text on sidebar accent |
| `--sidebar-accent` | `0.93 0 0` (light gray) | `bg-sidebar-accent` | **Hover + active conversation row fill** |
| `--sidebar-accent-foreground` | `0.205 0 0` | `text-sidebar-accent-foreground` | Text on hovered/active row |
| `--sidebar-border` | `0.91 0 0` | `border-sidebar-border` | Sidebar borders/dividers |
| `--sidebar-ring` | `0.6386 0.1404 150.68` (green) | `ring-sidebar-ring` | Sidebar focus ring |

### Radii

`--radius: 0.625rem` (10px). Derived scale (Tailwind):

| Class | Value |
|-------|-------|
| `rounded-sm` | `calc(radius - 4px)` ≈ 6px |
| `rounded-md` | `calc(radius - 2px)` ≈ 8px |
| `rounded-lg` | `radius` = 10px |
| `rounded-xl` | `calc(radius + 4px)` ≈ 14px |
| `rounded-2xl` | `calc(radius + 8px)` ≈ 18px — **composer container & message bubbles** |
| `rounded-3xl` | `calc(radius + 12px)` ≈ 22px |
| `rounded-full` | pill — send button, avatar |

### Shadows

Use Tailwind defaults. Conventions:
- Composer container: `shadow-sm` (subtle lift) + `border border-input`.
- Popovers / dropdowns (header model switcher, profile menu): `shadow-md`.
- Avoid heavy shadows; this is a flat, light UI.

### Font stack

No custom font is configured — inherit Tailwind / browser default sans-serif stack
(`ui-sans-serif, system-ui, ...`). Do NOT add a webfont. Headings use the global rules in
`index.css` (`h1`–`h6` are pre-styled with `font-semibold`/`font-medium` + tracking).
The forklet wordmark may use `font-bold`.

---

## 2. Layout shell (owned by `frontend/src/main.tsx` — A.3)

The shell establishes the two-pane geometry. **Do not duplicate any of this in pages or
surface components.**

```
<div class="flex h-svh w-full overflow-hidden">        // shell root: two-pane row
  <ConvoList />                                          // sidebar pane (B1)
  <main class="flex-1 flex flex-col h-svh min-w-0">      // main pane
    <div class="flex-1 overflow-y-auto">                 // SCROLL CONTAINER (shell-owned)
      <div class="mx-auto w-full max-w-3xl px-4 h-full"> // CENTERED COLUMN (shell-owned)
        <Routes> ...pages render content-only here... </Routes>
      </div>
    </div>
  </main>
</div>
```

### Binding ownership rules (critical for B agents)

- **Centered-column max-width + horizontal padding owner (non-chat pages):** the shell's
  `centeredColumn(...)` helper in `main.tsx` wraps the landing (`/`) and signup pages in
  `<div class="mx-auto w-full max-w-3xl px-4">`. Column width is **`max-w-3xl`**
  (48rem / 768px), horizontal padding **`px-4`**.
- **Scroll-container owner (non-chat pages):** the `centeredColumn(...)` helper's
  `<div class="flex-1 overflow-y-auto">`.
- **Landing/signup render content-only.** They MUST NOT add their own `mx-auto`,
  `max-w-*`, or outer page scroll wrappers — centering and scrolling for these pages live
  in `centeredColumn(...)` only. (B5 must not re-add `lg:mx-50`/`mx-auto` to `App.tsx`.)
- **Chat route is the exception — it owns the full main pane.** `chat.tsx` is NOT wrapped
  by `centeredColumn(...)`; it renders header / message-scroll / composer as full-pane
  flex children so that (a) the message scroll spans the full pane and its scrollbar sits
  at the pane's right edge instead of overlapping the right-aligned user bubble, and
  (b) a desktop right gutter (`GUTTER = "lg:pr-[18rem] xl:pr-[26rem]"`, applied to each
  section — ramped so small laptops keep a readable column, full clearance at xl+) reserves
  room for the floating Branch panel (`miniWindow`, `w-96` + `right-6`), which left-biases
  the reading column Notion-style. Each section centers its own
  `<div class="mx-auto w-full max-w-3xl px-4">` inside that gutter so header, messages, and
  composer stay aligned. Keep these three in sync if you touch the chat layout.
- **Sidebar width:** `16rem` (256px), defined by shadcn `SIDEBAR_WIDTH` in
  `components/ui/sidebar.tsx`. Collapsed (icon) width `3rem`. Do not change these
  constants; style within the sidebar's existing structure.

### Composer placement rule (per-page, NOT shell-owned)

The shell does **not** pin a composer. Composer *placement* is decided per page:
- **In-chat composer (B3 in `chat.tsx`/B2):** pinned at the **bottom of the chat column**.
  Pattern: the page content is a vertical flex `flex flex-col h-full`, the message list is
  `flex-1 overflow-y-auto` (inner scroll for messages), and the composer sits as the last
  flex child so it stays at the bottom of the centered column.
- **Empty-state composer (B5 in `App.tsx`):** **centered on the page** beneath the
  greeting (vertically + horizontally centered within the centered column).

---

## 3. Header (B4 — new `components/chatHeader.tsx`)

- Slim top bar inside the chat column (above the message list).
- **Header height: `h-14` (3.5rem / 56px).** Use `flex items-center` for vertical
  centering of its contents.
- Bottom divider: `border-b border-border`.
- Background: `bg-background` (matches main column).
- Contains the provider+model dropdown (left). Dropdown popover: `shadow-md`,
  `border border-border`, `rounded-lg`, `bg-popover text-popover-foreground`.

---

## 4. Messages & bubbles (B2)

- **User message:** green bubble, right-aligned. `bg-card text-card-foreground`,
  `rounded-2xl`, `px-4 py-2.5`, `text-base`, `max-w-[80%]`, aligned with `self-end` /
  `ml-auto`.
- **Assistant message:** plain markdown, left-aligned, no bubble. `text-foreground`,
  full comfortable line length (the `max-w-3xl` column already constrains it). Render via
  the existing `@tailwindcss/typography` `prose` classes (`prose prose-neutral
  max-w-none`); `max-w-none` because the column already sets the width. **Body text is
  base `prose` (16px) — matches the user bubble's `text-base`; do NOT use `prose-sm` (14px),
  which made the assistant read smaller than the user's message.**
- **Vertical rhythm between messages:** `gap-6` (or `space-y-6`) on the message list.
- **Assistant hover action (copy):** lucide `Copy`, `size-4`, `text-muted-foreground`,
  appears on `group-hover`; hover fill `hover:bg-accent rounded-md p-1`.

---

## 5. Composer (B3 — `input` / `homeInput`, shared presentational component)

- **Container:** `rounded-2xl border border-input bg-background shadow-sm`, internal
  padding `p-2` to `p-3`. On focus-within, show the green ring:
  `focus-within:ring-2 focus-within:ring-ring focus-within:border-ring`.
- **Textarea:** transparent (`bg-transparent`), no own border, `resize-none`,
  `outline-none`, `text-foreground placeholder:text-muted-foreground`. Auto-grow with a
  capped max-height (e.g. `max-h-48`) then internal scroll.
- **Send button:** inset on the right, `rounded-full`, lucide `Send` icon `size-4`.
  Enabled = `bg-primary text-primary-foreground hover:opacity-90`; disabled (empty input)
  = `bg-muted text-muted-foreground cursor-not-allowed` / `disabled:opacity-50`.
- **Behavior:** Enter = send, Shift+Enter = newline.
- **Placeholders:** in-chat = **"ask follow up"** (locked); empty-state = **"ask away"**.
- **Shared contract:** presentational `<Composer placeholder value onChange onSubmit
  disabled />` with an injected `onSubmit`. The mini composer (`miniInput.tsx`) and mini
  bubbles (`miniMessage.tsx`) MUST consume these same composer + bubble conventions.

---

## 6. Sidebar internals (B1)

- Surface: `bg-sidebar text-sidebar-foreground` (already applied by shadcn `Sidebar`).
- **forklet wordmark** in the header: green accent acceptable (`text-primary` or
  `text-sidebar-primary`), `font-bold`.
- **"New chat" button:** prominent, full-width, `bg-primary text-primary-foreground`
  `rounded-lg`, lucide `Plus` or `SquarePen` icon `size-4`.
- **Conversation rows:** `rounded-md px-2 py-1.5 text-sm truncate`.
  - Hover: `hover:bg-sidebar-accent hover:text-sidebar-accent-foreground`.
  - Active (current route): `bg-sidebar-accent font-medium text-sidebar-accent-foreground`.
  - (shadcn `SidebarMenuButton` already encodes these via `data-[active=true]` —
    prefer reusing it.)
- **Empty state:** "No conversations yet." in `text-muted-foreground text-sm`.
- **Bottom account area:** avatar (`rounded-full`) + name/email; menu with **Settings**
  (opens BYOK dialog) and **Log out** (`text-destructive`).

---

## 7. Icon conventions (`lucide-react`)

- **Default size:** `size-4` (16px) for inline/button icons; `size-5` (20px) for
  standalone/header affordances.
- **Stroke width:** lucide default `2`. Do not override unless matching a specific weight;
  if a lighter look is needed use `strokeWidth={1.75}` consistently.
- **Color:** inherit via `currentColor` — set color with text utilities
  (`text-muted-foreground`, `text-primary`, etc.), not the `color`/`stroke` props.
- Approved icons referenced by the plan: `Send` (composer), `Copy` (assistant copy),
  `Plus`/`SquarePen` (new chat), `Settings`, `LogOut`, `ChevronDown` (dropdowns).
- **No OpenAI/ChatGPT icon sets or recreations** — lucide only.

---

## 8. Hover / active / focus state classes (reuse verbatim)

| State | Classes |
|-------|---------|
| Neutral row hover (main column) | `hover:bg-accent hover:text-accent-foreground` |
| Sidebar row hover | `hover:bg-sidebar-accent hover:text-sidebar-accent-foreground` |
| Active sidebar row | `bg-sidebar-accent font-medium text-sidebar-accent-foreground` |
| Primary button | `bg-primary text-primary-foreground hover:opacity-90` |
| Focus ring (green) | `focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none` |
| Composer focus | `focus-within:ring-2 focus-within:ring-ring focus-within:border-ring` |
| Icon button hover | `hover:bg-accent rounded-md` |
| Disabled | `disabled:opacity-50 disabled:cursor-not-allowed` / `disabled:pointer-events-none` |

---

## 9. Spacing scale

Use Tailwind's default 4px scale. Conventions:
- Page/column horizontal padding: `px-4` (shell-owned; do not re-add).
- Composer internal padding: `p-2`–`p-3`.
- Message list vertical gap: `gap-6`.
- Sidebar row padding: `px-2 py-1.5`.
- Header padding: `px-4` inside `h-14`.

---

## 10. Build hygiene rule (binding — applies to ALL frontend code)

- **`frontend/../types/types.ts` stays `import type`-only.** It re-exports SDK
  *types* (`import type Anthropic from '@anthropic-ai/sdk'`, `import type WebSocket from
  'ws'`). **No SDK value-imports anywhere in the frontend.** Never `import Anthropic from
  '@anthropic-ai/sdk'` (value) in any frontend file; only `import type { ... } from
  '../../../types/types'`. Composer/header/message components must not pull SDK value
  imports.
- The build gate is **`bunx vite build`** (run from `frontend/`), NOT `tsc -b`. It must
  pass cleanly with no SDK value-imports.

---

## 11. Branding

- Product name everywhere: **forklet** (lowercase). Tagline (empty state):
  **"grow your curiosity."** (keep). Page `<title>`: **forklet**.
- No "EasyBranch"/"easy branch"/"ChatGPT"/"OpenAI" strings in UI copy.
- Favicon stays the default `vite.svg` for now.
