# Changelog

All notable changes to this project will be documented in this file.

## [0.4.0] - 2026-08-28

### Changed (breaking)

- **Port para a API V2 do opencode2** (`Plugin.define`): o plugin passa a
  exportar objeto `{ id, setup(ctx) }` — a função estilo V1 nunca carregou no
  opencode2 (`SchemaError: Expected object at ["default"]`, 51 falhas no log).
  Eventos V2: `session.reasoning.delta` (deltas diretos do thinking),
  `session.usage.updated` (tokens absolutos), `session.model.selected`,
  `session.execution.started` (novo turno), `session.idle`.
  Intervenção: `ctx.session.interrupt()` + `ctx.session.synthetic`
  (`delivery: "steer"`, `resume: true`).
- **truncation portada para V2**: gatilho no `session.idle` quando
  `usage.output >= softLimit` → synthetic resume (o `finish: "length"` da V1
  não existe na V2).

### Fixed

- **Deps isoladas do workspace raiz** (`.npmrc ignore-workspace` + lockfile
  próprio): antes, `pnpm add` na raiz linkava para a store da raiz.
- **`@opencode-ai/plugin` pinada em `0.0.0-beta-18286`**: o range `^` resolve
  para a publicação quebrada `0.0.0-windows-fix-*` (dist incompleto).

## [0.3.0] - 2026-08-27

### Added

- **Observabilidade do thinking-guard**: eventos estruturados em JSONL local
  (`~/.local/share/opencode/plugins/thinking-guard/events.jsonl`) + push
  opcional ao Loki via env `THINKING_GUARD_LOKI_URL` (fail-silent, fire-and-forget).
  - `intervention`: disparos com similarity, consecutiveMatches, tokens, modelID.
  - `loop_suppressed`: loops detectados mas bloqueados por cooldown/cap.
  - `turn_summary`: baseline por turno (chunks, maxSimilarity, tokens,
    intervenções/supressões) — permite medir taxa de falsos positivos.
- **CLI `pnpm analyze:events`** (`scripts/analyze-events.mjs`): resumo das
  métricas (intervenções por modelo/sessão, similaridade média, taxa de
  turnos com intervenção, supressões por motivo).
- **RepetitionBuffer**: expõe `similarityStreak` e `maxSimilarity` para
  telemetria.
- **Captura de providerID/modelID** por sessão (part metadata e message.updated).
- **Dashboard Grafana** (`grafana/thinking-guard-dashboard.json`, uid
  `thinking-guard`): stats de intervenções/supressões/turnos, taxa de turnos
  com intervenção (falsos positivos), similaridade média por modelo,
  tokens por turno e detalhe das intervenções — todas as queries LogQL
  validadas contra o Loki local.

## [0.2.1] - 2026-08-27

### Fixed

- **thinking-guard**: lia `info.parts` no `message.updated` — campo inexistente
  no `AssistantMessage` do SDK, ou seja, o detector de repetição nunca disparava
  com dados reais. Agora escuta `message.part.updated` (`ReasoningPart`), que é
  onde o raciocínio do modelo realmente chega, com extração de delta (stream
  cumulativo ou explícito).

### Changed

- **thinking-guard**: intervenção somente por loop repetitivo confirmado
  (Jaccard similarity). Removido o abort por token count (`hardLimit`) —
  raciocínio longo e produtivo nunca é interrompido; token count virou
  log-only (`softLimit`).

### Added

- **thinking-guard**: guardrails implementados de fato — `maxInterventions`
  por turno e `cooldownMs` (antes só existiam no config, sem efeito).
- **thinking-guard**: chunks de raciocínio de tamanho fixo
  (`reasoningChunkSize`) para análise estável sob streaming.
- **tests/fixtures/reasoning.ts**: corpus realista — loop com variação
  superficial de wording, raciocínio longo produtivo, thinking curto normal.
- **tests**: harness que emite eventos no shape real do SDK (sem custo de
  LLM), com asserção de argumentos de `abort`/`promptAsync`; regression test
  de token count alto sem repetição.

## [0.2.0] - 2026-08-26

### Changed

- **Reestruturação completa**: monolito V1 → módulos (features, utils, tests, docs).
- **Renomeado**: `opencode-auto-continue` → `opencode-plugins`.
- **Entry point**: reduzido a um import de `opencode-plugins/src/index.ts`.

### Added

- **thinking-guard**: feature para detectar e interromper loops de raciocínio via token count + Jaccard similarity.
- **truncation**: feature extraída/refinada da versão V2 (detecção de respostas truncadas).
- **src/config.ts**: configuração centralizada de todos os limites/thresholds.
- **src/utils/repetition.ts**: Jaccard similarity em bigramas + RepetitionBuffer.
- **src/utils/tokens.ts**: SessionTokenCounter para acumulação de tokens por turno.
- **tests/**: testes unitários (repetition, thinking-guard, truncation).
- **docs/**: documentação por feature (thinking-guard.md, truncation.md).

## [0.1.0] - 2026-08-21

### Added

- Versão inicial V1: plugin monolito para auto-continue de respostas truncadas.
