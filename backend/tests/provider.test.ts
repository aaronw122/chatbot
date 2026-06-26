import { describe, it, expect, mock } from "bun:test";

// A.1 — Unit-test the REAL streamReply against mocked provider SDKs. This file
// mocks @anthropic-ai/sdk and openai (NOT ../llm/provider), so it exercises the
// actual delta-iteration logic in provider.ts.

// Drives the mocked Anthropic stream.
let anthropicDeltas = ["The ", "quick ", "brown ", "fox"];
let openaiDeltas = ["po", "ta", "to"];
let capturedAnthropicSignal: AbortSignal | undefined;
let capturedOpenaiSignal: AbortSignal | undefined;

mock.module("@anthropic-ai/sdk", () => ({
  default: class {
    constructor(_opts: unknown) {}
    messages = {
      stream: (_body: unknown, opts?: { signal?: AbortSignal }) => {
        capturedAnthropicSignal = opts?.signal;
        async function* gen() {
          for (const t of anthropicDeltas) {
            yield { type: "content_block_delta", delta: { type: "text_delta", text: t } };
          }
          // Non-text deltas and non-delta events are ignored.
          yield { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "x" } };
          yield { type: "message_stop" };
        }
        return gen();
      },
    };
  },
}));

mock.module("openai", () => ({
  default: class {
    constructor(_opts: unknown) {}
    chat = {
      completions: {
        create: async (_body: unknown, opts?: { signal?: AbortSignal }) => {
          capturedOpenaiSignal = opts?.signal;
          async function* gen() {
            for (const t of openaiDeltas) {
              yield { choices: [{ delta: { content: t } }] };
            }
            yield { choices: [{ delta: {} }] }; // empty content ignored
          }
          return gen();
        },
      },
    };
  },
}));

const { streamReply } = await import("../llm/provider");

const msgs = [
  { id: "1", convoId: "c", role: "user" as const, content: "hi", createdAt: "" },
];

async function collect(gen: AsyncGenerator<string>): Promise<string> {
  let out = "";
  for await (const d of gen) out += d;
  return out;
}

describe("streamReply — Anthropic", () => {
  it("yields concatenated text matching the mocked SDK stream", async () => {
    anthropicDeltas = ["The ", "quick ", "brown ", "fox"];
    const out = await collect(
      streamReply({
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        apiKey: "sk-x",
        messages: msgs as any,
      })
    );
    expect(out).toBe("The quick brown fox");
  });

  it("forwards the AbortSignal to the SDK", async () => {
    const ctrl = new AbortController();
    await collect(
      streamReply(
        {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          apiKey: "sk-x",
          messages: msgs as any,
        },
        ctrl.signal
      )
    );
    expect(capturedAnthropicSignal).toBe(ctrl.signal);
  });

  it("rejects a disallowed model before streaming", async () => {
    await expect(
      collect(
        streamReply({
          provider: "anthropic",
          model: "not-a-real-model",
          apiKey: "sk-x",
          messages: msgs as any,
        })
      )
    ).rejects.toThrow();
  });
});

describe("streamReply — OpenAI", () => {
  it("yields concatenated text matching the mocked SDK stream", async () => {
    openaiDeltas = ["po", "ta", "to"];
    const out = await collect(
      streamReply({
        provider: "openai",
        model: "gpt-5.5",
        apiKey: "sk-x",
        messages: msgs as any,
      })
    );
    expect(out).toBe("potato");
  });

  it("forwards the AbortSignal to the SDK", async () => {
    const ctrl = new AbortController();
    await collect(
      streamReply(
        {
          provider: "openai",
          model: "gpt-5.5",
          apiKey: "sk-x",
          messages: msgs as any,
        },
        ctrl.signal
      )
    );
    expect(capturedOpenaiSignal).toBe(ctrl.signal);
  });
});
