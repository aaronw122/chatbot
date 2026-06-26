import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { InMemoryStorage } from "../db/storage";

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

let currentSession: { user: { id: string } } | null = null;

mock.module("../utils/auth", () => ({
  auth: { api: { getSession: async () => currentSession } },
}));

// Mock the LLM provider. The allow-list MUST include the forced free-tier model
// or the startup assertModelAllowed (and per-reply validation) would throw.
// Capture the model each path was called with to assert the forced-Haiku rule.
let deltas: string[] = ["Hello", " world"];
let lastStreamModel: string | undefined;
let lastGenerateModel: string | undefined;

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
  generateReply: async (args: { model: string }) => {
    lastGenerateModel = args.model;
    return deltas.join("");
  },
  // eslint-disable-next-line require-yield
  streamReply: async function* (args: { model: string }) {
    lastStreamModel = args.model;
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

  it("free replies are forced to the Haiku model", async () => {
    const convoId = await createConvo();
    const res = await streamSend(convoId);
    await readNdjson(res);
    expect(lastStreamModel).toBe(FREE_MODEL);
  });

  it("a BYOK user never touches the free counter", async () => {
    await configureKey("anthropic", "claude-opus-4-8");

    for (let i = 0; i < FREE_LIMIT + 2; i++) {
      const convoId = await createConvo(`byok ${i}`);
      const res = await streamSend(convoId);
      expect(res.status).toBe(200);
      await readNdjson(res);
    }

    // Counter untouched, and the BYOK model (not Haiku) was used.
    expect(await storage.getFreeUsage({ userId: USER })).toBe(0);
    expect(lastStreamModel).toBe("claude-opus-4-8");
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
