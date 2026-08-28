import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { vi } from "vitest"
import {
  createThinkingGuardPlugin,
  type ThinkingGuardOptions,
} from "../src/features/thinking-guard"
import { createTruncationPlugin, type TruncationOptions } from "../src/features/truncation"

/**
 * Harness compartilhado para a API V2 do opencode2: monta um Context fake
 * (event.subscribe como async iterator, session.interrupt/synthetic como
 * mocks) — sem custo de LLM. O JSONL de observabilidade vai para tmpdir.
 */
export interface Harness {
  emit(event: { type: string; data?: any }): Promise<void>
  interrupt: ReturnType<typeof vi.fn>
  synthetic: ReturnType<typeof vi.fn>
  cleanup: () => void
  /** Caminho do JSONL de eventos (tmpdir próprio do harness). */
  eventsPath: string
}

function tmpEventsPath(): string {
  return join(mkdtempSync(join(tmpdir(), "thinking-guard-")), "events.jsonl")
}

async function setupWith(
  plugin: { id: string; setup: (ctx: any) => Promise<() => void> },
  eventsPath: string,
): Promise<Harness> {
  const interrupt = vi.fn().mockResolvedValue({ interrupted: true })
  const synthetic = vi.fn().mockResolvedValue({})

  const queue: { type: string; data?: any }[] = []
  const subscribe = vi.fn(async function* ({ signal }: { signal?: AbortSignal }) {
    while (!signal?.aborted) {
      if (queue.length) {
        yield queue.shift()
        continue
      }
      await new Promise((r) => setTimeout(r, 1))
    }
  })

  const cleanup = await plugin.setup({
    event: { subscribe },
    session: { interrupt, synthetic },
  })

  const emit = async (event: { type: string; data?: any }) => {
    queue.push(event)
    // Dá um tick para o generator consumir e o core processar.
    await new Promise((r) => setTimeout(r, 4))
  }

  return { emit, interrupt, synthetic, cleanup, eventsPath }
}

export async function createHarness(
  options?: ThinkingGuardOptions,
): Promise<Harness> {
  const eventsPath = tmpEventsPath()
  return setupWith(
    createThinkingGuardPlugin({
      // envFilePath inexistente: testes nunca leem o ~/.config/opencode/env real.
      observability: { jsonlPath: eventsPath, envFilePath: `${eventsPath}.env` },
      ...options,
    }) as any,
    eventsPath,
  )
}

export async function createTruncationHarness(
  options?: TruncationOptions,
): Promise<Harness> {
  return setupWith(createTruncationPlugin(options) as any, tmpEventsPath())
}

/**
 * Emite um stream de raciocínio como o opencode2 emite: por padrão um
 * session.execution.started (novo turno) + session.model.selected e uma
 * sequência de session.reasoning.delta (deltas diretos). Use
 * `freshTurn: false` para streams subsequentes do mesmo turno.
 */
export async function emitReasoningStream(
  h: Harness,
  sessionID: string,
  text: string,
  { deltaSize = 48, messageID = "msg-1", freshTurn = true } = {},
) {
  if (freshTurn) {
    await h.emit({ type: "session.execution.started", data: { sessionID } })
    await h.emit({
      type: "session.model.selected",
      data: { sessionID, model: { id: "mimo-v2.5", providerID: "test" } },
    })
  }
  for (let i = 0; i < text.length; i += deltaSize) {
    await h.emit({
      type: "session.reasoning.delta",
      data: { sessionID, assistantMessageID: messageID, ordinal: i, delta: text.slice(i, i + deltaSize) },
    })
  }
}

/** Emite uso de tokens (valores absolutos, como o usage.updated real). */
export async function emitAssistantTokens(
  h: Harness,
  sessionID: string,
  tokens: { output: number; reasoning?: number },
) {
  await h.emit({
    type: "session.usage.updated",
    data: {
      sessionID,
      tokens: {
        output: tokens.output,
        reasoning: tokens.reasoning ?? 0,
        input: 1000,
        cache: { read: 0, write: 0 },
      },
    },
  })
}

/** Emite novo turno do usuário (execution.started reseta o estado). */
export async function emitUserTurn(h: Harness, sessionID: string) {
  await h.emit({ type: "session.execution.started", data: { sessionID } })
}

/** Emite fim de sessão. */
export async function emitIdle(h: Harness, sessionID: string) {
  await h.emit({ type: "session.idle", data: { sessionID } })
}
