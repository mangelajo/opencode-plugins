import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { existsSync, readFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createEventEmitter,
  DEFAULT_LOKI_URL_ENV,
} from "../src/observability/emitter"
import { LOOPING_REASONING } from "./fixtures/reasoning"
import {
  createHarness,
  emitReasoningStream,
  emitAssistantTokens,
  emitUserTurn,
} from "./helpers"

function tmpEventsPath(): string {
  return join(mkdtempSync(join(tmpdir(), "tg-obs-")), "events.jsonl")
}

/** Lê as linhas JSONL emitidas (espera o append async terminar). */
async function readEvents(path: string, timeout = 2_000) {
  return vi.waitFor(() => {
    const content = readFileSync(path, "utf-8").trim()
    if (!content) throw new Error("events.jsonl still empty")
    return content.split("\n").map((l) => JSON.parse(l))
  }, { timeout })
}

describe("emitter (JSONL + Loki)", () => {
  it("escreve eventos como linhas JSONL com ts", async () => {
    const path = tmpEventsPath()
    const emitter = createEventEmitter({ jsonlPath: path })

    emitter.emit({ event: "intervention", sessionID: "s1", action: "abort+prompt" })

    const events = await readEvents(path)
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe("intervention")
    expect(events[0].sessionID).toBe("s1")
    expect(typeof events[0].ts).toBe("string")
    expect(new Date(events[0].ts).toString()).not.toBe("Invalid Date")
  })

  it("faz push ao Loki quando a URL é fornecida", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", fetchMock)
    const path = tmpEventsPath()

    const emitter = createEventEmitter({
      jsonlPath: path,
      lokiUrl: "http://localhost:3100/",
    })
    emitter.emit({
      event: "intervention",
      sessionID: "s1",
      modelID: "mimo-v2.5",
      similarity: 0.81,
    })

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("http://localhost:3100/loki/api/v1/push")
    expect(init.method).toBe("POST")
    const body = JSON.parse(init.body)
    expect(body.streams[0].stream).toEqual({
      source: "thinking-guard",
      event: "intervention",
      modelID: "mimo-v2.5",
    })
    const line = JSON.parse(body.streams[0].values[0][1])
    expect(line.sessionID).toBe("s1")
    expect(line.similarity).toBe(0.81)
  })

  it("lê a URL do Loki da env var configurável", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", fetchMock)
    process.env[DEFAULT_LOKI_URL_ENV] = "http://loki.local:3100"

    const emitter = createEventEmitter({ jsonlPath: tmpEventsPath() })
    emitter.emit({ event: "turn_summary", sessionID: "s1" })

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toContain("http://loki.local:3100")
  })

  it("nunca lança quando o Loki rejeita (fail-silent)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")))
    const emitter = createEventEmitter({
      jsonlPath: tmpEventsPath(),
      lokiUrl: "http://localhost:3100",
    })
    expect(() =>
      emitter.emit({ event: "intervention", sessionID: "s1" }),
    ).not.toThrow()
  })

  it("nunca lança quando o caminho do JSONL é inválido", () => {
    // dirname aponta para um arquivo comum → mkdir falha → engolido.
    const notADir = tmpEventsPath()
    const emitter = createEventEmitter({ jsonlPath: join(notADir, "x", "events.jsonl") })
    expect(() =>
      emitter.emit({ event: "intervention", sessionID: "s1" }),
    ).not.toThrow()
  })

  it("disabled não escreve nada", async () => {
    const path = tmpEventsPath()
    const emitter = createEventEmitter({ enabled: false, jsonlPath: path })
    emitter.emit({ event: "intervention", sessionID: "s1" })
    await new Promise((r) => setTimeout(r, 50))
    expect(existsSync(path)).toBe(false)
  })
})

describe("observabilidade do thinking-guard (eventos reais)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env[DEFAULT_LOKI_URL_ENV]
  })

  it("intervenção gera evento com sessionID, modelo, similaridade e ação", async () => {
    const h = await createHarness()
    await emitReasoningStream(h, "sess-1", LOOPING_REASONING)

    expect(h.interrupt).toHaveBeenCalled()
    const events = await readEvents(h.eventsPath)
    const intervention = events.find((e) => e.event === "intervention")
    expect(intervention).toBeDefined()
    expect(intervention.sessionID).toBe("sess-1")
    expect(intervention.action).toBe("abort+prompt")
    expect(intervention.modelID).toBe("mimo-v2.5")
    expect(intervention.providerID).toBe("test")
    expect(intervention.similarity).toBeGreaterThanOrEqual(0.6)
    expect(intervention.consecutiveMatches).toBeGreaterThanOrEqual(3)
  })

  it("turno sem loop gera turn_summary sem intervenções (baseline)", async () => {
    const h = await createHarness()
    await emitReasoningStream(h, "sess-1", "análise normal sem repetição nenhuma aqui")
    await emitAssistantTokens(h, "sess-1", { output: 900, reasoning: 700 })
    await emitUserTurn(h, "sess-1")

    const events = await readEvents(h.eventsPath)
    const summary = events.find((e) => e.event === "turn_summary")
    expect(summary).toBeDefined()
    expect(summary.interventions).toBe(0)
    expect(summary.tokens).toEqual({ output: 900, reasoning: 700 })
    expect(summary.modelID).toBe("mimo-v2.5")
    // Nenhuma intervenção aconteceu.
    expect(events.some((e) => e.event === "intervention")).toBe(false)
  })

  it("loop suprimido por cooldown gera loop_suppressed com action cooldown", async () => {
    const h = await createHarness({ cooldownMs: 60_000, maxInterventions: 2 })
    await emitReasoningStream(h, "sess-1", LOOPING_REASONING)
    // Mesmo turno (freshTurn: false) → cooldown suprime a segunda.
    await emitReasoningStream(h, "sess-1", LOOPING_REASONING, { freshTurn: false })

    const events = await readEvents(h.eventsPath)
    const suppressed = events.filter((e) => e.event === "loop_suppressed")
    expect(suppressed.length).toBeGreaterThanOrEqual(1)
    expect(suppressed[0].action).toBe("cooldown")
    expect(suppressed[0].similarity).toBeGreaterThanOrEqual(0.6)
  })

  it("turn_summary registra intervenções e supressões do turno", async () => {
    const h = await createHarness({ cooldownMs: 60_000 })
    await emitReasoningStream(h, "sess-1", LOOPING_REASONING)
    await emitReasoningStream(h, "sess-1", LOOPING_REASONING, { freshTurn: false }) // suprimida
    await emitAssistantTokens(h, "sess-1", { output: 4_000, reasoning: 9_000 })
    await emitUserTurn(h, "sess-1")

    const events = await readEvents(h.eventsPath)
    const summary = events.filter((e) => e.event === "turn_summary").pop()
    expect(summary.interventions).toBe(1)
    expect(summary.suppressed).toBeGreaterThanOrEqual(1)
    expect(summary.maxSimilarity).toBeGreaterThanOrEqual(0.6)
    expect(summary.chunksAnalyzed).toBeGreaterThan(0)
    expect(summary.tokens.output).toBe(4_000)
  })
})
