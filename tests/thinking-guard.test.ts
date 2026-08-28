import { describe, it, expect } from "vitest"
import { config } from "../src/config"
import { createThinkingGuardPlugin } from "../src/features/thinking-guard"
import { SessionTokenCounter } from "../src/utils/tokens"
import { RepetitionBuffer } from "../src/utils/repetition"
import {
  LOOPING_REASONING_CHUNKS,
  LOOPING_REASONING,
  PRODUCTIVE_REASONING,
  SHORT_NORMAL_REASONING,
} from "./fixtures/reasoning"
import {
  createHarness,
  emitReasoningStream,
  emitAssistantTokens,
  emitUserTurn,
  emitIdle,
} from "./helpers"

/**
 * Testes da API V2 do opencode2: harness monta um Context fake
 * (event.subscribe + session.interrupt/synthetic) e emite eventos reais
 * do bus (session.reasoning.delta, session.usage.updated, ...) — sem
 * custo de LLM. Ver tests/helpers.ts.
 */

describe("thinking-guard config", () => {
  it("has sensible defaults", () => {
    expect(config.thinking.softLimit).toBe(10_000)
    expect(config.thinking.repetitionWindow).toBe(4)
    expect(config.thinking.repetitionSimilarity).toBe(0.6)
    expect(config.thinking.repetitionConsecutive).toBe(3)
    expect(config.thinking.reasoningChunkSize).toBe(600)
  })

  it("looping fixture chunks are similar but not identical (realistic loop)", () => {
    const buffer = new RepetitionBuffer(4)
    for (const chunk of LOOPING_REASONING_CHUNKS.slice(0, 4)) buffer.push(chunk)
    expect(buffer.isRepeating(0.6, 3)).toBe(true)
    // Variação superficial real: chunks não são idênticos.
    expect(LOOPING_REASONING_CHUNKS[0]).not.toBe(LOOPING_REASONING_CHUNKS[1])
  })

  it("productive fixture chunks do not repeat", () => {
    const buffer = new RepetitionBuffer(4)
    const size = 600
    for (let i = 0; i + size <= PRODUCTIVE_REASONING.length; i += size) {
      buffer.push(PRODUCTIVE_REASONING.slice(i, i + size))
    }
    expect(buffer.isRepeating(0.6, 3)).toBe(false)
  })
})

describe("thinking-guard plugin V2", () => {
  it("default export é objeto Plugin.define (id + setup)", () => {
    const plugin = createThinkingGuardPlugin()
    expect(typeof plugin).toBe("object")
    expect(plugin.id).toBe("thinking-guard")
    expect(typeof plugin.setup).toBe("function")
  })

  it("interrupt + synthetic quando o raciocínio entra em loop", async () => {
    const stopText = "Pare de pensar e responda."
    const h = await createHarness({ stopText })

    await emitReasoningStream(h, "sess-1", LOOPING_REASONING)

    expect(h.interrupt).toHaveBeenCalled()
    expect(h.synthetic).toHaveBeenCalledTimes(h.interrupt.mock.calls.length)

    // Argumentos V2: interrupt com sessionID; synthetic flat com resume.
    expect(h.interrupt).toHaveBeenCalledWith({ sessionID: "sess-1" })
    expect(h.synthetic).toHaveBeenCalledWith({
      sessionID: "sess-1",
      text: stopText,
      delivery: "steer",
      resume: true,
    })
  })

  it("NÃO intervm em raciocínio longo e produtivo (sem repetição)", async () => {
    const h = await createHarness()

    await emitReasoningStream(h, "sess-1", PRODUCTIVE_REASONING)
    await emitAssistantTokens(h, "sess-1", { output: 45_000, reasoning: 30_000 })

    expect(h.interrupt).not.toHaveBeenCalled()
    expect(h.synthetic).not.toHaveBeenCalled()
  })

  it("token count alto SEM repetição nunca intervm (regression: log-only)", async () => {
    const h = await createHarness()

    await emitAssistantTokens(h, "sess-1", { output: 15_000, reasoning: 12_000 })
    await emitAssistantTokens(h, "sess-1", { output: 15_000, reasoning: 12_000 })
    await emitReasoningStream(h, "sess-1", SHORT_NORMAL_REASONING)

    expect(h.interrupt).not.toHaveBeenCalled()
  })

  it("thinking curto normal não dispara nada", async () => {
    const h = await createHarness()
    await emitReasoningStream(h, "sess-1", SHORT_NORMAL_REASONING)
    expect(h.interrupt).not.toHaveBeenCalled()
  })

  it("respeita máx. de intervenções por turno", async () => {
    const h = await createHarness({ cooldownMs: 0, maxInterventions: 2 })

    // Loop contínuo — muito mais conteúdo do que o necessário.
    await emitReasoningStream(h, "sess-1", LOOPING_REASONING.repeat(3))

    expect(h.interrupt.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it("cooldown suprime intervenção imediata seguinte", async () => {
    const h = await createHarness({ cooldownMs: 60_000, maxInterventions: 2 })

    await emitReasoningStream(h, "sess-1", LOOPING_REASONING)
    const afterFirst = h.interrupt.mock.calls.length
    expect(afterFirst).toBeGreaterThanOrEqual(1)

    // Mesmo turno (freshTurn: false) → cooldown bloqueia.
    await emitReasoningStream(h, "sess-1", LOOPING_REASONING, { freshTurn: false })
    expect(h.interrupt.mock.calls.length).toBe(afterFirst)
  })

  it("novo turno do usuário reseta o estado (permite nova intervenção)", async () => {
    const h = await createHarness({ cooldownMs: 0, maxInterventions: 1 })

    await emitReasoningStream(h, "sess-1", LOOPING_REASONING)
    expect(h.interrupt.mock.calls.length).toBe(1)

    // Mesmo turno: cap de 1 intervenção por turno mantém.
    await emitReasoningStream(h, "sess-1", LOOPING_REASONING, { freshTurn: false })
    expect(h.interrupt.mock.calls.length).toBe(1)

    // Novo turno (execution.started): buffers e contadores resetados.
    await emitUserTurn(h, "sess-1")
    await emitReasoningStream(h, "sess-1", LOOPING_REASONING, { freshTurn: false })
    expect(h.interrupt.mock.calls.length).toBe(2)
  })

  it("sessões são independentes", async () => {
    const h = await createHarness()
    await emitReasoningStream(h, "sess-a", LOOPING_REASONING)
    await emitReasoningStream(h, "sess-b", PRODUCTIVE_REASONING)

    expect(h.interrupt).toHaveBeenCalledWith({ sessionID: "sess-a" })
    expect(h.interrupt).not.toHaveBeenCalledWith({ sessionID: "sess-b" })
  })

  it("limpa estado no session.idle", async () => {
    const h = await createHarness({ cooldownMs: 0, maxInterventions: 1 })

    await emitReasoningStream(h, "sess-1", LOOPING_REASONING)
    expect(h.interrupt.mock.calls.length).toBe(1)

    await emitIdle(h, "sess-1")

    // Estado limpo → novo loop volta a poder intervir (mesmo turno).
    await emitReasoningStream(h, "sess-1", LOOPING_REASONING, { freshTurn: false })
    expect(h.interrupt.mock.calls.length).toBe(2)
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

  it("set() com valores absolutos mantém o máximo", () => {
    const counter = new SessionTokenCounter()
    counter.set("sess-1", 5_000, 1_000)
    counter.set("sess-1", 4_000, 2_500) // usage re-reporta menor

    const count = counter.get("sess-1")
    expect(count.output).toBe(5_000)
    expect(count.reasoning).toBe(2_500)
  })

  it("resets on new turn", () => {
    const counter = new SessionTokenCounter()
    counter.add("sess-1", 5000)
    counter.reset("sess-1")

    const count = counter.get("sess-1")
    expect(count.output).toBe(0)
    expect(count.steps).toBe(0)
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
