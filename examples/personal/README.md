# Example Personal Collection

This folder is a starter `tmdoc` repository for personal knowledge management.

Run commands against it with `-C`:

```bash
bun run src/main.ts -C examples/personal list -o table
bun run src/main.ts -C examples/personal search "weekly review"
bun run src/main.ts -C examples/personal check --verbose
```

Included collections:

- `journal`: daily notes
- `tasks`: actionable items
- `areas`: long-lived life/work areas
- `contacts`: people
- `skills`: Claude Code skills (folder documents with `SKILL.md` entry files)
- `templates`: reusable note templates

## Claude Code Integration

The `skills/` collection uses `index_file: SKILL.md` so each skill is a
folder document matching Claude Code's plugin skill layout. To make skills
visible to Claude Code, create a symlink:

```bash
ln -s skills .claude/skills
```

This keeps the skills managed by frontdoc while Claude Code discovers them
at its expected `.claude/skills/` path.
