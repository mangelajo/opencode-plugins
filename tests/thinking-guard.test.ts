import { describe, it, expect, vi } from "vitest"
import { config } from "../src/config"
import { createThinkingGuardPlugin } from "../src/features/thinking-guard"
import { SessionTokenCounter } from "../src/utils/tokens"
import { RepetitionBuffer } from "../src/utils/repetition"

describe("thinking-guard config", () => {
  it("has sensible defaults", () => {
    expect(config.thinking.softLimit).toBe(10_000)
    expect(config.thinking.hardLimit).toBe(20_000)
    expect(config.thinking.repetitionWindow).toBe(4)
    expect(config.thinking.repetitionSimilarity).toBe(0.6)
    expect(config.thinking.repetitionConsecutive).toBe(3)
  })
})

describe("thinking-guard feature", () => {
  it("exports a factory function", () => {
    expect(typeof createThinkingGuardPlugin).toBe("function")
  })

  it("accepts custom options", () => {
    const plugin = createThinkingGuardPlugin({
      softLimit: 5_000,
      hardLimit: 10_000,
      stopText: "Stop thinking!",
    })
    expect(typeof plugin).toBe("function")
  })

  it("plugin returns Hooks with event handler", async () => {
    const plugin = createThinkingGuardPlugin()
    const mockInput = {
      client: {
        session: {
          abort: vi.fn().mockResolvedValue({}),
          promptAsync: vi.fn().mockResolvedValue({}),
        },
      },
      project: {},
      directory: "/tmp",
      worktree: "/tmp",
      experimental_workspace: { register: vi.fn() },
      serverUrl: new URL("http://localhost:3000"),
      $: {},
    } as any

    const hooks = await plugin(mockInput)
    expect(hooks).toBeDefined()
    expect(typeof hooks.event).toBe("function")
  })

  it("triggers abort when hard limit is reached", async () => {
    const plugin = createThinkingGuardPlugin({ hardLimit: 10_000 })
    const abort = vi.fn().mockResolvedValue({})
    const promptAsync = vi.fn().mockResolvedValue({})

    const mockInput = {
      client: {
        session: {
          abort,
          promptAsync,
        },
      },
      project: {},
      directory: "/tmp",
      worktree: "/tmp",
      experimental_workspace: { register: vi.fn() },
      serverUrl: new URL("http://localhost:3000"),
      $: {},
    } as any

    const hooks = await plugin(mockInput)

    // Simula mensagem do assistant com muitos tokens.
    await hooks.event!({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID: "sess-1",
            finish: "stop",
            tokens: { output: 15_000, input: 1000, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        },
      },
    } as any)

    // Deve ter abortado e injetado mensagem.
    expect(abort).toHaveBeenCalledTimes(1)
    expect(promptAsync).toHaveBeenCalledTimes(1)
  })

  it("does not abort when output is below hard limit", async () => {
    const plugin = createThinkingGuardPlugin({ hardLimit: 20_000 })
    const abort = vi.fn().mockResolvedValue({})

    const mockInput = {
      client: {
        session: {
          abort,
          promptAsync: vi.fn().mockResolvedValue({}),
        },
      },
      project: {},
      directory: "/tmp",
      worktree: "/tmp",
      experimental_workspace: { register: vi.fn() },
      serverUrl: new URL("http://localhost:3000"),
      $: {},
    } as any

    const hooks = await plugin(mockInput)

    await hooks.event!({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID: "sess-1",
            finish: "stop",
            tokens: { output: 5_000, input: 1000, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        },
      },
    } as any)

    expect(abort).not.toHaveBeenCalled()
  })
})

describe("SessionTokenCounter", () => {
  it("accumulates tokens across messages", () => {
    const counter = new SessionTokenCounter()
    counter.add("sess-1", 1000, 200)
    counter.add("sess-1", 2000, 300)

    const count = counter.get("sess-1")
    expect(count.output).toBe(3000)
    expect(count.reasoning).toBe(500)
    expect(count.steps).toBe(2)
  })

  it("resets on new turn", () => {
    const counter = new SessionTokenCounter()
    counter.add("sess-1", 5000)
    counter.reset("sess-1")

    const count = counter.get("sess-1")
    expect(count.output).toBe(0)
    expect(count.steps).toBe(0)
  })

  it("tracks multiple sessions", () => {
    const counter = new SessionTokenCounter()
    counter.add("sess-1", 1000)
    counter.add("sess-2", 2000)

    expect(counter.get("sess-1").output).toBe(1000)
    expect(counter.get("sess-2").output).toBe(2000)
    expect(counter.sessionCount).toBe(2)
  })
})

describe("RepetitionBuffer", () => {
  it("detects repetition in consecutive chunks", () => {
    const buffer = new RepetitionBuffer(4)
    const text = "the quick brown fox jumps over the lazy dog"
    buffer.push(text)
    buffer.push(text)
    buffer.push(text)
    buffer.push(text)

    expect(buffer.isRepeating(0.6, 3)).toBe(true)
  })

  it("does not flag non-repeating text", () => {
    const buffer = new RepetitionBuffer(4)
    buffer.push("first unique sentence here")
    buffer.push("second different phrase entirely")
    buffer.push("third distinct statement now")
    buffer.push("fourth unrelated text block")

    expect(buffer.isRepeating(0.6, 3)).toBe(false)
  })
})
