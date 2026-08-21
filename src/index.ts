import type { Plugin } from "@opencode-ai/plugin"

// Auto-continue: detects a truncated response (or one near the output cap) and
// injects an automatic "continue" into the session.
//
// Motivation: models with large output caps sometimes enter reasoning loops,
// truncating the answer mid-way. This plugin asks "are you done?" from the
// outside: if the last assistant message hit the output limit or crossed the
// soft limit, it sends a continue prompt. Otherwise it does nothing.
//
// Guardrails:
// - Max MAX_AUTO_CONTINUES per user turn (anti infinite-loop).
// - Counter resets when the user sends a new message.
// - Soft limit well below the cap to also catch "finished but glued to the cap".

export interface AutoContinueOptions {
  /** Output tokens soft limit that triggers a continue (default: 115_000). */
  outputSoftLimit?: number
  /** Max auto-continues per user turn (default: 3). */
  maxAutoContinues?: number
  /** Custom continuation prompt text. */
  continueText?: string
}

const DEFAULT_SOFT_LIMIT = 115_000 // ~88% of a ~131k cap
const DEFAULT_MAX_CONTINUES = 3
const DEFAULT_CONTINUE_TEXT =
  "[auto-continue] Your previous response was interrupted by the output limit. Continue EXACTLY where you left off — do not repeat anything already said or done."

export const autoContinue =
  (options?: AutoContinueOptions): Plugin =>
  async ({ client }) => {
    const softLimit = options?.outputSoftLimit ?? DEFAULT_SOFT_LIMIT
    const maxContinues = options?.maxAutoContinues ?? DEFAULT_MAX_CONTINUES
    const continueText = options?.continueText ?? DEFAULT_CONTINUE_TEXT

    const counts = new Map<string, number>()

    return {
      event: async ({ event }) => {
        // New user message → reset the session counter.
        if (event.type === "message.updated") {
          const info = (event.properties as any)?.info
          if (info?.role === "user" && info?.sessionID)
            counts.delete(info.sessionID)
          return
        }

        if (event.type !== "session.idle") return
        const sessionID = (event.properties as any)?.sessionID as string | undefined
        if (!sessionID) return
        if ((counts.get(sessionID) ?? 0) >= maxContinues) return

        try {
          const res = await client.session.messages({ path: { id: sessionID } } as any)
          const list: any[] = Array.isArray((res as any).data) ? (res as any).data : []

          // Last assistant message in the session.
          let last: any = null
          for (let i = list.length - 1; i >= 0; i--) {
            const m = list[i]?.info ?? list[i]
            if (m?.role === "assistant") {
              last = m
              break
            }
          }
          if (!last) return

          const truncated =
            last.error?.name === "MessageOutputLengthError" || last.finish === "length"
          const nearCap = (last.tokens?.output ?? 0) >= softLimit
          if (!truncated && !nearCap) return

          counts.set(sessionID, (counts.get(sessionID) ?? 0) + 1)

          await client.app.log({
            body: {
              service: "auto-continue",
              level: "info",
              message: `output=${last.tokens?.output ?? "?"} truncated=${truncated} → auto-continue #${counts.get(sessionID)} (${sessionID})`,
            },
          })

          await client.session.promptAsync({
            path: { id: sessionID },
            body: {
              parts: [{ type: "text", text: continueText }],
            },
          } as any)
        } catch {
          // Silent failure: better not to disturb the session.
        }
      },
    }
  }

/** Default export using default options. */
export default autoContinue()
