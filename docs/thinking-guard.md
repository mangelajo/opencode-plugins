# Thinking Guard

Detecta e interrompe loops de raciocínio do modelo.

## Como funciona

Duas estratégias complementares:

### 1. Token Count

Acumula tokens de output por turno. Se passar do **softLimit** → alerta no log. Se passar do **hardLimit** → abort + injeta mensagem de parada.

### 2. Repetição (Jaccard Similarity)

Usa Jaccard similarity em bigramas para detectar se o modelo está repetindo os mesmos trechos. Se 3+ comparações consecutivas entre chunks adjacentes têm similaridade ≥ 0.6 → loop detectado.

### Ação ao detectar loop

1. `session.abort()` — interrompe o step atual
2. Injeta texto "pare de pensar e responda" na sessão

## Configuração

```ts
thinkingGuard({
  softLimit: 10_000,           // alerta
  hardLimit: 20_000,           // abort
  repetitionWindow: 4,         // chunks no buffer
  repetitionSimilarity: 0.6,   // Jaccard threshold
  repetitionConsecutive: 3,    // comparações altas = loop
  stopText: "...",             // texto de parada
})
```

## Guardrails

- Contador reseta quando o usuário manda mensagem nova (não quando o plugin injeta).
- Execuções iniciadas pelo próprio plugin não contam como turno novo.
