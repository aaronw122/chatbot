import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { InMemoryStorage } from "../db/storage";
import { encrypt } from "../utils/crypto";

// --- Test environment setup (must happen before importing index) ---

process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.NODE_ENV = "test";
delete process.env.USE_SUPABASE;

// Enable the free tier with the forced Haiku model + a small limit. index reads
// these ONCE at import time, which we trigger in beforeAll. The env is set INSIDE
// beforeAll (not at module top-level) and torn down in afterAll so it only lives
// during this file's run window — otherwise it leaks into sibling test files,
// which expect the free tier disabled (their no-key sends must 409, not stream).
const FREE_MODEL = "claude-haiku-4-5-20251001";
const FREE_LIMIT = 5;

let currentSession: { user: { id: string; isAnonymous?: boolean } } | null = null;

mock.module("../utils/auth", () => ({
  auth: { api: { getSession: async () => currentSession } },
}));

// Mock the LLM provider. The allow-list MUST include the forced free-tier model
// or the startup assertModelAllowed (and per-reply validation) would throw.
// Capture the model each path was called with to assert the forced-Haiku rule.
let deltas: string[] = ["Hello", " world"];
let lastStreamModel: string | undefined;
let lastGenerateModel: string | undefined;
// Capture the per-call output cap to assert "cap the free path only".
let lastStreamMaxTokens: number | undefined;
let lastGenerateMaxTokens: number | undefined;

mock.module("../llm/provider", () => ({
  MODELS: {
    anthropic: [FREE_MODEL, "claude-opus-4-8"],
    openai: ["gpt-4o"],
  },
  assertModelAllowed: (provider: string, model: string) => {
    const allow: Record<string, string[]> = {
      anthropic: [FREE_MODEL, "claude-opus-4-8"],
      openai: ["gpt-4o"],
    };
    if (!allow[provider]?.includes(model)) {
      throw new Error("not allowed");
    }
  },
  generateReply: async (args: { model: string; maxTokens?: number }) => {
    lastGenerateModel = args.model;
    lastGenerateMaxTokens = args.maxTokens;
    return deltas.join("");
  },
  // eslint-disable-next-line require-yield
  streamReply: async function* (args: { model: string; maxTokens?: number }) {
    lastStreamModel = args.model;
    lastStreamMaxTokens = args.maxTokens;
    for (const d of deltas) yield d;
  },
}));

let server: Server;
let baseUrl: string;
let storage: import("../db/storage").Storage;

beforeAll(async () => {
  // Set the free-tier env BEFORE importing index (config is read at module eval).
  process.env.FREE_TIER_KEY = "sk-owner-free-key";
  process.env.FREE_TIER_PROVIDER = "anthropic";
  process.env.FREE_TIER_MODEL = FREE_MODEL;
  process.env.FREE_TIER_LIMIT = String(FREE_LIMIT);

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
  // Prevent the free-tier env from leaking into sibling test files.
  delete process.env.FREE_TIER_KEY;
  delete process.env.FREE_TIER_PROVIDER;
  delete process.env.FREE_TIER_MODEL;
  delete process.env.FREE_TIER_LIMIT;
});

const USER = "user-free";

function authed(id = USER) {
  currentSession = { user: { id } };
}
function authedAnon(id = USER) {
  currentSession = { user: { id, isAnonymous: true } };
}
function unauth() {
  currentSession = null;
}

beforeEach(async () => {
  await (storage as any).resetConversations?.();
  authed();
  deltas = ["Hello", " world"];
  lastStreamModel = undefined;
  lastGenerateModel = undefined;
});

// Configure an active BYOK key for the current user (makes them non-free).
async function configureKey(provider = "anthropic", model = "claude-opus-4-8", apiKey = "sk-byok-key") {
  const r = await fetch(baseUrl + "/api/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, model, apiKey }),
  });
  if (r.status !== 200) throw new Error("failed to configure key: " + r.status);
}

// Create a convo via the de-LLM'd JSON route (no counter touch) → convoId.
async function createConvo(content = "first user message"): Promise<string> {
  const r = await fetch(baseUrl + "/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const body = (await r.json()) as Array<{ convoId: string }>;
  return body[0]!.convoId;
}

// Drain an NDJSON stream into parsed frames.
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

// Fire a streaming send for a convo. Returns the raw fetch Response so callers
// can inspect status (pre-flush 402) before deciding to read the body.
function streamSend(convoId: string): Promise<Response> {
  return fetch(baseUrl + "/messages/" + convoId, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ firstReply: true }),
  });
}

// ---------------------------------------------------------------------------

describe("InMemoryStorage free-usage counter", () => {
  it("increments, reads, releases (clamped at 0), and resets", async () => {
    const s = new InMemoryStorage();

    // Unseen user → 0.
    expect(await s.getFreeUsage({ userId: "u1" })).toBe(0);

    expect(await s.incrementFreeUsage({ userId: "u1" })).toBe(1);
    expect(await s.incrementFreeUsage({ userId: "u1" })).toBe(2);
    expect(await s.getFreeUsage({ userId: "u1" })).toBe(2);

    // Different user is independent.
    expect(await s.incrementFreeUsage({ userId: "u2" })).toBe(1);
    expect(await s.getFreeUsage({ userId: "u1" })).toBe(2);

    // Release decrements, clamped at 0.
    await s.releaseFreeUsage({ userId: "u1" });
    expect(await s.getFreeUsage({ userId: "u1" })).toBe(1);
    await s.releaseFreeUsage({ userId: "u1" });
    await s.releaseFreeUsage({ userId: "u1" });
    expect(await s.getFreeUsage({ userId: "u1" })).toBe(0);

    // resetConversations clears the counter.
    await s.incrementFreeUsage({ userId: "u1" });
    await s.resetConversations();
    expect(await s.getFreeUsage({ userId: "u1" })).toBe(0);
  });
});

describe("GET /api/usage", () => {
  it("401 when unauthenticated (/api/keys form, not /conversations 404)", async () => {
    unauth();
    const res = await fetch(baseUrl + "/api/usage");
    expect(res.status).toBe(401);
  });

  it("reports remaining balance and freeTierEnabled:true for a no-key user", async () => {
    const res = await fetch(baseUrl + "/api/usage");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toEqual({
      freeUsed: 0,
      freeLimit: FREE_LIMIT,
      freeRemaining: FREE_LIMIT,
      hasOwnKey: false,
      freeTierEnabled: true,
      isAnonymous: false,
    });
  });

  it("hasOwnKey reflects getActiveKey (true once a BYOK key is active)", async () => {
    await configureKey();
    const res = await fetch(baseUrl + "/api/usage");
    const body = (await res.json()) as any;
    expect(body.hasOwnKey).toBe(true);
  });

  it("freeUsed tracks consumed reservations", async () => {
    const convoId = await createConvo();
    const r = await streamSend(convoId);
    await readNdjson(r);

    const res = await fetch(baseUrl + "/api/usage");
    const body = (await res.json()) as any;
    expect(body.freeUsed).toBe(1);
    expect(body.freeRemaining).toBe(FREE_LIMIT - 1);
  });
});

describe("free-tier streaming gate (POST /messages/:id)", () => {
  it("no-key user gets free replies up to the limit; the (limit+1)th = 402 free_tier_exhausted", async () => {
    for (let i = 0; i < FREE_LIMIT; i++) {
      const convoId = await createConvo(`convo ${i}`);
      const res = await streamSend(convoId);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toContain("application/x-ndjson");
      const frames = await readNdjson(res);
      expect(frames.filter((f) => f.type === "done")).toHaveLength(1);
    }

    expect(await storage.getFreeUsage({ userId: USER })).toBe(FREE_LIMIT);

    // The (limit+1)th send → pre-flush 402 JSON (not a stream).
    const convoId = await createConvo("one too many");
    const res = await streamSend(convoId);
    expect(res.status).toBe(402);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("free_tier_exhausted");
    expect(body.message).toContain(String(FREE_LIMIT));

    // The over-limit reservation was refunded → counter stays at the limit.
    expect(await storage.getFreeUsage({ userId: USER })).toBe(FREE_LIMIT);
  });

  it("free replies are forced to the configured model and capped at 1000 output tokens", async () => {
    const convoId = await createConvo();
    const res = await streamSend(convoId);
    await readNdjson(res);
    expect(lastStreamModel).toBe(FREE_MODEL);
    // Owner-funded free path carries the output cap.
    expect(lastStreamMaxTokens).toBe(1000);
  });

  it("a BYOK user never touches the free counter", async () => {
    await configureKey("anthropic", "claude-opus-4-8");

    for (let i = 0; i < FREE_LIMIT + 2; i++) {
      const convoId = await createConvo(`byok ${i}`);
      const res = await streamSend(convoId);
      expect(res.status).toBe(200);
      await readNdjson(res);
    }

    // Counter untouched, the BYOK model (not the free model) was used, and the
    // BYOK path carries NO output cap (cap is free-path only).
    expect(await storage.getFreeUsage({ userId: USER })).toBe(0);
    expect(lastStreamModel).toBe("claude-opus-4-8");
    expect(lastStreamMaxTokens).toBeUndefined();
  });
});

describe("M5 — both entry points share ONE counter", () => {
  it("streaming and withReply sends decrement the same counter; (limit+1)th across EITHER path = 402", async () => {
    // Consume FREE_LIMIT slots via the withReply (non-streaming) path.
    for (let i = 0; i < FREE_LIMIT; i++) {
      const res = await fetch(baseUrl + "/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: `withReply ${i}`, withReply: true }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ role: string }>;
      expect(body.filter((m) => m.role === "assistant")).toHaveLength(1);
    }

    expect(await storage.getFreeUsage({ userId: USER })).toBe(FREE_LIMIT);
    // withReply replies were forced to Haiku too.
    expect(lastGenerateModel).toBe(FREE_MODEL);

    // (limit+1)th via the STREAMING path → 402 (shared counter).
    const convoId = await createConvo("stream after exhausted");
    const streamRes = await streamSend(convoId);
    expect(streamRes.status).toBe(402);
    expect(((await streamRes.json()) as any).error).toBe("free_tier_exhausted");

    // (limit+1)th via the withReply path → 402 as well.
    const withReplyRes = await fetch(baseUrl + "/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "withReply after exhausted", withReply: true }),
    });
    expect(withReplyRes.status).toBe(402);
    expect(((await withReplyRes.json()) as any).error).toBe("free_tier_exhausted");

    // Both over-limit reservations refunded → counter still at the limit.
    expect(await storage.getFreeUsage({ userId: USER })).toBe(FREE_LIMIT);
  });
});

// ---------------------------------------------------------------------------
// Anonymous-first free tier (account-linking migration + isAnonymous surfacing)
// ---------------------------------------------------------------------------

describe("InMemoryStorage reassignUserData (anonymous → real)", () => {
  it("carries the free-usage count FIRST as greatest(), removes the anon row, and re-points conversations/highlights", async () => {
    const s = new InMemoryStorage();
    const ANON = "anon-1";
    const REAL = "real-1";

    // Anon consumed 3 free replies; the (pre-existing) real account consumed 1.
    await s.incrementFreeUsage({ userId: ANON });
    await s.incrementFreeUsage({ userId: ANON });
    await s.incrementFreeUsage({ userId: ANON });
    await s.incrementFreeUsage({ userId: REAL });

    // Anon owns a saved conversation with a highlight on its message.
    const convo = await s.createConversation({ content: "anon convo", userId: ANON, save: true });
    const msg = await s.addMessage({ convoId: convo.id, role: "assistant", content: "answer" });
    const highlight = await s.createHighlight({
      messageId: msg.id,
      branchConvoId: convo.id,
      startOffset: 0,
      endOffset: 3,
      quote: "ans",
      userId: ANON,
    });

    await s.reassignUserData({ fromUserId: ANON, toUserId: REAL });

    // Count carried as greatest(real=1, anon=3) = 3; anon row removed.
    expect(await s.getFreeUsage({ userId: REAL })).toBe(3);
    expect(await s.getFreeUsage({ userId: ANON })).toBe(0);

    // Conversation + highlight now belong to the real user.
    const realConvos = await s.getConversations({ userId: REAL });
    expect(realConvos.map((c) => c.id)).toContain(convo.id);
    const anonConvos = await s.getConversations({ userId: ANON });
    expect(anonConvos).toHaveLength(0);
    const movedHighlight = (await s.getHighlightsByConvo(convo.id)).find((h) => h.id === highlight.id);
    expect(movedHighlight?.userId).toBe(REAL);
  });

  it("never resets the target to 0-used: greatest() keeps the larger existing count", async () => {
    const s = new InMemoryStorage();
    // Real account already exhausted; anon consumed fewer.
    for (let i = 0; i < FREE_LIMIT; i++) await s.incrementFreeUsage({ userId: "real-2" });
    await s.incrementFreeUsage({ userId: "anon-2" });

    await s.reassignUserData({ fromUserId: "anon-2", toUserId: "real-2" });

    // Stays at the limit — the smaller anon count must not lower it.
    expect(await s.getFreeUsage({ userId: "real-2" })).toBe(FREE_LIMIT);
  });

  it("re-points API keys but keeps the returning user's key on a provider conflict", async () => {
    const s = new InMemoryStorage();
    // Both anon and real have an anthropic key; only anon has an openai key.
    // Distinguishable last-4 suffixes so we can prove which key survived a conflict.
    await s.upsertApiKey({ userId: "anon-3", provider: "anthropic", encryptedKey: encrypt("sk-anon-anthropic-DROP"), model: "m" });
    await s.upsertApiKey({ userId: "anon-3", provider: "openai", encryptedKey: encrypt("sk-anon-openai-MOVE"), model: "m" });
    await s.upsertApiKey({ userId: "real-3", provider: "anthropic", encryptedKey: encrypt("sk-real-anthropic-KEEP"), model: "m" });

    await s.reassignUserData({ fromUserId: "anon-3", toUserId: "real-3" });

    const realKeys = await s.listApiKeys({ userId: "real-3" });
    const providers = realKeys.map((k) => k.provider).sort();
    expect(providers).toEqual(["anthropic", "openai"]);
    // Anon keys are gone (conflicting anthropic dropped, openai moved).
    expect(await s.listApiKeys({ userId: "anon-3" })).toHaveLength(0);
    // The returning user's anthropic key was kept (not overwritten by the anon one).
    const ant = realKeys.find((k) => k.provider === "anthropic")!;
    expect(ant.maskedKey).toBe("sk-…KEEP");
    // The non-conflicting openai key was moved over from the anon user.
    const oai = realKeys.find((k) => k.provider === "openai")!;
    expect(oai.maskedKey).toBe("sk-…MOVE");
  });
});

describe("anonymous session free tier + post-link exhaustion", () => {
  const ANON_USER = "anon-session";
  const REAL_USER = "real-session";

  it("an anonymous session gets free replies to the limit then 402; after linking the real user is exhausted (NOT reset)", async () => {
    // Act as an anonymous session and consume the full free allowance.
    authedAnon(ANON_USER);
    for (let i = 0; i < FREE_LIMIT; i++) {
      const convoId = await createConvo(`anon ${i}`);
      const res = await streamSend(convoId);
      expect(res.status).toBe(200);
      await readNdjson(res);
    }
    expect(await storage.getFreeUsage({ userId: ANON_USER })).toBe(FREE_LIMIT);

    // (limit+1)th as the anon user → 402 free_tier_exhausted (same gate as real users).
    const overConvo = await createConvo("anon over limit");
    const overRes = await streamSend(overConvo);
    expect(overRes.status).toBe(402);
    expect(((await overRes.json()) as any).error).toBe("free_tier_exhausted");

    // better-auth links the anon user into a freshly signed-up real account.
    await storage.reassignUserData({ fromUserId: ANON_USER, toUserId: REAL_USER });

    // The real user inherits the exhausted count — they CANNOT farm a fresh 5.
    expect(await storage.getFreeUsage({ userId: REAL_USER })).toBe(FREE_LIMIT);
    expect(await storage.getFreeUsage({ userId: ANON_USER })).toBe(0);

    // A real (non-anon) session for that user is immediately gated.
    authed(REAL_USER);
    const realConvo = await createConvo("real after link");
    const realRes = await streamSend(realConvo);
    expect(realRes.status).toBe(402);
    expect(((await realRes.json()) as any).error).toBe("free_tier_exhausted");
  });
});

describe("GET /api/usage isAnonymous flag", () => {
  it("returns isAnonymous:true for an anonymous session", async () => {
    authedAnon();
    const res = await fetch(baseUrl + "/api/usage");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.isAnonymous).toBe(true);
  });

  it("returns isAnonymous:false for a real (non-anonymous) session", async () => {
    authed();
    const res = await fetch(baseUrl + "/api/usage");
    const body = (await res.json()) as any;
    expect(body.isAnonymous).toBe(false);
  });
});
