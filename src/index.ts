/**
 * opencode-plugins — plugin OpenCode modular.
 *
 * Entry point que registra todas as features (thinking-guard, truncation)
 * com configuração centralizada.
 *
 * Uso no `.opencode/plugins/`:
 * ```ts
 * export { default } from "../../opencode-plugins/src/index.ts"
 * ```
 */

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { config } from "./config"
import { createThinkingGuardPlugin } from "./features/thinking-guard"
import { createTruncationPlugin } from "./features/truncation"

/**
 * Plugin completo com todas as features ativas.
 *
 * Combina thinking-guard e truncation num único plugin.
 */
export default async function opencodePlugins(
  input: PluginInput,
): Promise<Hooks> {
  // Cria hooks de cada feature.
  const guardHooks = await createThinkingGuardPlugin(config.thinking)(input)
  const truncHooks = await createTruncationPlugin(config.truncation)(input)

  // Combina os hooks — ambos têm `event`.
  return {
    async event(input) {
      // Executa os dois hooks em sequência.
      if (guardHooks.event) await guardHooks.event(input)
      if (truncHooks.event) await truncHooks.event(input)
    },
    async dispose() {
      if (guardHooks.dispose) await guardHooks.dispose()
      if (truncHooks.dispose) await truncHooks.dispose()
    },
  }
}

// Re-exports para uso individual.
export { createThinkingGuardPlugin, createTruncationPlugin }
export { config } from "./config"
export type {
  PluginsConfig,
  ThinkingConfig,
  TruncationConfig,
  GlobalConfig,
} from "./config"
