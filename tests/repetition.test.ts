import { describe, it, expect } from "vitest"
import {
  bigrams,
  jaccardSimilarity,
  textSimilarity,
  RepetitionBuffer,
} from "../src/utils/repetition"

describe("bigrams", () => {
  it("generates bigrams from text", () => {
    const result = bigrams("the quick brown fox")
    expect(result.size).toBe(3)
    expect(result.has("the quick")).toBe(true)
    expect(result.has("quick brown")).toBe(true)
    expect(result.has("brown fox")).toBe(true)
  })

  it("returns empty set for single word", () => {
    const result = bigrams("hello")
    expect(result.size).toBe(0)
  })

  it("returns empty set for empty string", () => {
    const result = bigrams("")
    expect(result.size).toBe(0)
  })

  it("is case insensitive", () => {
    const a = bigrams("Hello World")
    const b = bigrams("hello world")
    expect(a).toEqual(b)
  })
})

describe("jaccardSimilarity", () => {
  it("returns 1 for identical sets", () => {
    const a = new Set(["a", "b", "c"])
    expect(jaccardSimilarity(a, a)).toBe(1)
  })

  it("returns 0 for disjoint sets", () => {
    const a = new Set(["a", "b"])
    const b = new Set(["c", "d"])
    expect(jaccardSimilarity(a, b)).toBe(0)
  })

  it("returns 0.5 for half overlap", () => {
    const a = new Set(["a", "b", "c"])
    const b = new Set(["a", "b", "d"])
    // intersection = 2, union = 4 → 0.5
    expect(jaccardSimilarity(a, b)).toBeCloseTo(0.5, 5)
  })

  it("returns 0 when both sets are empty", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0)
  })

  it("returns 0 when one set is empty", () => {
    expect(jaccardSimilarity(new Set(["a"]), new Set())).toBe(0)
  })
})

describe("textSimilarity", () => {
  it("returns high similarity for near-duplicate text", () => {
    const a = "the quick brown fox jumps over the lazy dog"
    const b = "the quick brown fox jumps over the lazy dog"
    expect(textSimilarity(a, b)).toBe(1)
  })

  it("returns low similarity for different text", () => {
    const a = "the quick brown fox"
    const b = "completely different words here"
    expect(textSimilarity(a, b)).toBeLessThan(0.3)
  })

  it("returns medium similarity for partial overlap", () => {
    const a = "the quick brown fox jumps over the lazy dog"
    const b = "the quick brown cat jumps over the lazy mouse"
    const sim = textSimilarity(a, b)
    expect(sim).toBeGreaterThan(0.3)
    expect(sim).toBeLessThan(0.9)
  })
})

describe("RepetitionBuffer", () => {
  it("detects repetition when consecutive comparisons exceed threshold", () => {
    const buffer = new RepetitionBuffer(4)
    buffer.push("the quick brown fox jumps over the lazy dog")
    buffer.push("the quick brown fox jumps over the lazy dog")
    buffer.push("the quick brown fox jumps over the lazy dog")
    buffer.push("the quick brown fox jumps over the lazy dog")

    expect(buffer.isRepeating(0.6, 3)).toBe(true)
  })

  it("does not flag non-repeating text", () => {
    const buffer = new RepetitionBuffer(4)
    buffer.push("first unique sentence here")
    buffer.push("second different phrase entirely")
    buffer.push("third distinct statement now")
    buffer.push("fourth unrelated text block")

    expect(buffer.isRepeating(0.6, 3)).toBe(false)
  })

  it("requires consecutive high similarity (resets on low)", () => {
    const buffer = new RepetitionBuffer(5)
    buffer.push("the quick brown fox jumps over the lazy dog")
    buffer.push("the quick brown fox jumps over the lazy dog")
    buffer.push("completely different text breaks the pattern")
    buffer.push("the quick brown fox jumps over the lazy dog")
    buffer.push("the quick brown fox jumps over the lazy dog")

    // Só tem 2 consecutivos no fim, não 3.
    expect(buffer.isRepeating(0.6, 3)).toBe(false)
  })

  it("respects window size", () => {
    const buffer = new RepetitionBuffer(2)
    buffer.push("first")
    buffer.push("second")
    buffer.push("third")
    expect(buffer.size).toBe(2)
  })

  it("clears correctly", () => {
    const buffer = new RepetitionBuffer(4)
    buffer.push("text one")
    buffer.push("text two")
    buffer.clear()
    expect(buffer.size).toBe(0)
  })
})
