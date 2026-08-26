# Truncation Detection

Detecta respostas truncadas pelo limite de output do modelo e injeta um "continue" automático.

## Como funciona

Monitora cada step e, no `session.idle`, verifica o último step:

- **finish === "length"** → step terminou por limite de output
- **output >= softLimit** → perto do teto (~88% de ~131k)

Se qualquer condição for verdadeira, injeta um prompt de continue.

## Configuração

```ts
truncation({
  softLimit: 115_000,          // ~88% do teto (~131k)
  maxAutoContinues: 3,         // por turno do usuário
  continueText: "...",         // texto do continue
})
```

## Guardrails

- **Máx. maxAutoContinues por turno** — anti-loop infinito.
- **Contador reseta quando o usuário manda mensagem nova** — não quando o plugin injeta.
- **Execuções iniciadas pelo próprio plugin não contam como turno novo** — evita vazamento do limite.
