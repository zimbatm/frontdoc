# Consulting Example Repository

This sample models a small consulting practice with linked clients, projects,
and invoices.

Type examples included:
- `clients.website` uses `url`
- `clients.active` uses `boolean`
- `projects.reviewer_ids` uses `array<reference>` (to `clients`)
- `projects.stack` uses `array<string>`

```bash
bun run src/main.ts -C examples/consulting list -o table
bun run src/main.ts -C examples/consulting check --verbose
bun run src/main.ts -C examples/consulting search "acme"
```
