/**
 * Contador de tokens por sessão.
 *
 * Acumula tokens de output ao longo de steps dentro de um mesmo turno
 * para detectar quando o modelo está gastando muitos tokens (sinal de
 * loop de raciocínio).
 */

export interface TokenCount {
  /** Total de tokens de output no turno atual. */
  output: number
  /** Total de tokens de reasoning no turno atual (se disponível). */
  reasoning: number
  /** Número de steps acumulados. */
  steps: number
}

export class SessionTokenCounter {
  private sessions = new Map<string, TokenCount>()

  /**
   * Registra tokens de um step para a sessão.
   */
  add(sessionID: string, output: number, reasoning = 0): TokenCount {
    const current = this.sessions.get(sessionID) ?? {
      output: 0,
      reasoning: 0,
      steps: 0,
    }
    const updated: TokenCount = {
      output: current.output + output,
      reasoning: current.reasoning + reasoning,
      steps: current.steps + 1,
    }
    this.sessions.set(sessionID, updated)
    return updated
  }

  /**
   * Define tokens acumulados do turno a partir de valores absolutos
   * (eventos usage trazem totais, não deltas). Mantém o máximo visto.
   */
  set(sessionID: string, output: number, reasoning = 0): TokenCount {
    const current = this.sessions.get(sessionID) ?? {
      output: 0,
      reasoning: 0,
      steps: 0,
    }
    const updated: TokenCount = {
      output: Math.max(current.output, output),
      reasoning: Math.max(current.reasoning, reasoning),
      steps: current.steps,
    }
    this.sessions.set(sessionID, updated)
    return updated
  }

  /**
   * Retorna o contador atual da sessão (ou zeros se não existir).
   */
  get(sessionID: string): TokenCount {
    return this.sessions.get(sessionID) ?? { output: 0, reasoning: 0, steps: 0 }
  }

  /**
   * Reseta o contador da sessão (novo turno do usuário).
   */
  reset(sessionID: string): void {
    this.sessions.delete(sessionID)
  }

  /**
   * Reseta todos os contadores.
   */
  resetAll(): void {
    this.sessions.clear()
  }

  /**
   * Retorna o número de sessões monitoradas.
   */
  get sessionCount(): number {
    return this.sessions.size
  }
}
