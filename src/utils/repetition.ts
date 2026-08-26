/**
 * Detecção de repetição via Jaccard similarity em bigramas.
 *
 * Usado pelo thinking-guard para detectar loops de raciocínio: se o
 * modelo está repetindo os mesmos trechos (high Jaccard entre chunks
 * consecutivos), provavelmente está em loop.
 */

/**
 * Gera bigramas de um texto (pares de palavras adjacentes).
 */
export function bigrams(text: string): Set<string> {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  const result = new Set<string>()
  for (let i = 0; i < words.length - 1; i++) {
    result.add(`${words[i]} ${words[i + 1]}`)
  }
  return result
}

/**
 * Calcula a similaridade de Jaccard entre dois conjuntos.
 * Retorna um valor entre 0 (disjuntos) e 1 (idênticos).
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  if (a.size === 0 || b.size === 0) return 0

  let intersection = 0
  for (const item of a) {
    if (b.has(item)) intersection++
  }
  const union = a.size + b.size - intersection
  return intersection / union
}

/**
 * Compara dois textos e retorna a Jaccard similarity dos bigramas.
 */
export function textSimilarity(a: string, b: string): number {
  return jaccardSimilarity(bigrams(a), bigrams(b))
}

/**
 * Buffer circular de chunks para detecção de repetição consecutiva.
 * Mantém os últimos N chunks e permite verificar se há repetição
 * acima do threshold nas últimas M comparações.
 */
export class RepetitionBuffer {
  private chunks: string[] = []

  constructor(private readonly windowSize: number) {}

  /**
   * Adiciona um chunk ao buffer (descarta o mais antigo se cheio).
   */
  push(chunk: string): void {
    this.chunks.push(chunk)
    if (this.chunks.length > this.windowSize) {
      this.chunks.shift()
    }
  }

  /**
   * Retorna true se as últimas `consecutive` comparações entre chunks
   * adjacentes têm similaridade >= `threshold`.
   */
  isRepeating(threshold: number, consecutive: number): boolean {
    if (this.chunks.length < 2) return false

    let highCount = 0
    // Compara do mais antigo para o mais recente
    for (let i = this.chunks.length - 1; i > 0; i--) {
      const sim = textSimilarity(this.chunks[i - 1], this.chunks[i])
      if (sim >= threshold) {
        highCount++
        if (highCount >= consecutive) return true
      } else {
        // Reseta contagem — precisa ser consecutivo
        highCount = 0
      }
    }
    return false
  }

  /**
   * Limpa o buffer.
   */
  clear(): void {
    this.chunks = []
  }

  /**
   * Retorna o número de chunks no buffer.
   */
  get size(): number {
    return this.chunks.length
  }
}
