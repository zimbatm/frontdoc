# frontdoc

`frontdoc` manages structured document collections as plain files:

- Markdown content
- YAML frontmatter metadata
- Per-collection schemas (`_schema.yaml`)
- Repository config (`frontdoc.yaml`)

The goal is to keep knowledge in git-friendly, human-readable files while still
getting schema validation, references, search, templates, and automation-ready JSON output.

## Why This Exists

`frontdoc` is built for teams (and agents) that want:

- no database lock-in
- predictable filenames and IDs
- strongly validated metadata
- easy scripting and LLM integration

Everything stays in the repository as text files, so any editor and normal git
workflows still work.

## Quickstart

```bash
# Enter the pinned development shell
nix develop

# Use the CLI wrapper inside the dev shell
frontdoc --help

# Initialize a repository
frontdoc init

# Create a collection and fields
frontdoc schema create clients --prefix cli --slug "{{name}}-{{short_id}}"
frontdoc schema field create clients name --type string --required
frontdoc schema field create clients email --type email

# Create and list documents
frontdoc create cli "Acme Corp"
frontdoc list cli -o table

# Validate and search
frontdoc check --verbose
frontdoc search "acme"
```

If you are not using the dev shell, run commands via `bun run src/main.ts ...`.

## Web UI

```bash
frontdoc web
# or
frontdoc serve
```

This starts a local server with:

- document browsing and editing
- collection-scoped navigation
- search and validation views
- JSON API endpoints under `/api/*`

## What Is Special

- Plain-text first: the filesystem is the source of truth.
- Filename friction is removed: IDs and slug-based paths are generated consistently.
- Draft-first open/create flow: new documents can be staged as `.tdo-*` drafts before persistence.
- Strong integrity checks: schema types, references, wiki links, and filename-policy validation.
- Attachment-aware documents: file docs can become folder docs (`index.md` + attachments), and collapse back when clean.
- Automation-ready interface: commands support machine-readable output (`-o json`).

## Common Commands

```bash
frontdoc init
frontdoc create|read|update|delete ...
frontdoc open ...
frontdoc list ...
frontdoc search ...
frontdoc attach ...
frontdoc check [collection] [--fix] [--prune-attachments] [--verbose]
frontdoc schema ...
frontdoc relationships ...
frontdoc graph ...
frontdoc stats
frontdoc web
```

## Development

```bash
# Lint
bun run lint

# Full tests
bun run test

# Focused workflow tests
bun test tests/cli/workflows.test.ts
```

## Example Repositories

See `examples/`:

- `examples/personal`
- `examples/consulting`

Run against an example with `-C`:

```bash
frontdoc -C examples/personal list -o table
```
