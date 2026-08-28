# Thinking Guard

Interrompe loops repetitivos de raciocínio do modelo — e somente isso.
Plugin para a **API V2 do opencode2** (`Plugin.define`).

## Filosofia

Raciocínio longo **não é loop**. Modelos de raciocínio (ex.: mimo 2.5) podem
pensar bastante de forma produtiva, e interromper isso por limite de tokens é
prejudicial. O thinking-guard intervém **somente** quando há loop repetitivo
comprovado por similaridade de conteúdo: o caso de uso canônico da ferramenta.

Token count é apenas observabilidade (log) — nunca dispara intervenção.

## Como funciona (eventos do opencode2)

1. O thinking chega em deltas diretos via `session.reasoning.delta`; o texto
   é acumulado por sessão e dividido em chunks de tamanho fixo
   (`reasoningChunkSize`) que alimentam um `RepetitionBuffer` com
   **Jaccard similarity em bigramas**.

2. Se 3+ comparações consecutivas entre chunks adjacentes têm similaridade
   ≥ 0.6 → loop confirmado. Ação:
   - `ctx.session.interrupt()` — interrompe a execução atual
   - `ctx.session.synthetic` (`delivery: "steer"`, `resume: true`) — injeta
     "pare de pensar e responda"

3. `session.usage.updated` alimenta o token counter (log-only);
   `session.model.selected` identifica o modelo; `session.execution.started`
   marca novo turno (reset); `session.idle` fecha o turno.

## Configuração

```ts
createThinkingGuardPlugin({
  softLimit: 10_000,           // log-only (observabilidade)
  reasoningChunkSize: 600,     // chars por chunk de análise
  repetitionWindow: 4,         // chunks no buffer
  repetitionSimilarity: 0.6,   // Jaccard threshold
  repetitionConsecutive: 3,    // comparações altas consecutivas = loop
  stopText: "...",             // texto injetado ao intervir
  cooldownMs: 5_000,           // cooldown entre intervenções
  maxInterventions: 2,         // máx. intervenções por turno
})
```

## Guardrails

- Contador e buffers resetam quando o usuário manda mensagem nova.
- Máx. de intervenções por turno do usuário (default: 2).
- Cooldown entre intervenções (default: 5s).
- Estado limpo no `session.idle`.

## Testes

`tests/thinking-guard.test.ts` emite eventos no shape real do SDK do OpenCode
(`message.part.updated` com `ReasoningPart`, streams cumulativos e deltas
explícitos) contra um client mockado — **sem custo de LLM**. Fixtures em
`tests/fixtures/reasoning.ts` cobrem: loop realista (re-derivação cíclica com
variação superficial de wording), raciocínio longo e produtivo, e thinking
curto normal.

## Observabilidade

Todo evento relevante é emitido em duas camadas (fire-and-forget, falha de
I/O nunca afeta o plugin):

1. **JSONL local** (sempre ligado): append em
   `~/.local/share/opencode/plugins/thinking-guard/events.jsonl`.
2. **Loki opcional**: se a env `THINKING_GUARD_LOKI_URL` apontar para um Loki
   (ex.: o da stack `observability` do unidocs, `http://localhost:3100`), cada
   evento também vai por push com labels de baixa cardinalidade
   (`source="thinking-guard"`, `event`, `providerID`, `modelID`) — consultável
   no Grafana via LogQL `{source="thinking-guard"}`.

### Eventos

| Evento | Quando | Campos-chave |
|---|---|---|
| `intervention` | abort + prompt executados | `similarity`, `consecutiveMatches`, `tokens`, `modelID`, `action: "abort+prompt"` |
| `loop_suppressed` | loop detectado mas bloqueado | `action: "cooldown" \| "max_interventions"` |
| `turn_summary` | fim do turno (novo input do usuário ou `session.idle`) | `chunksAnalyzed`, `maxSimilarity`, `tokens`, `interventions`, `suppressed` |

O `turn_summary` de turnos sem intervenção é o baseline: a **taxa de turnos
com intervenção** é o proxy de falsos positivos para calibrar
`repetitionSimilarity`/`repetitionConsecutive`.

### Desabilitar / configurar

```ts
createThinkingGuardPlugin({
  observability: { enabled: false }, // desliga tudo
  // ou: { jsonlPath: "~/outro/caminho.jsonl", lokiUrl: "http://loki:3100" }
})
```

### Analisar eventos

```bash
pnpm analyze:events                                  # JSONL default
node scripts/analyze-events.mjs ~/caminho/events.jsonl
```

Resumo: intervenções por modelo/sessão, similaridade média dos disparos,
taxa de turnos com intervenção, supressões por cooldown/cap.

### Dashboard no Grafana

Com `THINKING_GUARD_LOKI_URL` apontando para o Loki (ex.: da stack
`observability` do unidocs), os eventos aparecem no dashboard
**Thinking Guard — opencode-plugins** (uid `thinking-guard`):

- Fonte versionada: `grafana/thinking-guard-dashboard.json` (este repo).
- Provisionado em: `unidocs/volumes/grafana/dashboards-json/opencode-thinking-guard.json`
  (provider `default` — o Grafana recarrega automaticamente).
- Painéis: intervenções/loops suprimidos/turnos (stats), taxa de turnos com
  intervenção (proxy de falsos positivos), eventos por tipo, similaridade
  média dos disparos por modelo, tokens output/reasoning por turno,
  intervenções por modelo, supressões por motivo e log detalhado das
  intervenções. Variável `modelID` filtra tudo.
- LogQL base: `{source="thinking-guard"}`.
