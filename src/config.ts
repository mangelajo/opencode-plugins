/**
 * Configuração central do plugin opencode-plugins.
 *
 * Todos os limites e thresholds usados pelas features (thinking-guard,
 * truncation) ficam aqui para facilitar ajuste sem tocar na lógica.
 */

export interface ThinkingConfig {
  /** Token count soft limit — apenas log de observabilidade (default: 10_000). */
  softLimit: number
  /** Tamanho em caracteres dos chunks de raciocínio para análise (default: 600). */
  reasoningChunkSize: number
  /** Número de chunks no buffer de repetição (default: 4). */
  repetitionWindow: number
  /** Jaccard similarity threshold para detectar loop (default: 0.6). */
  repetitionSimilarity: number
  /** Comparações consecutivas acima do threshold = loop (default: 3). */
  repetitionConsecutive: number
}

export interface TruncationConfig {
  /** Output tokens soft limit que dispara continue (default: 115_000). */
  softLimit: number
  /** Máx. auto-continues por turno do usuário (default: 3). */
  maxAutoContinues: number
}

export interface GlobalConfig {
  /** Máx. de intervenções por turno (default: 2). */
  maxInterventionsPerTurn: number
  /** Cooldown entre intervenções em ms (default: 5_000). */
  cooldownMs: number
}

export interface ObservabilityConfig {
  /** Liga/desliga toda a coleta (default: true). */
  enabled: boolean
  /** Caminho do JSONL de eventos — suporta `~` (default: ~/.local/share/opencode/plugins/thinking-guard/events.jsonl). */
  jsonlPath: string
  /** Env var de onde ler a URL do Loki para push opcional (default: THINKING_GUARD_LOKI_URL). */
  lokiUrlEnv: string
}

export interface PluginsConfig {
  thinking: ThinkingConfig
  truncation: TruncationConfig
  global: GlobalConfig
  observability: ObservabilityConfig
}

export const config: PluginsConfig = {
  thinking: {
    softLimit: 10_000,
    reasoningChunkSize: 600,
    repetitionWindow: 4,
    repetitionSimilarity: 0.6,
    repetitionConsecutive: 3,
  },
  truncation: {
    softLimit: 115_000,
    maxAutoContinues: 3,
  },
  global: {
    maxInterventionsPerTurn: 2,
    cooldownMs: 5_000,
  },
  observability: {
    enabled: true,
    jsonlPath: "~/.local/share/opencode/plugins/thinking-guard/events.jsonl",
    lokiUrlEnv: "THINKING_GUARD_LOKI_URL",
  },
}
