#!/usr/bin/env node
/**
 * analyze-events — resume o JSONL de eventos do thinking-guard.
 *
 * Uso:
 *   node scripts/analyze-events.mjs [caminho-do-events.jsonl]
 *   pnpm analyze:events            # usa o caminho default (~/.local/share/...)
 *
 * Métricas: intervenções por modelo/sessão, similaridade média dos
 * disparos, taxa de turnos com intervenção (proxy de falsos positivos)
 * e loops suprimidos por cooldown/cap.
 */

import { createReadStream, existsSync } from "node:fs"
import { createInterface } from "node:readline"
import { homedir } from "node:os"
import { join } from "node:path"

const DEFAULT_PATH = join(
  homedir(),
  ".local/share/opencode/plugins/thinking-guard/events.jsonl",
)

const path = process.argv[2]
  ? process.argv[2].replace(/^~/, homedir())
  : DEFAULT_PATH

if (!existsSync(path)) {
  console.error(`events.jsonl não encontrado: ${path}`)
  process.exit(1)
}

const byEvent = { intervention: [], loop_suppressed: [], turn_summary: [] }
let malformed = 0

const rl = createInterface({ input: createReadStream(path) })
for await (const line of rl) {
  if (!line.trim()) continue
  try {
    const rec = JSON.parse(line)
    if (byEvent[rec.event]) byEvent[rec.event].push(rec)
    else malformed++
  } catch {
    malformed++
  }
}

const interventions = byEvent.intervention
const suppressed = byEvent.loop_suppressed
const turns = byEvent.turn_summary

const groupBy = (arr, key) =>
  arr.reduce((acc, r) => {
    const k = r[key] ?? "unknown"
    ;(acc[k] ??= []).push(r)
    return acc
  }, {})

const fmtPct = (n) => `${(n * 100).toFixed(1)}%`
const avg = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0)

const all = [...turns, ...interventions, ...suppressed].sort((a, b) => a.ts < b.ts ? -1 : 1)

console.log(`\nthinking-guard — análise de eventos`)
console.log(`fonte: ${path}`)
console.log(`período: ${fmtTs(all[0])} → ${fmtTs(all[all.length - 1])}\n`)

console.log(`turnos analisados:    ${turns.length}`)
console.log(`intervenções:         ${interventions.length}`)
console.log(`loops suprimidos:     ${suppressed.length} (cooldown/cap)`)
console.log(`taxa c/ intervenção:  ${turns.length ? fmtPct(turns.filter((t) => t.interventions > 0).length / turns.length) : "n/a"} ← proxy de falsos positivos`)
console.log(`similaridade média:   ${avg(interventions.map((i) => i.similarity)).toFixed(2)} (disparos)`)
console.log(`tokens médios/turno:  ${turns.length ? Math.round(avg(turns.map((t) => t.tokens?.output ?? 0))) : 0} output`)

if (malformed) console.log(`\n⚠ linhas ignoradas: ${malformed}`)

const byModel = groupBy(interventions, "modelID")
if (Object.keys(byModel).length) {
  console.log(`\nintervenções por modelo:`)
  for (const [model, rows] of Object.entries(byModel)) {
    console.log(`  ${model}: ${rows.length} (sim. média ${avg(rows.map((r) => r.similarity)).toFixed(2)})`)
  }
}

const byAction = groupBy(suppressed, "action")
if (Object.keys(byAction).length) {
  console.log(`\nsupressões por motivo:`)
  for (const [action, rows] of Object.entries(byAction)) {
    console.log(`  ${action}: ${rows.length}`)
  }
}

const topSessions = Object.entries(groupBy(interventions, "sessionID"))
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 5)
if (topSessions.length) {
  console.log(`\nsessões com mais intervenções:`)
  for (const [sid, rows] of topSessions) {
    console.log(`  ${sid.slice(0, 12)}…: ${rows.length}`)
  }
}
console.log()

function fmtTs(row) {
  return row ? new Date(row.ts).toISOString().slice(0, 16).replace("T", " ") : "n/a"
}
