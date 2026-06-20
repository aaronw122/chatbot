import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

// Minimal supertest-style client over fetch (the bundled supertest is
// incompatible with Bun's node:http app.address() handling). Each method
// returns a thenable with .send() for a JSON body and resolves to { status, body }.
type Res = { status: number; body: any };
function client(base: () => string) {
  const make = (method: string) => (path: string) => {
    let payload: unknown;
    const exec = async (): Promise<Res> => {
      const init: RequestInit = { method, headers: {} };
      if (payload !== undefined) {
        (init.headers as Record<string, string>)["content-type"] = "application/json";
        init.body = JSON.stringify(payload);
      }
      const r = await fetch(base() + path, init);
      const text = await r.text();
      let body: any = undefined;
      try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
      return { status: r.status, body };
    };
    const thenable = {
      send(p: unknown) { payload = p; return thenable; },
      then(onF: (v: Res) => unknown, onR?: (e: unknown) => unknown) { return exec().then(onF, onR); },
    };
    return thenable;
  };
  return {
    get: make("GET"),
    post: make("POST"),
    delete: make("DELETE"),
  };
}

// --- Test environment setup (must happen before importing index) ---

// Valid 32-byte encryption key.
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
// Force InMemoryStorage (USE_SUPABASE !== 'true') and skip app.listen().
process.env.NODE_ENV = "test";
delete process.env.USE_SUPABASE;

// Mutable session the mocked auth returns. Tests set this to simulate
// authenticated / unauthenticated requests.
let currentSession: { user: { id: string } } | null = null;

// Mock better-auth so importing index.ts doesn't spin up a real DB pool and so
// we control getSession's return value.
mock.module("../utils/auth", () => ({
  auth: {
    api: {
      getSession: async () => currentSession,
    },
  },
}));

// Mock the LLM provider so the chat path doesn't make real network calls.
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
  generateReply: async () => "mock assistant reply",
}));

let server: Server;
let baseUrl: string;
let storage: import("../db/storage").Storage;
const api = client(() => baseUrl);

beforeAll(async () => {
  const mod = await import("../index");
  storage = mod.storage;

  // Listen on an OS-assigned ephemeral port and drive requests via the base URL.
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

const USER = "user-123";

function authed() {
  currentSession = { user: { id: USER } };
}
function unauth() {
  currentSession = null;
}

beforeEach(async () => {
  // Fresh key state per test.
  await (storage as any).resetConversations?.();
  authed();
});

describe("GET /api/models (public)", () => {
  it("returns the allow-list without a session", async () => {
    unauth();
    const res = await api.get("/api/models");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("openai");
    expect(res.body).toHaveProperty("anthropic");
  });
});

describe("auth gating (MF3 — 401 for no session)", () => {
  it("GET /api/keys → 401 when unauthenticated", async () => {
    unauth();
    const res = await api.get("/api/keys");
    expect(res.status).toBe(401);
  });

  it("POST /api/keys → 401 when unauthenticated", async () => {
    unauth();
    const res = await api
      .post("/api/keys")
      .send({ provider: "openai", model: "gpt-4o", apiKey: "sk-abc1234" });
    expect(res.status).toBe(401);
  });

  it("POST /api/keys/active → 401 when unauthenticated", async () => {
    unauth();
    const res = await api.post("/api/keys/active").send({ provider: "openai" });
    expect(res.status).toBe(401);
  });

  it("DELETE /api/keys/:provider → 401 when unauthenticated", async () => {
    unauth();
    const res = await api.delete("/api/keys/openai");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/keys", () => {
  it("returns masked meta and never echoes the plaintext key", async () => {
    const apiKey = "sk-secret-plaintext-9999";
    const res = await api
      .post("/api/keys")
      .send({ provider: "openai", model: "gpt-4o", apiKey });

    expect(res.status).toBe(200);
    expect(res.body.provider).toBe("openai");
    expect(res.body.model).toBe("gpt-4o");
    expect(res.body.maskedKey).toBe("sk-…9999");
    // No plaintext key anywhere in the response body.
    expect(JSON.stringify(res.body)).not.toContain(apiKey);
  });

  it("marks the first key active (MF5 first-key activation)", async () => {
    const res = await api
      .post("/api/keys")
      .send({ provider: "openai", model: "gpt-4o", apiKey: "sk-first-0001" });
    expect(res.body.isActive).toBe(true);
  });

  it("rejects unknown provider / disallowed model / empty key with 400", async () => {
    const bad1 = await api
      .post("/api/keys")
      .send({ provider: "cohere", model: "x", apiKey: "k" });
    expect(bad1.status).toBe(400);

    const bad2 = await api
      .post("/api/keys")
      .send({ provider: "openai", model: "not-a-model", apiKey: "k" });
    expect(bad2.status).toBe(400);

    const bad3 = await api
      .post("/api/keys")
      .send({ provider: "openai", model: "gpt-4o", apiKey: "" });
    expect(bad3.status).toBe(400);
  });
});

describe("GET /api/keys", () => {
  it("lists masked metadata and never contains plaintext", async () => {
    await api
      .post("/api/keys")
      .send({ provider: "openai", model: "gpt-4o", apiKey: "sk-list-7777" });

    const res = await api.get("/api/keys");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].maskedKey).toBe("sk-…7777");
    expect(JSON.stringify(res.body)).not.toContain("sk-list-7777");
  });
});

describe("POST /api/keys/active (single active)", () => {
  it("flips active to a single provider", async () => {
    await api
      .post("/api/keys")
      .send({ provider: "openai", model: "gpt-4o", apiKey: "sk-openai-1111" });
    await api
      .post("/api/keys")
      .send({ provider: "anthropic", model: "claude-sonnet-4-5-20250929", apiKey: "sk-anthropic-2222" });

    // openai was the first key → active. Switch to anthropic.
    const res = await api.post("/api/keys/active").send({ provider: "anthropic" });
    expect(res.status).toBe(200);

    const list = await api.get("/api/keys");
    const actives = list.body.filter((k: any) => k.isActive);
    expect(actives).toHaveLength(1);
    expect(actives[0].provider).toBe("anthropic");
  });

  it("404 when activating a provider with no key", async () => {
    const res = await api.post("/api/keys/active").send({ provider: "anthropic" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/keys/:provider (Med7 auto-promote)", () => {
  it("promotes the remaining key when the active one is deleted", async () => {
    await api
      .post("/api/keys")
      .send({ provider: "openai", model: "gpt-4o", apiKey: "sk-openai-aaaa" }); // active (first)
    await api
      .post("/api/keys")
      .send({ provider: "anthropic", model: "claude-sonnet-4-5-20250929", apiKey: "sk-anthropic-bbbb" });

    // Delete the active openai key → anthropic should auto-promote.
    const del = await api.delete("/api/keys/openai");
    expect(del.status).toBe(200);

    const list = await api.get("/api/keys");
    expect(list.body).toHaveLength(1);
    expect(list.body[0].provider).toBe("anthropic");
    expect(list.body[0].isActive).toBe(true);
  });

  it("leaves gated state (no active) when the last key is deleted", async () => {
    await api
      .post("/api/keys")
      .send({ provider: "openai", model: "gpt-4o", apiKey: "sk-only-cccc" });

    await api.delete("/api/keys/openai");

    const active = await storage.getActiveKey({ userId: USER });
    expect(active).toBeNull();
  });

  it("404 when deleting a provider with no key", async () => {
    const res = await api.delete("/api/keys/anthropic");
    expect(res.status).toBe(404);
  });
});

describe("chat without a key → 409 no_api_key", () => {
  it("POST /conversations returns 409 when no active key", async () => {
    const res = await api.post("/conversations").send({ content: "hello world" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("no_api_key");
  });

  it("POST /conversations succeeds once a key is configured", async () => {
    await api
      .post("/api/keys")
      .send({ provider: "openai", model: "gpt-4o", apiKey: "sk-chat-dddd" });

    const res = await api.post("/conversations").send({ content: "hello again" });
    expect(res.status).toBe(200);
    // getAIResponse appended the mocked assistant reply.
    const texts = (res.body as Array<{ role: string; content: string }>).map((m) => m.content);
    expect(texts).toContain("mock assistant reply");
  });
});
