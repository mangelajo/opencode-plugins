/**
 * Feature: Thinking Guard
 *
 * Detecta e interrompe loops de raciocínio do modelo usando duas estratégias:
 *
 * 1. **Token count**: acumula tokens de output por turno. Se passar do
 *    softLimit → alerta. Se passar do hardLimit → abort.
 *
 * 2. **Repetição**: usa Jaccard similarity em bigramas para detectar se
 *    o modelo está repetindo os mesmos trechos (3+ comparações > 0.6 = loop).
 *
 * Ação ao detectar loop:
 * - client.session.abort() para o step atual
 * - Injeta "pare de pensar e responda" via promptAsync
 */

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import type { ThinkingConfig } from "../config"
import { RepetitionBuffer } from "../utils/repetition"
import { SessionTokenCounter } from "../utils/tokens"

export interface ThinkingGuardOptions extends Partial<ThinkingConfig> {
  /** Texto para injetar ao detectar loop. */
  stopText?: string
}

const DEFAULT_STOP_TEXT =
  "[thinking-guard] Você está em loop de raciocínio. Pare de pensar e responda diretamente ao usuário com o que já tem."

/**
 * Cria o plugin thinking-guard.
 *
 * Uso:
 * ```ts
 * import { createThinkingGuardPlugin } from "opencode-plugins"
 * export default createThinkingGuardPlugin()
 * ```
 */
export const createThinkingGuardPlugin = (options?: ThinkingGuardOptions) => {
  const softLimit = options?.softLimit ?? 10_000
  const hardLimit = options?.hardLimit ?? 20_000
  const windowSize = options?.repetitionWindow ?? 4
  const similarityThreshold = options?.repetitionSimilarity ?? 0.6
  const consecutiveThreshold = options?.repetitionConsecutive ?? 3
  const stopText = options?.stopText ?? DEFAULT_STOP_TEXT

  return async (input: PluginInput): Promise<Hooks> => {
    const tokenCounter = new SessionTokenCounter()
    const repetitionBuffers = new Map<string, RepetitionBuffer>()
    const ours = new Set<string>()

    /**
     * Processa mensagem do assistant — acumula tokens e verifica repetição.
     */
    const processAssistantMessage = async (sessionID: string, info: any) => {
      const output = info.tokens?.output ?? 0
      const reasoning = info.tokens?.reasoning ?? 0

      // Acumula tokens.
      const count = tokenCounter.add(sessionID, output, reasoning)

      // Verifica hard limit.
      if (count.output >= hardLimit) {
        console.log(
          `[thinking-guard] hard limit reached: output=${count.output} → abort (${sessionID})`,
        )
        ours.add(sessionID)
        try {
          await input.client.session.abort({ path: { id: sessionID } } as any)
          await input.client.session.promptAsync({
            path: { id: sessionID },
            body: { parts: [{ type: "text", text: stopText }] },
          } as any)
        } catch {
          ours.delete(sessionID)
        }
        return
      }

      // Verifica soft limit (apenas log).
      if (count.output >= softLimit) {
        console.log(
          `[thinking-guard] soft limit reached: output=${count.output} (${sessionID})`,
        )
      }

      // Atualiza buffer de repetição.
      const text = extractText(info)
      if (text) {
        let buffer = repetitionBuffers.get(sessionID)
        if (!buffer) {
          buffer = new RepetitionBuffer(windowSize)
          repetitionBuffers.set(sessionID, buffer)
        }
        buffer.push(text)

        if (buffer.isRepeating(similarityThreshold, consecutiveThreshold)) {
          console.log(
            `[thinking-guard] repetition loop detected → abort (${sessionID})`,
          )
          ours.add(sessionID)
          try {
            await input.client.session.abort({ path: { id: sessionID } } as any)
            await input.client.session.promptAsync({
              path: { id: sessionID },
              body: { parts: [{ type: "text", text: stopText }] },
            } as any)
          } catch {
            ours.delete(sessionID)
          }
        }
      }
    }

    return {
      async event({ event }) {
        // Trata message.updated (user ou assistant).
        if (event.type === "message.updated") {
          const info = (event.properties as any)?.info
          if (info?.role === "user" && info?.sessionID) {
            // Novo turno do usuário → reseta tudo.
            tokenCounter.reset(info.sessionID)
            repetitionBuffers.get(info.sessionID)?.clear()
            ours.delete(info.sessionID)
          } else if (info?.role === "assistant" && info?.sessionID) {
            await processAssistantMessage(info.sessionID, info)
          }
          return
        }

        // Fim do turno → limpa buffers.
        if (event.type === "session.idle") {
          const sessionID = (event.properties as any)?.sessionID as string | undefined
          if (sessionID) {
            repetitionBuffers.delete(sessionID)
            ours.delete(sessionID)
          }
        }
      },
    }
  }
}

/**
 * Extrai texto de uma AssistantMessage para análise de repetição.
 */
function extractText(info: any): string {
  if (!info) return ""
  // Tenta parts primeiro (padrão OpenCode).
  if (Array.isArray(info.parts)) {
    return info.parts
      .filter((p: any) => p.type === "text" && p.text)
      .map((p: any) => p.text)
      .join(" ")
  }
  // Fallback: campo content direto.
  if (typeof info.content === "string") return info.content
  return ""
}
