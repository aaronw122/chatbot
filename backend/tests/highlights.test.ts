import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

// --- Test environment setup (must happen before importing index) ---

// Valid 32-byte encryption key.
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
// Force InMemoryStorage (USE_SUPABASE !== 'true') and skip app.listen().
process.env.NODE_ENV = "test";
delete process.env.USE_SUPABASE;

// Mutable session the mocked auth returns.
let currentSession: { user: { id: string } } | null = null;

mock.module("../utils/auth", () => ({
  auth: {
    api: {
      getSession: async () => currentSession,
    },
  },
}));

// Mock the LLM provider so generation paths make no real network calls AND so we
// can capture the exact message array each path passes to the provider — this is
// how the branch-context-assembly assertions inspect the prepended preamble.
let deltas: string[] = ["Hello", ", ", "world"];
let lastGenerateMessages: Array<{ role: string; content: string }> = [];
let lastStreamMessages: Array<{ role: string; content: string }> = [];

mock.module("../llm/provider", () => ({
  MODELS: {
    anthropic: ["claude-sonnet-4-5-20250929"],
    openai: ["gpt-4o", "gpt-4o-mini"],
  },
  assertModelAllowed: (provider: string, model: string) => {
    const allow: Record<string, string[]> = {
      anthropic: ["claude-sonnet-4-5-20250929"],
      openai: ["gpt-4o", "gpt-4o-mini"],
    };
    if (!allow[provider]?.includes(model)) {
      throw new Error("not allowed");
    }
  },
  generateReply: async (args: { messages: Array<{ role: string; content: string }> }) => {
    lastGenerateMessages = args.messages;
    return deltas.join("");
  },
  streamReply: async function* (
    args: { messages: Array<{ role: string; content: string }> },
    _signal?: AbortSignal
  ) {
    lastStreamMessages = args.messages;
    for (const d of deltas) {
      yield d;
    }
  },
}));

let server: Server;
let baseUrl: string;
let storage: import("../db/storage").Storage;

beforeAll(async () => {
  const mod = await import("../index");
  storage = mod.storage;

  server = createServer(mod.app as any);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("server failed to bind");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  server?.close();
});

const USER = "user-highlights";

function authed() {
  currentSession = { user: { id: USER } };
}
function unauth() {
  currentSession = null;
}

beforeEach(async () => {
  await (storage as any).resetConversations?.();
  authed();
  deltas = ["Hello", ", ", "world"];
  lastGenerateMessages = [];
  lastStreamMessages = [];
});

async function configureKey(provider = "openai", model = "gpt-4o", apiKey = "sk-hl-key") {
  const r = await fetch(baseUrl + "/api/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, model, apiKey }),
  });
  if (r.status !== 200) throw new Error("failed to configure key: " + r.status);
}

// Create a normal convo (no highlight) → returns the message array. Pull convoId.
async function createConvo(content = "first user message"): Promise<string> {
  const r = await fetch(baseUrl + "/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const body = (await r.json()) as Array<{ convoId: string }>;
  return body[0]!.convoId;
}

// Read an NDJSON stream into parsed frames.
async function readNdjson(res: Response): Promise<any[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const frames: any[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) frames.push(JSON.parse(line));
    }
  }
  const tail = buf.trim();
  if (tail) frames.push(JSON.parse(tail));
  return frames;
}

// ---------------------------------------------------------------------------
// A.4 — Storage round-trip
// ---------------------------------------------------------------------------
describe("storage: highlights round-trip", () => {
  it("createHighlight persists; getHighlightsByConvo + getHighlightByBranch return it", async () => {
    // Source convo with an assistant message to anchor to.
    const sourceConvo = await storage.createConversation({ content: "source convo", userId: USER });
    const sourceMsg = await storage.addMessage({
      convoId: sourceConvo.id,
      role: "assistant",
      content: "the full assistant response with a highlighted region inside it",
    });
    // The branch the highlight opens.
    const branchConvo = await storage.createConversation({ content: "branch q", userId: USER, save: false });

    const created = await storage.createHighlight({
      messageId: sourceMsg.id,
      branchConvoId: branchConvo.id,
      startOffset: 9,
      endOffset: 27,
      quote: "assistant response",
      userId: USER,
    });

    expect(created.id).toBeTruthy();
    expect(created.messageId).toBe(sourceMsg.id);
    expect(created.branchConvoId).toBe(branchConvo.id);
    expect(created.startOffset).toBe(9);
    expect(created.endOffset).toBe(27);
    expect(created.quote).toBe("assistant response");
    expect(created.userId).toBe(USER);

    // getHighlightsByConvo joins on the source message's convo.
    const byConvo = await storage.getHighlightsByConvo(sourceConvo.id);
    expect(byConvo).toHaveLength(1);
    expect(byConvo[0]!.id).toBe(created.id);
    expect(byConvo[0]!.startOffset).toBe(9);
    expect(byConvo[0]!.endOffset).toBe(27);
    expect(byConvo[0]!.quote).toBe("assistant response");

    // getHighlightByBranch resolves the branch back to its single highlight.
    const byBranch = await storage.getHighlightByBranch(branchConvo.id);
    expect(byBranch).not.toBeNull();
    expect(byBranch!.id).toBe(created.id);

    // A convo with no highlighted messages returns [].
    expect(await storage.getHighlightsByConvo(branchConvo.id)).toEqual([]);
    // A non-branch convo returns null for getHighlightByBranch.
    expect(await storage.getHighlightByBranch(sourceConvo.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B2 — anchor_version (coordinate-space tag) persistence
// ---------------------------------------------------------------------------
describe("anchor_version persistence", () => {
  // Seed a source assistant message + branch convo, returning ids to anchor to.
  async function seedSource() {
    const sourceConvo = await storage.createConversation({ content: "src", userId: USER });
    const sourceMsg = await storage.addMessage({
      convoId: sourceConvo.id,
      role: "assistant",
      content: "the full assistant response with a highlighted region inside it",
    });
    const branchConvo = await storage.createConversation({ content: "branch q", userId: USER, save: false });
    return { sourceConvo, sourceMsg, branchConvo };
  }

  it("storage: createHighlight without anchorVersion defaults to 1; reads return it", async () => {
    const { sourceConvo, sourceMsg, branchConvo } = await seedSource();
    const created = await storage.createHighlight({
      messageId: sourceMsg.id,
      branchConvoId: branchConvo.id,
      startOffset: 9,
      endOffset: 27,
      quote: "assistant response",
      userId: USER,
    });
    // Pre-existing-row semantics: absent version → v1.
    expect(created.anchorVersion).toBe(1);
    const byConvo = await storage.getHighlightsByConvo(sourceConvo.id);
    expect(byConvo[0]!.anchorVersion).toBe(1);
    const byBranch = await storage.getHighlightByBranch(branchConvo.id);
    expect(byBranch!.anchorVersion).toBe(1);
  });

  it("storage: createHighlight preserves an explicit version (2) verbatim", async () => {
    const { sourceConvo, sourceMsg, branchConvo } = await seedSource();
    const created = await storage.createHighlight({
      messageId: sourceMsg.id,
      branchConvoId: branchConvo.id,
      startOffset: 9,
      endOffset: 27,
      quote: "assistant response",
      userId: USER,
      anchorVersion: 2,
    });
    expect(created.anchorVersion).toBe(2);
    const byConvo = await storage.getHighlightsByConvo(sourceConvo.id);
    expect(byConvo[0]!.anchorVersion).toBe(2);
  });

  it("storage: an unknown/future version (99) is preserved, not clamped", async () => {
    const { sourceMsg, branchConvo } = await seedSource();
    const created = await storage.createHighlight({
      messageId: sourceMsg.id,
      branchConvoId: branchConvo.id,
      startOffset: 0,
      endOffset: 5,
      quote: "the f",
      userId: USER,
      anchorVersion: 99,
    });
    expect(created.anchorVersion).toBe(99);
    expect((await storage.getHighlightByBranch(branchConvo.id))!.anchorVersion).toBe(99);
  });

  it("route: a branch created WITHOUT anchorVersion persists version 1 (default 1, not 2)", async () => {
    await configureKey();
    const sourceConvo = await storage.createConversation({ content: "src", userId: USER });
    const sourceMsg = await storage.addMessage({
      convoId: sourceConvo.id,
      role: "assistant",
      content: "0123456789 highlighted span here",
    });
    const res = await fetch(baseUrl + "/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "why this part?",
        highlight: { messageId: sourceMsg.id, startOffset: 11, endOffset: 26, quote: "highlighted span" },
      }),
    });
    expect(res.status).toBe(200);
    const { convoId } = (await res.json()) as { convoId: string };
    const hl = await storage.getHighlightByBranch(convoId);
    expect(hl!.anchorVersion).toBe(1);
  });

  it("route: an explicit anchorVersion: 2 is persisted", async () => {
    await configureKey();
    const sourceConvo = await storage.createConversation({ content: "src", userId: USER });
    const sourceMsg = await storage.addMessage({
      convoId: sourceConvo.id,
      role: "assistant",
      content: "0123456789 highlighted span here",
    });
    const res = await fetch(baseUrl + "/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "why this part?",
        highlight: { messageId: sourceMsg.id, startOffset: 11, endOffset: 26, quote: "highlighted span", anchorVersion: 2 },
      }),
    });
    expect(res.status).toBe(200);
    const { convoId } = (await res.json()) as { convoId: string };
    expect((await storage.getHighlightByBranch(convoId))!.anchorVersion).toBe(2);
  });

  it("route: an unknown future version (99) is preserved verbatim", async () => {
    await configureKey();
    const sourceConvo = await storage.createConversation({ content: "src", userId: USER });
    const sourceMsg = await storage.addMessage({
      convoId: sourceConvo.id,
      role: "assistant",
      content: "0123456789 highlighted span here",
    });
    const res = await fetch(baseUrl + "/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "why this part?",
        highlight: { messageId: sourceMsg.id, startOffset: 11, endOffset: 26, quote: "highlighted span", anchorVersion: 99 },
      }),
    });
    expect(res.status).toBe(200);
    const { convoId } = (await res.json()) as { convoId: string };
    expect((await storage.getHighlightByBranch(convoId))!.anchorVersion).toBe(99);
  });

  it("route: rejects invalid anchorVersion (0, -1, 1.5, non-numeric) with 400 and persists nothing", async () => {
    await configureKey();
    const sourceConvo = await storage.createConversation({ content: "src", userId: USER });
    const sourceMsg = await storage.addMessage({
      convoId: sourceConvo.id,
      role: "assistant",
      content: "0123456789 highlighted span here",
    });

    for (const bad of [0, -1, 1.5, "x"]) {
      const res = await fetch(baseUrl + "/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "why this part?",
          highlight: { messageId: sourceMsg.id, startOffset: 11, endOffset: 26, quote: "highlighted span", anchorVersion: bad },
        }),
      });
      expect(res.status).toBe(400);
    }
    // No highlight (and thus no branch) leaked from any rejected attempt —
    // the source message has no highlights anchored to it.
    expect(await storage.getHighlightsByConvo(sourceConvo.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A.4 — POST /conversations shape (branch vs normal)
// ---------------------------------------------------------------------------
describe("POST /conversations with highlight", () => {
  it("highlight present → save:false convo + linked highlight + returns { convoId, highlightId }", async () => {
    await configureKey();
    // Seed a source assistant message to anchor to.
    const sourceConvo = await storage.createConversation({ content: "src", userId: USER });
    const sourceMsg = await storage.addMessage({
      convoId: sourceConvo.id,
      role: "assistant",
      content: "0123456789 highlighted span here",
    });

    const res = await fetch(baseUrl + "/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "why this part?",
        highlight: { messageId: sourceMsg.id, startOffset: 11, endOffset: 26, quote: "highlighted span" },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { convoId: string; highlightId: string };
    expect(body.convoId).toBeTruthy();
    expect(body.highlightId).toBeTruthy();
    // NOT the message-array shape.
    expect(Array.isArray(body)).toBe(false);

    // Branch convo is hidden (save:false).
    const branch = await storage.getConversation({ convoId: body.convoId });
    expect(branch!.save).toBe(false);

    // The typed question was persisted as the first user message (unmangled).
    const branchMsgs = await storage.getMessages({ convoId: body.convoId });
    expect(branchMsgs).toHaveLength(1);
    expect(branchMsgs[0]!.role).toBe("user");
    expect(branchMsgs[0]!.content).toBe("why this part?");

    // The highlight row links the branch back to the source message.
    const hl = await storage.getHighlightByBranch(body.convoId);
    expect(hl).not.toBeNull();
    expect(hl!.id).toBe(body.highlightId);
    expect(hl!.messageId).toBe(sourceMsg.id);
    expect(hl!.quote).toBe("highlighted span");
  });

  // Regression: offsets + quote live in the FRONTEND's rendered text-node space,
  // NOT the raw markdown stored in source.content. A formatted reply renders
  // "bold" from "**bold**", collapses "\n\n", strips "- " list markers, etc., so
  // the quote is frequently NOT a literal substring of source.content and the
  // offsets exceed/disagree with content.length. The backend must NOT validate
  // against raw content — doing so 400'd every branch on a formatted response.
  it("accepts a highlight whose quote is not a literal substring of the raw markdown", async () => {
    await configureKey();
    const sourceConvo = await storage.createConversation({ content: "src", userId: USER });
    const sourceMsg = await storage.addMessage({
      convoId: sourceConvo.id,
      role: "assistant",
      // Raw markdown: rendered text would be "bold text here" — note no "**".
      content: "- **bold** text here\n\n- second point",
    });

    const res = await fetch(baseUrl + "/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "what does this mean?",
        highlight: {
          messageId: sourceMsg.id,
          // rendered-space offsets for "bold text" — do NOT index into the raw
          // markdown above, and "bold text" is not a substring of it.
          startOffset: 0,
          endOffset: 9,
          quote: "bold text",
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { convoId: string; highlightId: string };
    expect(body.convoId).toBeTruthy();
    const hl = await storage.getHighlightByBranch(body.convoId);
    expect(hl!.quote).toBe("bold text");
    expect(hl!.startOffset).toBe(0);
    expect(hl!.endOffset).toBe(9);
  });

  it("highlight absent → save:true convo, message-array shape, no highlight", async () => {
    await configureKey();
    const res = await fetch(baseUrl + "/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "a normal question" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ convoId: string; role: string; content: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0]!.role).toBe("user");
    expect(body[0]!.content).toBe("a normal question");

    const convo = await storage.getConversation({ convoId: body[0]!.convoId });
    expect(convo!.save).toBe(true);
    expect(await storage.getHighlightByBranch(body[0]!.convoId)).toBeNull();
  });

  it("rejects a highlight whose source message belongs to another user", async () => {
    const sourceConvo = await storage.createConversation({
      content: "private source",
      userId: "someone-else",
    });
    const sourceMsg = await storage.addMessage({
      convoId: sourceConvo.id,
      role: "assistant",
      content: "private assistant response",
    });

    const res = await fetch(baseUrl + "/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "steal context",
        highlight: {
          messageId: sourceMsg.id,
          startOffset: 0,
          endOffset: 7,
          quote: "private",
        },
      }),
    });

    expect(res.status).toBe(400);
    expect(await storage.getConversations({ userId: USER })).toEqual([]);
  });

  it("rejects malformed anchors and user-message sources", async () => {
    const sourceConvo = await storage.createConversation({ content: "src", userId: USER });
    const sourceMsg = await storage.addMessage({
      convoId: sourceConvo.id,
      role: "user",
      content: "user-authored source",
    });

    const res = await fetch(baseUrl + "/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "invalid branch",
        highlight: {
          messageId: sourceMsg.id,
          startOffset: -1,
          endOffset: 100,
          quote: "invented quote",
        },
      }),
    });

    expect(res.status).toBe(400);
  });

  it("keeps a branch out of the conversation list until promotion", async () => {
    const sourceConvo = await storage.createConversation({ content: "src", userId: USER });
    const sourceMsg = await storage.addMessage({
      convoId: sourceConvo.id,
      role: "assistant",
      content: "highlight this response",
    });
    const createRes = await fetch(baseUrl + "/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "branch question",
        highlight: {
          messageId: sourceMsg.id,
          startOffset: 0,
          endOffset: 9,
          quote: "highlight",
        },
      }),
    });
    const { convoId } = (await createRes.json()) as { convoId: string };

    const before = await fetch(baseUrl + "/conversations");
    const beforeBody = (await before.json()) as Array<{ id: string }>;
    expect(beforeBody.some((convo) => convo.id === convoId)).toBe(false);

    await fetch(baseUrl + "/conversations/" + convoId, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ save: true }),
    });

    const after = await fetch(baseUrl + "/conversations");
    const afterBody = (await after.json()) as Array<{ id: string }>;
    expect(afterBody.some((convo) => convo.id === convoId)).toBe(true);
  });

  it("401 when unauthenticated", async () => {
    unauth();
    const res = await fetch(baseUrl + "/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "x", highlight: { messageId: "m", startOffset: 0, endOffset: 1, quote: "x" } }),
    });
    expect(res.status).toBe(404); // POST /conversations uses 404 for no session
  });
});

// ---------------------------------------------------------------------------
// A.4 — GET /conversations/:id/highlights
// ---------------------------------------------------------------------------
describe("GET /conversations/:id/highlights", () => {
  it("returns the camelCase highlight rows anchored to the convo", async () => {
    await configureKey();
    const sourceConvo = await storage.createConversation({ content: "src", userId: USER });
    const sourceMsg = await storage.addMessage({
      convoId: sourceConvo.id,
      role: "assistant",
      content: "alpha beta gamma delta",
    });
    const branch = await storage.createConversation({ content: "q", userId: USER, save: false });
    const hl = await storage.createHighlight({
      messageId: sourceMsg.id,
      branchConvoId: branch.id,
      startOffset: 6,
      endOffset: 10,
      quote: "beta",
      userId: USER,
    });

    const res = await fetch(baseUrl + "/conversations/" + sourceConvo.id + "/highlights");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; messageId: string; branchConvoId: string; quote: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]!.id).toBe(hl.id);
    expect(body[0]!.messageId).toBe(sourceMsg.id);
    expect(body[0]!.branchConvoId).toBe(branch.id);
    expect(body[0]!.quote).toBe("beta");
  });

  it("404 when the convo belongs to another user", async () => {
    const otherConvo = await storage.createConversation({ content: "src", userId: "someone-else" });
    const res = await fetch(baseUrl + "/conversations/" + otherConvo.id + "/highlights");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// A.4 — PATCH /conversations/:id (fullscreen promotion)
// ---------------------------------------------------------------------------
describe("PATCH /conversations/:id { save: true }", () => {
  it("promotes a hidden branch to a saved conversation", async () => {
    const branch = await storage.createConversation({ content: "branch", userId: USER, save: false });
    expect(branch.save).toBe(false);

    const res = await fetch(baseUrl + "/conversations/" + branch.id, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ save: true }),
    });
    expect(res.status).toBe(200);

    const updated = await storage.getConversation({ convoId: branch.id });
    expect(updated!.save).toBe(true);
  });

  it("404 for another user's convo", async () => {
    const branch = await storage.createConversation({ content: "branch", userId: "nope", save: false });
    const res = await fetch(baseUrl + "/conversations/" + branch.id, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ save: true }),
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// A.4 — Branch context assembly in the generation path
// ---------------------------------------------------------------------------
describe("branch generation prepends source response + quote", () => {
  it("streaming path: branch convo includes the source response + quote; normal convo does not", async () => {
    await configureKey();

    // Build a source response + a branch anchored to it.
    const sourceConvo = await storage.createConversation({ content: "src", userId: USER });
    const sourceMsg = await storage.addMessage({
      convoId: sourceConvo.id,
      role: "assistant",
      content: "THE FULL SOURCE RESPONSE about photosynthesis and chlorophyll",
    });
    const createRes = await fetch(baseUrl + "/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "what about chlorophyll?",
        highlight: { messageId: sourceMsg.id, startOffset: 0, endOffset: 9, quote: "THE FULL S" },
      }),
    });
    const { convoId: branchId } = (await createRes.json()) as { convoId: string; highlightId: string };

    // Drive a streamed reply on the branch (firstReply marker → no new user msg).
    const streamRes = await fetch(baseUrl + "/messages/" + branchId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstReply: true }),
    });
    await readNdjson(streamRes);

    // First message passed to the provider is the synthetic context preamble.
    expect(lastStreamMessages.length).toBeGreaterThanOrEqual(2);
    const preamble = lastStreamMessages[0]!;
    expect(preamble.role).toBe("user");
    expect(preamble.content).toContain("THE FULL SOURCE RESPONSE about photosynthesis");
    expect(preamble.content).toContain('The user highlighted this part: "THE FULL S"');
    // The branch's own user message follows.
    expect(lastStreamMessages.some((m) => m.content === "what about chlorophyll?")).toBe(true);

    // A NORMAL convo's stream gets no preamble.
    lastStreamMessages = [];
    const normalId = await createConvo("plain question");
    const normalStream = await fetch(baseUrl + "/messages/" + normalId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstReply: true }),
    });
    await readNdjson(normalStream);
    expect(lastStreamMessages).toHaveLength(1);
    expect(lastStreamMessages[0]!.content).toBe("plain question");
    expect(lastStreamMessages.some((m) => m.content.includes("The user highlighted this part"))).toBe(false);
  });

  it("non-streaming path (getAIResponse via withReply create): a normal convo gets NO preamble", async () => {
    // getAIResponse (the non-streaming reply path) is reached via a withReply
    // create. That path always makes a fresh, non-branch convo, so it must never
    // prepend a preamble. This proves the non-streaming path also routes through
    // assembleProviderMessages and leaves normal convos unchanged. (The branch +
    // preamble case is proven on the streaming path above, which shares the same
    // helper.)
    await configureKey();
    const res = await fetch(baseUrl + "/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "inline reply please", withReply: true }),
    });
    expect(res.status).toBe(200);

    expect(lastGenerateMessages).toHaveLength(1);
    expect(lastGenerateMessages[0]!.role).toBe("user");
    expect(lastGenerateMessages[0]!.content).toBe("inline reply please");
    expect(lastGenerateMessages.some((m) => m.content.includes("The user highlighted this part"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A.4 — Cascade semantics (InMemory simulation of the FK cascades)
// ---------------------------------------------------------------------------
describe("cascade semantics", () => {
  it("deleting a message deletes its highlights; the branch convo survives", async () => {
    const sourceConvo = await storage.createConversation({ content: "src", userId: USER });
    const sourceMsg = await storage.addMessage({
      convoId: sourceConvo.id,
      role: "assistant",
      content: "regenerate me and my highlights should vanish",
    });
    const branch = await storage.createConversation({ content: "branch", userId: USER, save: false });
    await storage.createHighlight({
      messageId: sourceMsg.id,
      branchConvoId: branch.id,
      startOffset: 0,
      endOffset: 11,
      quote: "regenerate",
      userId: USER,
    });

    expect(await storage.getHighlightByBranch(branch.id)).not.toBeNull();

    // message_id ON DELETE CASCADE
    await (storage as any).deleteMessage({ id: sourceMsg.id });

    // Highlight gone.
    expect(await storage.getHighlightByBranch(branch.id)).toBeNull();
    expect(await storage.getHighlightsByConvo(sourceConvo.id)).toEqual([]);
    // Branch conversation survives (separate conversations row).
    expect(await storage.getConversation({ convoId: branch.id })).not.toBeNull();
  });

  it("deleting a branch convo deletes its highlight", async () => {
    const sourceConvo = await storage.createConversation({ content: "src", userId: USER });
    const sourceMsg = await storage.addMessage({
      convoId: sourceConvo.id,
      role: "assistant",
      content: "branch deletion cascades the highlight",
    });
    const branch = await storage.createConversation({ content: "branch", userId: USER, save: false });
    await storage.createHighlight({
      messageId: sourceMsg.id,
      branchConvoId: branch.id,
      startOffset: 0,
      endOffset: 6,
      quote: "branch",
      userId: USER,
    });

    expect(await storage.getHighlightsByConvo(sourceConvo.id)).toHaveLength(1);

    // branch_convo_id ON DELETE CASCADE
    await (storage as any).deleteConversation({ convoId: branch.id });

    expect(await storage.getHighlightByBranch(branch.id)).toBeNull();
    expect(await storage.getHighlightsByConvo(sourceConvo.id)).toEqual([]);
    // Source convo + message survive.
    expect(await storage.getMessage({ id: sourceMsg.id })).not.toBeNull();
  });
});
