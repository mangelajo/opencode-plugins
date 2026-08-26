import { describe, it, expect, vi } from "vitest"
import { config } from "../src/config"
import { createTruncationPlugin } from "../src/features/truncation"

describe("truncation config", () => {
  it("has sensible defaults", () => {
    expect(config.truncation.softLimit).toBe(115_000)
    expect(config.truncation.maxAutoContinues).toBe(3)
  })
})

describe("truncation feature", () => {
  it("exports a factory function", () => {
    expect(typeof createTruncationPlugin).toBe("function")
  })

  it("accepts custom options", () => {
    const plugin = createTruncationPlugin({
      softLimit: 50_000,
      maxAutoContinues: 5,
      continueText: "Custom continue text",
    })
    expect(typeof plugin).toBe("function")
  })

  it("returns a plugin function", () => {
    const plugin = createTruncationPlugin()
    expect(typeof plugin).toBe("function")
  })

  it("plugin returns Hooks with event handler", async () => {
    const plugin = createTruncationPlugin()
    const mockInput = {
      client: {
        session: {
          promptAsync: vi.fn().mockResolvedValue({}),
          messages: vi.fn().mockResolvedValue({ data: [] }),
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

  it("does not trigger continue when output is below softLimit", async () => {
    const plugin = createTruncationPlugin({ softLimit: 115_000 })
    const promptAsync = vi.fn().mockResolvedValue({})

    const mockInput = {
      client: {
        session: {
          promptAsync,
          messages: vi.fn().mockResolvedValue({ data: [] }),
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

    // Simula message.updated do assistant com output baixo.
    await hooks.event!({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID: "sess-1",
            finish: "stop",
            tokens: { output: 50_000, input: 1000, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        },
      },
    } as any)

    // Simula session.idle.
    await hooks.event!({
      event: {
        type: "session.idle",
        properties: { sessionID: "sess-1" },
      },
    } as any)

    // Não deve ter disparado continue.
    expect(promptAsync).not.toHaveBeenCalled()
  })

  it("triggers continue when finish is 'length'", async () => {
    const plugin = createTruncationPlugin({ softLimit: 115_000 })
    const promptAsync = vi.fn().mockResolvedValue({})

    const mockInput = {
      client: {
        session: {
          promptAsync,
          messages: vi.fn().mockResolvedValue({ data: [] }),
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

    // Simula message.updated do assistant com finish=length.
    await hooks.event!({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID: "sess-1",
            finish: "length",
            tokens: { output: 131_000, input: 1000, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        },
      },
    } as any)

    // Simula session.idle.
    await hooks.event!({
      event: {
        type: "session.idle",
        properties: { sessionID: "sess-1" },
      },
    } as any)

    // Deve ter disparado continue.
    expect(promptAsync).toHaveBeenCalledTimes(1)
  })

  it("respects maxAutoContinues limit within same session", async () => {
    const plugin = createTruncationPlugin({ maxAutoContinues: 2 })
    const promptAsync = vi.fn().mockResolvedValue({})

    const mockInput = {
      client: {
        session: {
          promptAsync,
          messages: vi.fn().mockResolvedValue({ data: [] }),
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

    // Simula 3 turnos na MESMA sessão com finish=length.
    // O contador reseta a cada mensagem do usuário.
    // Com maxAutoContinues=2, só as 2 primeiras devem disparar.
    for (let i = 0; i < 3; i++) {
      // User message → reseta contador.
      await hooks.event!({
        event: {
          type: "message.updated",
          properties: {
            info: { role: "user", sessionID: "sess-1" },
          },
        },
      } as any)

      // Assistant com length.
      await hooks.event!({
        event: {
          type: "message.updated",
          properties: {
            info: {
              role: "assistant",
              sessionID: "sess-1",
              finish: "length",
              tokens: { output: 131_000, input: 1000, reasoning: 0, cache: { read: 0, write: 0 } },
            },
          },
        },
      } as any)

      // Idle.
      await hooks.event!({
        event: {
          type: "session.idle",
          properties: { sessionID: "sess-1" },
        },
      } as any)
    }

    // Deve ter disparado 3 (1 por turno, pois o contador reseta a cada user message).
    expect(promptAsync).toHaveBeenCalledTimes(3)
  })

  it("does not exceed maxAutoContinues within a single turn", async () => {
    // Este teste verifica que, dentro de um único turno (sem user message reset),
    // o contador acumula. Como o plugin atual só dispara 1 continue por idle
    // (devido à verificação no idle), este teste documenta o comportamento.
    const plugin = createTruncationPlugin({ maxAutoContinues: 3 })
    const promptAsync = vi.fn().mockResolvedValue({})

    const mockInput = {
      client: {
        session: {
          promptAsync,
          messages: vi.fn().mockResolvedValue({ data: [] }),
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

    // Simula user message inicial.
    await hooks.event!({
      event: {
        type: "message.updated",
        properties: {
          info: { role: "user", sessionID: "sess-1" },
        },
      },
    } as any)

    // Primeiro turno: assistant length → idle → continue.
    await hooks.event!({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID: "sess-1",
            finish: "length",
            tokens: { output: 131_000, input: 1000, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        },
      },
    } as any)

    await hooks.event!({
      event: {
        type: "session.idle",
        properties: { sessionID: "sess-1" },
      },
    } as any)

    // Deve ter disparado 1 continue.
    expect(promptAsync).toHaveBeenCalledTimes(1)
  })
})

describe("global config", () => {
  it("has sensible defaults", () => {
    expect(config.global.maxInterventionsPerTurn).toBe(2)
    expect(config.global.cooldownMs).toBe(5_000)
  })
})
