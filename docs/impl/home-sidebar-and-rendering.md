# Plan — Home sidebar + collapse toggle + math/code rendering

Three independent fixes to bring the chat surface closer to the ChatGPT UI. Each
can ship on its own; (1) and (2) are tiny, (3) is the substantive one because it
touches the branch-highlight feature.

## Implementation status (branch `feat/home-sidebar-and-rendering-integration`)
- ✅ **#1 Persistent sidebar on home** — PR #40 (merged to integration).
- ✅ **#2 Collapse toggle (offcanvas, route-owned trigger)** — PR #40.
- ✅ **#3 Math/code rendering + canonical-offset anchors** — landed in reviewed phases:
  - B1 `buildAnchorModel` canonical-coordinate contract + golden tests — PR #41.
  - B3 renderer (KaTeX + Shiki) + declarative capture; imperative `<mark>`
    sweep removed — PR #43 (incl. backslash-math render fix).
  - B4 DOM/Range selection-restore + sequence fixtures — PR #44.
- **Scope cut (post-build):** the product is pre-launch with no real highlights to
  preserve, so all anchor-**versioning** was dropped — no `anchor_version` column,
  no migration, no v1/unknown fallback chip. Every highlight is the single
  canonical coordinate system, stored in the existing `start_offset`/`end_offset`
  columns. This reverts B2 entirely and the fallback parts of B3/B4. **No DB
  change is required.**
- ⏳ Remaining: rip out the versioning/migration/fallback; deploy branch →
  browser-validate the live render/round-trip → clear-codex `/readability` review.

---

## 1. Persistent sidebar on home ("sidebar isn't available until you send a chat")

**Symptom:** On desktop, the conversation sidebar is hidden on the landing page
(`/`) and only appears after the first message navigates to `/chat/:id`.

**Root cause:** `frontend/src/main.tsx:32`
```ts
const showSidebar = !!session && (isMobile || !isHome);
```
`!isHome` is `false` on `/`, so the sidebar is suppressed there on desktop.

**Change — `frontend/src/main.tsx`:**
- Replace the condition with `const showSidebar = !!session;` — sidebar shows on
  every authenticated screen (matches ChatGPT, which keeps its sidebar on the
  new-chat screen).
- Update the block comment (lines 20–26): it currently states the sidebar is
  "hidden on the landing/main page" — no longer true.
- Keep `showMobileHomeBar` unchanged: on mobile the sidebar is an off-canvas
  drawer and home has no `ChatHeader`, so the slim hamburger bar is still needed.
- `isHome` stays (still used by `showMobileHomeBar`); `isMobile` stays imported.

**Layout — `frontend/src/App.tsx`:** no structural change. Home content lives in
the shared centered `max-w-3xl` main column, so it stays centered within the
narrower main pane once the sidebar takes its width. Keep the branded landing
(logo / "easybranch" / tagline / centered input) exactly as-is.

**Safety:** `ConvoList` (`convoList.tsx`) is self-contained — it fetches
conversations from the session on mount with no dependency on being inside a
chat, so rendering it on home is safe. The login screen (`!session`) is
unaffected since `showSidebar` still requires a session.

---

## 2. Expand / collapse the sidebar at will (ChatGPT-style toggle)

**Current state:** The shadcn `Sidebar` is `collapsible="icon"` (`convoList.tsx:35`)
and a `Cmd/Ctrl+B` keyboard shortcut already toggles it (wired in
`ui/sidebar.tsx`). But **no visible toggle button is rendered anywhere** —
`ChatHeader` has only the model dropdown + mobile menu button, and `ConvoList`
renders no `SidebarTrigger` or `SidebarRail`. So on desktop there is currently no
clickable way to collapse/expand.

`SidebarTrigger` (a ghost icon button calling `toggleSidebar()`) already exists in
`ui/sidebar.tsx` — we just need to mount it.

**Trigger ownership (locked): one route-owned desktop trigger, with no shared
normal-flow header.**
- Chat pages: `ChatHeader` owns the desktop `SidebarTrigger`. Render it as the
  leftmost item in **both** return branches (the "Add a key" branch and the model
  dropdown branch), hidden below `md`; retain the existing mobile hamburger.
- Home: `AppShell` renders a desktop-only `SidebarTrigger` only when `isHome`,
  absolutely positioned at the main pane's top-left. Make `<main>` the positioning
  context and give the trigger an explicit `z-index`; it consumes no layout
  height or width, so the branded landing column remains centered exactly as in
  §1. The home mobile bar continues to own the mobile hamburger.
- No chat route receives the shell-owned home trigger, and no home route renders
  `ChatHeader`, so there is exactly one visible trigger per viewport/page.
- The single button toggles both directions (open ↔ collapsed), so no need for a
  separate expand affordance.
- Change `ConvoList` to `collapsible="offcanvas"` (locked). The current
  conversation rows are text-only and do not define usable icon-rail navigation;
  collapse therefore slides the sidebar fully away, matching the requested
  ChatGPT-style behavior.

---

## 3. Render code, math symbols, etc. (currently raw LaTeX prints literally)

**Symptom:** Assistant output like `\[ \text{Beta}(r,b) \]` renders as the literal
string `[ \text{Beta}(r,b) ]`; code blocks render unstyled. Bold/lists work, so
markdown itself is fine — math + code highlighting are simply not wired.

**Root cause:** Messages render through bare `react-markdown`
(`message.tsx:224`, `miniMessage.tsx:12`) with **no** math or syntax-highlight
plugins. `package.json` has only `react-markdown` — no `remark-math`,
`rehype-katex`, `katex`, `remark-gfm`, or any highlighter.

**Library decision (locked):** Stay on **`react-markdown` + plugins** — we render
to a React element tree we control, so branch highlights can be emitted
declaratively inside that same tree from canonical semantic offsets.
Considered and **deferred: Streamdown** (Vercel's drop-in, purpose-built for AI
streaming with incomplete-block styling) — it owns its own memoized component
tree + bundles Shiki, which makes the custom `<mark>` anchoring fragile. Revisit
only if we want streaming-block polish and are willing to rework highlight
anchoring around it.

**Highlighter (locked): Shiki**, not `rehype-highlight` — it's the de-facto
standard now and matches the ChatGPT look (VS Code grammars/themes). Shiki's
default rehype plugin is asynchronous, while the Markdown render and declarative
highlight projection must complete in one synchronous React render, so do **not**
mount that async plugin directly.

**Execution model (locked): preinitialize once, render synchronously.** During
frontend bootstrap, create and cache the Shiki highlighter before mounting the
React root. Pass that initialized instance to the shared Markdown component and
use `rehypeShikiFromHighlighter` from `@shikijs/rehype/core` (the synchronous
transformer path). For each raw-content revision, `MarkdownContent` synchronously
builds one immutable anchor model, projects the current persisted ranges onto
that model, and emits prose/code `<mark>` elements plus atomic-math highlight
state while constructing the HAST/React tree. React alone owns those children:
there is no layout-effect cleanup, text-node splitting, `replaceChild`, or other
post-commit mutation. Streaming revision N+1 builds a new model and React tree
from the latest content + highlight props; no late Shiki promise or stale effect
may modify revision N. Carry a monotonic `renderRevision` with the model for
tests/event-handler gating, and key the semantic subtree by it if a renderer
adapter needs a clean remount.

**Changes:**
- Add deps: `remark-math`, `rehype-katex`, `katex`, `remark-gfm`,
  `@shikijs/rehype` (+ `shiki`).
- Wire plugins once inside the shared `MarkdownContent` used by both
  `message.tsx` and `miniMessage.tsx`:
  ```tsx
  <Markdown
    remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[rehypeKatex, [rehypeShikiFromHighlighter, highlighter, {
      theme: "github-light",
    }]]}
  >{content}</Markdown>
  ```
- Import KaTeX CSS once (`katex/dist/katex.min.css`) and a highlight theme CSS in
  `frontend/src/index.css` or `main.tsx`.
- **Delimiter gotcha:** `remark-math` recognizes `$…$` / `$$…$$`, but LLMs (and
  the screenshot) emit `\[ … \]` and `\( … \)`. Handle those forms only through
  the syntax-aware `buildAnchorModel(rawMarkdown)` contract below. Do not run
  regex/string replacement over raw Markdown: code spans/fences and escaped
  delimiters must be identified and protected before math delimiter
  normalization.
- Factor the markdown setup into one shared component (e.g.
  `components/MarkdownContent.tsx`) so `message.tsx` and `miniMessage.tsx` don't
  drift. `message.tsx` keeps its `contentRef` only for read-only DOM-selection
  mapping. Pass persisted highlights and the branch-activation callback into
  `MarkdownContent`; mini messages pass no highlights.

### ⚠️ Critical interaction — branch highlights vs KaTeX (must handle)

This is on the current `feat/branch-anchored-comments-integration` branch, so it
matters. `message.tsx` runs a post-render DOM sweep that wraps highlight ranges in
`<mark>` using **flat text offsets**, and `lib/textOffsets.ts:25` walks **every**
text node:
```ts
const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
// concatenates node.nodeValue of every Text node — no filter
```
KaTeX renders math twice in the DOM: a visible `.katex-html` subtree **and** a
hidden `.katex-mathml` MathML subtree containing the raw TeX source as text. With
no filter, the walker counts **both**, so:
- Flat offsets drift for any message containing math → existing highlights land on
  the wrong characters.
- A `<mark>` could be injected **inside** KaTeX's generated spans → corrupts the
  rendered formula.

**No anchor versioning (locked — pre-launch, no legacy highlights):**
- There are no real persisted highlights to preserve, so we do **not** version
  anchors. No `anchor_version` column, no migration, no v1/unknown fallback chip.
- Every highlight uses the single canonical coordinate system defined below and
  is stored in the existing `start_offset`/`end_offset` columns. The renderer
  always projects stored offsets through `buildAnchorModel` and marks inline.
- The only defensive case kept: an anchor whose range does not fit the current
  model (e.g. content changed) is simply not marked — it is dropped, not
  relocated. No fallback affordance, no version comparison.
- (Any stale dev rows captured under the old all-text-node renderer may
  mis-anchor; acceptable — wipe them if they appear. If a coordinate system
  change is ever needed post-launch, reintroduce a version field then.)

**Canonical coordinates and capture/rendering semantics (locked):**
1. Define one pure, immutable `buildAnchorModel(rawMarkdown)` implementation and
   use its output unchanged for capture, persistence validation, and rendering.
   Its pipeline is fixed:
   - Tokenize/parse raw CommonMark + GFM with a syntax-aware math delimiter
     extension. Markdown code spans, fenced/indented code blocks, and
     Markdown-escaped delimiter text are recognized first and excluded from
     delimiter handling. Only unescaped `\(...\)` / `\[...\]` in ordinary text
     become math nodes; `$...$` / `$$...$$` retain `remark-math` semantics. Never
     normalize delimiters with a raw-string regex or mutate `rawMarkdown`;
     unmatched/incomplete delimiters remain ordinary text for that streaming
     revision.
   - Walk the resulting semantic tree depth-first in document order and emit
     immutable leaves `{ kind, value, start, end }`. Prose text contributes the
     parser-decoded text value; inline/fenced code contributes its parser code
     value exactly, including preserved whitespace/newlines; structural nodes
     contribute nothing; every inline/display math node contributes the single
     UTF-16 unit `U+FFFC` and retains its TeX only as renderer metadata.
   - `canonicalText` is the direct concatenation of leaf values with no inserted
     separators. Each `[start,end)` is a UTF-16 index into that string.
     Renderer-added text (MathML duplication, copy labels, line numbers, etc.)
     contributes nothing.
   This algorithm and output are the immutable coordinate contract. Any future
   parser, delimiter, decoding, whitespace, traversal, or math-unit change that
   can alter coordinates would need a re-anchoring strategy (and, if real
   highlights exist by then, a version field) — it must never silently
   reinterpret persisted offsets in place.
2. The shared renderer annotates rendered semantic leaves with their canonical
   spans. It intersects persisted ranges with those spans while creating the React
   tree, splitting renderer-owned prose/code leaves into declarative marked and
   unmarked segments. Shiki token spans map back to the enclosing code-text
   spans. A KaTeX wrapper maps to its one math unit and receives atomic
   highlight props; neither `.katex-mathml` nor `.katex-html` descendants are
   walked independently.
3. Math is selectable only as an atom for branch anchoring. If either DOM
   selection endpoint lands inside rendered math, normalize the start endpoint
   to before that math atom and the end endpoint to after it. A wholly-math
   selection therefore captures the whole formula; a prose↔math selection
   includes the whole formula. Reject only ranges that are empty after this
   normalization.
4. Fenced and inline code remain ordinary selectable text, not atomic. Capture
   exact code-text coordinates across Shiki token boundaries, preserving code
   whitespace/newlines represented in the canonical stream.
5. Declarative projection performs one segment sweep over canonical spans before
   commit. It emits renderer-owned `<mark>` segments for prose/code and
   whole-element atomic segments for math; it never splits KaTeX descendants.
   Atomic math marks use the same coverage-depth styling and
   most-specific-branch click/keyboard target as text marks, applied to the
   formula's outer semantic wrapper so the visible formula is fully highlighted
   and accessible.
6. Projection accepts only anchors whose ranges fit the current model (others are
   silently dropped, not relocated or shown as a fallback).
   Selection capture is the only DOM-side operation: it reads rendered leaf-span
   metadata to map a `Range` back into the same model, including atomic math
   endpoint normalization, but never changes renderer-owned nodes. Each
   streaming update renders from the matching `(renderRevision, anchorModel,
   persistedRanges)` snapshot, so stale revisions can neither apply marks nor
   service branch activation.

---

## Verification
- `cd frontend && bun run build` (typecheck + lint gate; keep `types` as
  `import type`).
- Local run, signed in: home shows the sidebar; toggle collapses/expands on home
  and both `ChatHeader` branches without duplicate controls; the home trigger
  does not move the centered landing content; mobile drawer still opens via
  hamburger; logged-out screen unchanged.
- Render a message with inline `$…$`, display `\[…\]`, and a ```code fence```:
  math typesets and code is highlighted.
- Sequence tests cover first mount, each streaming content revision, and reload
  with persisted code highlights: each commit is produced declaratively from
  the matching model + ranges, with no post-commit mutation or stale-revision
  DOM.
- Golden `buildAnchorModel` fixtures lock canonical output for prose, escaped
  Markdown, inline/fenced code containing math-like delimiters, `$`/`$$` math,
  `\(`/`\[` math, incomplete streaming delimiters, and mixed spans. Assert exact
  leaf kinds/values, UTF-16 `[start,end)` coordinates, and `canonicalText`.
- Selection/restore fixtures cover prose before/after math and code,
  wholly-inside math, wholly-inside code, prose↔math, prose↔code, and math↔code
  ranges. Assert normalized persisted coordinates, visible marked segments,
  whole-formula atomic styling, exact code whitespace, and click routing.
- An anchor whose range no longer fits the current model is silently dropped
  (not marked, not relocated, no fallback affordance).

## Sequencing
1 and 2 are independent and tiny — land first. 3 is larger and carries the
highlight-offset risk — do it on its own with the §3 mitigations and the
round-trip verification before merge.
```
