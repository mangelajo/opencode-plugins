/**
 * Observabilidade do thinking-guard.
 *
 * Emite eventos estruturados (JSONL + push opcional ao Loki) para
 * monitorar intervenções e calibrar thresholds. Tudo é fire-and-forget:
 * falha de I/O nunca afeta o fluxo do plugin.
 *
 * - JSONL local: sempre ligado (a menos que `enabled: false`), append em
 *   `~/.local/share/opencode/plugins/thinking-guard/events.jsonl`.
 * - Loki: se `THINKING_GUARD_LOKI_URL` (ou a URL passada via opção) estiver
 *   setado, faz POST best-effort em `/loki/api/v1/push`.
 */

import { appendFile, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export const DEFAULT_EVENTS_PATH =
  "~/.local/share/opencode/plugins/thinking-guard/events.jsonl"

export const DEFAULT_LOKI_URL_ENV = "THINKING_GUARD_LOKI_URL"

export type ThinkingGuardEventType =
  | "intervention"
  | "loop_suppressed"
  | "turn_summary"

export interface ThinkingGuardEvent {
  /** Tipo do evento. */
  event: ThinkingGuardEventType
  sessionID: string
  messageID?: string
  providerID?: string
  modelID?: string
  /** Ação tomada (ou motivo da supressão). */
  action?: "abort+prompt" | "cooldown" | "max_interventions"
  /** Similaridade Jaccard do par de chunks mais recente do streak. */
  similarity?: number
  /** Comparações consecutivas acima do threshold no disparo. */
  consecutiveMatches?: number
  /** Chunks analisados no turno (turn_summary). */
  chunksAnalyzed?: number
  /** Maior similaridade entre chunks adjacentes vista no turno. */
  maxSimilarity?: number
  /** Tokens acumulados no turno. */
  tokens?: { output: number; reasoning: number }
  /** Intervenções executadas no turno (turn_summary). */
  interventions?: number
  /** Intervenções suprimidas no turno (turn_summary). */
  suppressed?: number
}

export interface EventSink {
  emit(event: ThinkingGuardEvent): void
}

export interface ObservabilityOptions {
  /** Desativa toda a coleta (default: ligado). */
  enabled?: boolean
  /** Caminho do JSONL — suporta `~` (default: DEFAULT_EVENTS_PATH). */
  jsonlPath?: string
  /** URL base do Loki; se omitido, lê da env `lokiUrlEnv`. */
  lokiUrl?: string
  /** Env var de onde ler a URL do Loki (default: THINKING_GUARD_LOKI_URL). */
  lokiUrlEnv?: string
}

/** Expande `~/` para o home do usuário. */
export function expandHome(path: string): string {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return join(homedir(), path.slice(2))
  return path
}

/**
 * Cria o emitter de eventos. Nunca lança — erros de I/O são engolidos.
 */
export function createEventEmitter(
  options: ObservabilityOptions = {},
): EventSink {
  if (options.enabled === false) return { emit: () => {} }

  const jsonlPath = expandHome(options.jsonlPath ?? DEFAULT_EVENTS_PATH)
  const lokiUrl = (
    options.lokiUrl ??
    process.env[options.lokiUrlEnv ?? DEFAULT_LOKI_URL_ENV]
  )?.replace(/\/+$/, "")

  let dirReady: Promise<unknown> | null = null
  const ensureDir = () => {
    if (!dirReady) {
      dirReady = mkdir(dirname(jsonlPath), { recursive: true }).catch(() => {})
    }
    return dirReady
  }

  return {
    emit(event) {
      const record = { ts: new Date().toISOString(), ...event }
      const line = JSON.stringify(record)

      void ensureDir()
        .then(() => appendFile(jsonlPath, `${line}\n`))
        .catch(() => {})

      if (lokiUrl) void pushToLoki(lokiUrl, record).catch(() => {})
    },
  }
}

/**
 * Push ao Loki com labels de baixa cardinalidade (sessionID fica só no
 * corpo JSON da linha, não como label).
 */
async function pushToLoki(
  base: string,
  record: ThinkingGuardEvent & { ts: string },
): Promise<void> {
  const stream: Record<string, string> = {
    source: "thinking-guard",
    event: record.event,
  }
  if (record.providerID) stream.providerID = record.providerID
  if (record.modelID) stream.modelID = record.modelID

  const body = JSON.stringify({
    streams: [
      {
        stream,
        values: [[String(Date.now() * 1_000_000), JSON.stringify(record)]],
      },
    ],
  })

  const res = await fetch(`${base}/loki/api/v1/push`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  })
  if (!res.ok) throw new Error(`loki push failed: ${res.status}`)
}
