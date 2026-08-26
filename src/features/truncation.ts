/**
 * Feature: Truncation Detection
 *
 * Detecta respostas truncadas pelo limite de output do modelo e injeta
 * um "continue" automático via client.session.promptAsync().
 *
 * Gatilhos (verificados no session.idle):
 * - finish === "length" (step terminou por limite de output)
 * - output tokens >= softLimit (perto do teto)
 *
 * Guardrails:
 * - Máx. maxAutoContinues por turno do usuário.
 * - Contador reseta quando o usuário manda mensagem nova (não quando o
 *   plugin injeta).
 */

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import type { TruncationConfig } from "../config"

export interface TruncationOptions extends Partial<TruncationConfig> {
  /** Texto do prompt de continue. */
  continueText?: string
}

const DEFAULT_CONTINUE_TEXT =
  "[auto-continue] Sua resposta anterior foi interrompida pelo limite de output. Continue EXATAMENTE de onde parou — não repita nada do que já foi dito ou feito."

/**
 * Cria o plugin de truncation.
 *
 * Uso:
 * ```ts
 * import { createTruncationPlugin } from "opencode-plugins"
 * export default createTruncationPlugin()
 * ```
 */
export const createTruncationPlugin = (options?: TruncationOptions) => {
  const softLimit = options?.softLimit ?? 115_000
  const maxContinues = options?.maxAutoContinues ?? 3
  const continueText = options?.continueText ?? DEFAULT_CONTINUE_TEXT

  return async (input: PluginInput): Promise<Hooks> => {
    const lastStep = new Map<string, { finish: string; output: number }>()
    const counts = new Map<string, number>()
    const ours = new Set<string>()

    return {
      async event({ event }) {
        // Trata message.updated (user ou assistant).
        if (event.type === "message.updated") {
          const info = (event.properties as any)?.info
          if (info?.role === "user" && info?.sessionID) {
            // Novo turno do usuário → reseta contador.
            counts.delete(info.sessionID)
          } else if (info?.role === "assistant" && info?.sessionID) {
            // Guarda info do step para análise no idle.
            lastStep.set(info.sessionID, {
              finish: info.finish ?? "",
              output: info.tokens?.output ?? 0,
            })
          }
          return
        }

        if (event.type !== "session.idle") return
        const sessionID = (event.properties as any)?.sessionID as string | undefined
        if (!sessionID) return

        const step = lastStep.get(sessionID)
        lastStep.delete(sessionID)
        if (!step) return

        const truncated = step.finish === "length"
        const nearCap = step.output >= softLimit
        if (!truncated && !nearCap) return
        if ((counts.get(sessionID) ?? 0) >= maxContinues) return

        counts.set(sessionID, (counts.get(sessionID) ?? 0) + 1)
        console.log(
          `[truncation] output=${step.output} finish=${step.finish} → continue #${counts.get(sessionID)} (${sessionID})`,
        )

        ours.add(sessionID)
        try {
          await input.client.session.promptAsync({
            path: { id: sessionID },
            body: {
              parts: [{ type: "text", text: continueText }],
            },
          } as any)
        } catch {
          ours.delete(sessionID)
        }
      },
    }
  }
}
