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

// Mock the LLM provider so the streaming path doesn't make real network calls.
// streamReply is an async generator yielding text deltas; tests set `deltas`
// (and optionally `throwAfter`) to drive the stream.
let deltas: string[] = ["Hello", ", ", "world"];
let throwAfter: number | null = null; // throw a provider error after N yields
let lastSignal: AbortSignal | undefined;

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
  generateReply: async () => deltas.join(""),
  // eslint-disable-next-line require-yield
  streamReply: async function* (_args: unknown, signal?: AbortSignal) {
    lastSignal = signal;
    let i = 0;
    for (const d of deltas) {
      yield d;
      i++;
      if (throwAfter !== null && i >= throwAfter) {
        throw new Error("provider exploded mid-stream");
      }
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

const USER = "user-stream";

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
  throwAfter = null;
  lastSignal = undefined;
});

// Helper: configure an active key so the streaming path is unblocked.
async function configureKey(
  provider = "openai",
  model = "gpt-4o",
  apiKey = "sk-stream-key"
) {
  const r = await fetch(baseUrl + "/api/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, model, apiKey }),
  });
  if (r.status !== 200) throw new Error("failed to configure key: " + r.status);
}

// Helper: create a convo (de-LLM'd JSON route) and return its convoId.
async function createConvo(content = "first user message"): Promise<string> {
  const r = await fetch(baseUrl + "/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const body = (await r.json()) as Array<{ convoId: string }>;
  // /conversations returns the message array; pull convoId off the first row.
  return body[0]!.convoId;
}

// Helper: read an NDJSON stream into an array of parsed frames.
async function readNdjson(res: Response): Promise<any[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const frames: any[] = [];
  // eslint-disable-next-line no-constant-condition
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

describe("A.2 — POST /messages/:id streaming", () => {
  it("no active key → 409 no_api_key BEFORE any bytes (JSON, not a stream)", async () => {
    const convoId = await createConvo("hello");
    // No key configured for USER → streamAIResponse throws NoKeyError pre-flush.
    const res = await fetch(baseUrl + "/messages/" + convoId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstReply: true }),
    });
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("no_api_key");
  });

  it("401 when unauthenticated", async () => {
    unauth();
    const res = await fetch(baseUrl + "/messages/anything", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstReply: true }),
    });
    expect(res.status).toBe(401);
  });

  it("streams NDJSON chunk frames then exactly one done; persists assembled message once", async () => {
    await configureKey();
    const convoId = await createConvo("first user message");

    const res = await fetch(baseUrl + "/messages/" + convoId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstReply: true }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("application/x-ndjson");

    const frames = await readNdjson(res);
    const chunks = frames.filter((f) => f.type === "chunk");
    const terminals = frames.filter((f) => f.type === "done" || f.type === "error");

    expect(chunks.map((c) => c.text)).toEqual(["Hello", ", ", "world"]);
    expect(terminals).toHaveLength(1);
    expect(terminals[0].type).toBe("done");

    // Assembled assistant message persisted exactly once.
    const msgs = await storage.getMessages({ convoId });
    const assistant = msgs.filter((m) => m.role === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0]!.content).toBe("Hello, world");

    // firstReply marker → user message NOT duplicated (only the one from /conversations).
    const userMsgs = msgs.filter((m) => m.role === "user");
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0]!.content).toBe("first user message");
  });

  it("normal send (non-empty content) persists the incoming user message", async () => {
    await configureKey();
    const convoId = await createConvo("first user message");

    const res = await fetch(baseUrl + "/messages/" + convoId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "second user turn", role: "user", convoId }),
    });
    expect(res.status).toBe(200);
    await readNdjson(res);

    const msgs = await storage.getMessages({ convoId });
    const userMsgs = msgs.filter((m) => m.role === "user").map((m) => m.content);
    expect(userMsgs).toEqual(["first user message", "second user turn"]);
    const assistant = msgs.filter((m) => m.role === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0]!.content).toBe("Hello, world");
  });

  it("provider error mid-stream → single {type:'error'} terminal; partial persisted once", async () => {
    await configureKey();
    const convoId = await createConvo("first user message");
    deltas = ["par", "tial"];
    throwAfter = 2; // throw after yielding both deltas

    const res = await fetch(baseUrl + "/messages/" + convoId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstReply: true }),
    });
    expect(res.status).toBe(200);

    const frames = await readNdjson(res);
    const chunks = frames.filter((f) => f.type === "chunk");
    const terminals = frames.filter((f) => f.type === "done" || f.type === "error");
    expect(chunks.map((c) => c.text)).toEqual(["par", "tial"]);
    expect(terminals).toHaveLength(1);
    expect(terminals[0].type).toBe("error");

    const msgs = await storage.getMessages({ convoId });
    const assistant = msgs.filter((m) => m.role === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0]!.content).toBe("partial");
  });

  it("passes an AbortSignal through to streamReply", async () => {
    await configureKey();
    const convoId = await createConvo("first user message");
    const res = await fetch(baseUrl + "/messages/" + convoId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstReply: true }),
    });
    await readNdjson(res);
    expect(lastSignal).toBeInstanceOf(AbortSignal);
  });
});

describe("A.2 — POST /conversations is de-LLM'd (no assistant reply)", () => {
  it("creates convo + persists user message, makes NO LLM call", async () => {
    await configureKey();
    const res = await fetch(baseUrl + "/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "just the user message" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ role: string; content: string }>;
    // Only the user's message — no assistant reply generated here.
    expect(body).toHaveLength(1);
    expect(body[0]!.role).toBe("user");
    expect(body[0]!.content).toBe("just the user message");
  });
});

describe("A.2 — POST /conversations { withReply:true } (mini-window opt-in reply)", () => {
  it("with withReply:true → returns [userMsg, assistantReply] and persists the assistant message", async () => {
    await configureKey();
    deltas = ["Hello", ", ", "world"]; // generateReply joins these → "Hello, world"
    const res = await fetch(baseUrl + "/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "mini first message", withReply: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ convoId: string; role: string; content: string }>;
    // Pre-streaming shape: user message + inline (non-streaming) assistant reply.
    expect(body).toHaveLength(2);
    expect(body[0]!.role).toBe("user");
    expect(body[0]!.content).toBe("mini first message");
    expect(body[1]!.role).toBe("assistant");
    expect(body[1]!.content).toBe("Hello, world");

    // Assistant reply was persisted (not just returned).
    const msgs = await storage.getMessages({ convoId: body[0]!.convoId });
    const assistant = msgs.filter((m) => m.role === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0]!.content).toBe("Hello, world");
  });

  it("without the flag → NO assistant reply generated (single user message)", async () => {
    await configureKey();
    const res = await fetch(baseUrl + "/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "no reply please" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ role: string; content: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]!.role).toBe("user");
    const assistant = body.filter((m) => m.role === "assistant");
    expect(assistant).toHaveLength(0);
  });

  it("withReply:true but no active key → 409 no_api_key gate (mini-window surfaces key gate)", async () => {
    // No key configured for USER → getAIResponse throws NoKeyError.
    const res = await fetch(baseUrl + "/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "need a key", withReply: true }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("no_api_key");
  });
});
