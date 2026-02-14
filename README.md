# frontdoc-ts

TypeScript/Bun implementation of `frontdoc`, a CLI for managing Markdown documents with YAML frontmatter, collection schemas, references, templates, and validation.

## Requirements

- `nix` (recommended)
- or `bun` directly

## Quickstart

```bash
# Enter dev shell (Bun + Node.js + tooling)
nix develop

# Initialize repo
bun run src/main.ts init

# Create a collection schema
bun run src/main.ts schema create clients --prefix cli --slug '{{short_id}}-{{name}}'
bun run src/main.ts schema field create clients name --required

# Create and list documents
bun run src/main.ts create cli "Acme Corp"
bun run src/main.ts list cli -o table
```

## Common Commands

```bash
bun run src/main.ts --help
bun run src/main.ts create|read|update|delete ...
bun run src/main.ts open ...
bun run src/main.ts attach ...
bun run src/main.ts check [collection] [--fix] [--prune-attachments] [--verbose]
bun run src/main.ts search ...
bun run src/main.ts relationships ...
bun run src/main.ts graph ...
bun run src/main.ts stats
bun run src/main.ts schema ...
```

## Development

```bash
# Lint/format checks
nix develop -c bun run lint

# Full test suite
nix develop -c bun test

# CLI workflow tests only
nix develop -c bun test tests/cli/workflows.test.ts
```

## Notes

- Repository root is discovered by locating `frontdoc.yaml` upward from `cwd` (or `-C`).
- Collection schemas are stored at `<collection>/_schema.yaml`.
- Aliases and ignore patterns are stored in `frontdoc.yaml`.
