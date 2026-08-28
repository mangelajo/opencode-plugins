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

import { appendFile, mkdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export const DEFAULT_EVENTS_PATH =
  "~/.local/share/opencode/plugins/thinking-guard/events.jsonl"

export const DEFAULT_LOKI_URL_ENV = "THINKING_GUARD_LOKI_URL"

/**
 * Arquivo de env do opencode — fallback quando o server é spawnado por
 * supervisor sem herdar o environment do shell.
 */
const OPENCODE_ENV_PATH = "~/.config/opencode/env"

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
  /** Arquivo env de fallback (default: ~/.config/opencode/env). */
  envFilePath?: string
}

/** Expande `~/` para o home do usuário. */
export function expandHome(path: string): string {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return join(homedir(), path.slice(2))
  return path
}

/** Lê KEY=VALUE de um arquivo env (ignora comentários), sem throw. */
async function readEnvFileValue(path: string, key: string): Promise<string | undefined> {
  try {
    const content = await readFile(path, "utf-8")
    for (const line of content.split("\n")) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (match && match[1] === key) {
        return match[2].replace(/^["']|["']$/g, "") || undefined
      }
    }
  } catch {}
  return undefined
}

/**
 * Resolve a URL do Loki: env do processo → ~/.config/opencode/env.
 * O server do opencode costuma ser spawnado por supervisor sem o env do
 * shell, então o arquivo é o fallback confiável.
 */
export async function resolveLokiUrl(
  envKey: string,
  explicit?: string,
): Promise<string | undefined> {
  const fromEnv = (explicit ?? process.env[envKey])?.replace(/\/+$/, "")
  if (fromEnv) return fromEnv
  return (await readEnvFileValue(
    expandHome(OPENCODE_ENV_PATH),
    envKey,
  ))?.replace(/\/+$/, "")
}

/**
 * Cria o emitter de eventos. Nunca lança — erros de I/O são engolidos.
 */
export function createEventEmitter(
  options: ObservabilityOptions = {},
): EventSink {
  if (options.enabled === false) return { emit: () => {} }

  const jsonlPath = expandHome(options.jsonlPath ?? DEFAULT_EVENTS_PATH)
  const envKey = options.lokiUrlEnv ?? DEFAULT_LOKI_URL_ENV
  const envFile = expandHome(options.envFilePath ?? OPENCODE_ENV_PATH)

  let lokiUrl: string | undefined = options.lokiUrl?.replace(/\/+$/, "")
  if (!lokiUrl && process.env[envKey]) {
    lokiUrl = process.env[envKey].replace(/\/+$/, "")
  }
  if (!lokiUrl) {
    // Fallback assíncrono: server spawnado por supervisor não herda env.
    void readEnvFileValue(envFile, envKey).then(
      (v) => {
        lokiUrl = v?.replace(/\/+$/, "")
      },
    )
  }

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

      if (lokiUrl) void pushToLoki(lokiUrl, record)
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
