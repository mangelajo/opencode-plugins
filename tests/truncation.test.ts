import { describe, it, expect } from "vitest"
import { config } from "../src/config"
import { createTruncationPlugin } from "../src/features/truncation"
import {
  createTruncationHarness,
  emitAssistantTokens,
  emitUserTurn,
  emitIdle,
} from "./helpers"

/**
 * Testes da truncation na API V2: session.usage.updated (valores absolutos)
 * + session.idle disparam o auto-continue via session.synthetic(resume).
 */

describe("truncation config", () => {
  it("has sensible defaults", () => {
    expect(config.truncation.softLimit).toBe(115_000)
    expect(config.truncation.maxAutoContinues).toBe(3)
  })
})

describe("truncation plugin V2", () => {
  it("default export é objeto Plugin.define", () => {
    const plugin = createTruncationPlugin()
    expect(typeof plugin).toBe("object")
    expect(plugin.id).toBe("truncation")
    expect(typeof plugin.setup).toBe("function")
  })

  it("accepts custom options", () => {
    const plugin = createTruncationPlugin({
      softLimit: 50_000,
      maxAutoContinues: 5,
      continueText: "Custom continue text",
    })
    expect(plugin.id).toBe("truncation")
  })

  it("continua quando output chega ao softLimit no idle", async () => {
    const h = await createTruncationHarness({ softLimit: 115_000 })

    await emitAssistantTokens(h, "sess-1", { output: 131_000, reasoning: 5_000 })
    await emitIdle(h, "sess-1")

    expect(h.synthetic).toHaveBeenCalledTimes(1)
    const call = h.synthetic.mock.calls[0][0]
    expect(call.sessionID).toBe("sess-1")
    expect(call.resume).toBe(true)
    expect(call.delivery).toBe("steer")
    expect(call.text).toContain("Continue EXATAMENTE")
  })

  it("não continua quando output está abaixo do softLimit", async () => {
    const h = await createTruncationHarness({ softLimit: 115_000 })

    await emitAssistantTokens(h, "sess-1", { output: 50_000 })
    await emitIdle(h, "sess-1")

    expect(h.synthetic).not.toHaveBeenCalled()
  })

  it("não continua sem usage registrado no turno", async () => {
    const h = await createTruncationHarness()
    await emitIdle(h, "sess-1")
    expect(h.synthetic).not.toHaveBeenCalled()
  })

  it("respeita maxAutoContinues por turno", async () => {
    const h = await createTruncationHarness({ softLimit: 100, maxAutoContinues: 2 })

    // Três idle seguidos com output acima do limite: só 2 continues.
    for (let i = 0; i < 3; i++) {
      await emitAssistantTokens(h, "sess-1", { output: 500 })
      await emitIdle(h, "sess-1")
    }
    expect(h.synthetic).toHaveBeenCalledTimes(2)
  })

  it("novo turno do usuário reseta o contador de continues", async () => {
    const h = await createTruncationHarness({ softLimit: 100, maxAutoContinues: 1 })

    await emitAssistantTokens(h, "sess-1", { output: 500 })
    await emitIdle(h, "sess-1")
    expect(h.synthetic).toHaveBeenCalledTimes(1)

    // Cap atingido — sem reset não continuaria de novo.
    await emitAssistantTokens(h, "sess-1", { output: 500 })
    await emitIdle(h, "sess-1")
    expect(h.synthetic).toHaveBeenCalledTimes(1)

    // Novo turno → contador resetado → pode continuar.
    await emitUserTurn(h, "sess-1")
    await emitAssistantTokens(h, "sess-1", { output: 500 })
    await emitIdle(h, "sess-1")
    expect(h.synthetic).toHaveBeenCalledTimes(2)
  })
})
