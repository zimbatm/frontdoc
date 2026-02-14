# Repository Guidelines

## Project Structure & Module Organization
Core implementation lives in `src/`, organized by concern: `config/`, `document/`, `services/`, `repository/`, `storage/`, and CLI entrypoints in `src/main.ts` and `src/cli/`.  
Tests live in `tests/` and generally mirror source layout (for example `src/services/*` -> `tests/services/*`).  
Design and behavior specs are in `spec/` (numbered docs), and runnable examples are in `examples/`.

## Build, Test, and Development Commands
- `nix develop`: enter the pinned development shell (preferred).
- In the dev shell, use the `frontdoc` wrapper (for example `frontdoc --help`, `frontdoc create ...`) instead of calling `bun run src/main.ts` directly.
- `bun run dev` or `bun run src/main.ts --help`: run the CLI in development.
- `bun run test`: run the full Bun test suite.
- `bun test tests/cli/workflows.test.ts`: run a focused workflow test.
- `bun run lint`: run Biome lint checks.
- `bun run format`: format code with Biome.
- `bun run build`: compile a standalone binary to `dist/frontdoc`.

## Coding Style & Naming Conventions
TypeScript with ESM imports (`.js` extension in import paths).  
Formatting is enforced by Biome (`biome.json`): tabs, max line width 100, double quotes, semicolons enabled.  
Use descriptive, domain-based file names in kebab-case (for example `template-service.ts`, `root-discovery.ts`).  
Keep module boundaries clear: parsing in `document/`, orchestration in `services/`, persistence in `repository/` + `storage/`.

## Testing Guidelines
Framework: Bun test (`import { describe, test, expect } from "bun:test"`).  
Test files use `*.test.ts` naming and should sit in the mirrored folder under `tests/`.  
Prefer real implementations over mocks; use `MemoryVFS` as the default test backend for repository/service behavior.  
Cover both unit behavior and end-to-end CLI workflows when changing command semantics.

## Commit & Pull Request Guidelines
Follow the existing commit style: short imperative subject, often scoped, such as `spec: ...`, `core: ...`, `cli: ...`, `tests: ...`, `nix: ...`.  
Keep commits focused and logically atomic.  
For PRs, include:
- what changed and why,
- impacted commands/spec sections,
- test evidence (`bun run test`, targeted test paths),
- sample CLI output when user-visible behavior changes.

## Agent Workflow Rule
Before making changes to the codebase, check the relevant files in `spec/` first.  
If implementation and spec diverge, update the spec first, then update code to match it.  
If there is uncertainty, follow the spec.

## Development Process (BDD/TDD)
Default to BDD/TDD for all non-trivial changes:
- start from behavior in spec and encode it as tests first,
- write or update failing tests that describe expected behavior,
- implement the smallest code change to make tests pass,
- refactor while keeping tests green.
Use clear scenario-oriented test names (Given/When/Then style where practical).

## Commit Discipline
Commit changes as you go, in small atomic commits.  
Each commit should represent one logical change and include only related files.
