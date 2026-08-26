# Changelog

All notable changes to this project will be documented in this file.

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
