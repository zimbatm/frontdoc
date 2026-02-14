# frontdoc CLI Workflows

Extrapolated from the spec documents. Each workflow describes a user goal
and the CLI invocations needed to achieve it.

---

## 1. Repository Setup

**Goal**: Initialize a new frontdoc repository.

```
frontdoc init
```

Creates `frontdoc.yaml` at the current directory (or `-C` path) with an empty
aliases section. Prerequisite for all other operations.

**Error case**: If `frontdoc.yaml` already exists, reports "already initialized".

---

## 2. Schema / Collection Management

### 2a. Create a collection

```
frontdoc schema create clients
frontdoc schema create clients --prefix cli --slug "{{name}}-{{short_id}}"
```

Creates `clients/` directory, `clients/_schema.yaml`, and adds alias to
`frontdoc.yaml`. Auto-generates alias and slug if not specified.

### 2b. View all schemas

```
frontdoc schema show
frontdoc schema show -o json
frontdoc schema show -o yaml
```

### 2c. View a single collection's schema

```
frontdoc schema read clients
frontdoc schema read cli
```

Aliases work everywhere a collection name is accepted.

### 2d. Update a collection's schema

```
frontdoc schema update clients --slug "{{name}}-{{short_id}}" --prefix cl
```

### 2e. Rename a collection

```
frontdoc schema rename clients customers
```

Cascade: moves directory, moves all documents, updates `_schema.yaml`
references in other collections, updates template `for` fields, updates
`frontdoc.yaml` alias target.

### 2f. Delete a collection

```
frontdoc schema delete clients
frontdoc schema delete clients --remove-documents
frontdoc schema delete clients --remove-documents --force
```

### 2g. Add a field

```
frontdoc schema field create clients email --type email --required
frontdoc schema field create clients status --type enum --enum-values "active,inactive,archived"
frontdoc schema field create invoices amount --type number --min 0
frontdoc schema field create projects client_id --type reference --target clients
```

The `--target` flag is required when `--type reference` is used. It
specifies the collection that the reference points to.

### 2h. Update a field

```
frontdoc schema field update clients email --required=false
frontdoc schema field update clients status --default active
```

### 2i. Remove a field

```
frontdoc schema field delete clients email
```

---

## 3. Document Creation

### 3a. Create with positional args

```
frontdoc create clients "Acme Corporation"
```

The positional title is mapped to the field referenced in the collection's
slug template. If slug is `{{name}}-{{short_id}}`, this sets `name`.

### 3b. Create with flags

```
frontdoc create -c clients -f name="Acme Corporation" -f email="contact@acme.com" -f status=active
```

### 3c. Create with explicit template

```
frontdoc create clients "Acme Corp" --template "Client Onboarding"
```

### 3d. Create without template (bypass auto-selection)

```
frontdoc create clients "Acme Corp" --no-template
```

### 3e. Create with inline content

```
frontdoc create clients "Acme Corp" --content "# Notes\n\nFirst meeting went well."
```

### 3f. Create with skip validation (bulk import)

```
frontdoc create clients "Acme Corp" --skip-validation
```

### 3g. Output just the file path (scripting)

```
frontdoc create clients "Acme Corp" -o path
```

### 3h. Output as JSON (LLM agents)

```
frontdoc create clients "Acme Corp" -o json
```

### 3i. Interactive creation (no args)

```
frontdoc create
```

Prompts for collection, template, and required fields in weight order.

---

## 4. Reading Documents

### 4a. Read by short ID

```
frontdoc read 9g5fav
```

### 4b. Read by full ULID

```
frontdoc read 01arz3ndektsv4rrffq69g5fav
```

### 4c. Read by collection-scoped ID

```
frontdoc read clients/9g5fav
```

Narrows lookup to the specified collection.

### 4d. Output formats

```
frontdoc read 9g5fav -o markdown
frontdoc read 9g5fav -o json
frontdoc read 9g5fav -o raw
```

---

## 5. Updating Documents

### 5a. Update specific fields

```
frontdoc update 9g5fav -f status=inactive
frontdoc update 9g5fav -f email="new@acme.com" -f status=active
```

If the updated field affects the slug template (e.g. `name`), the file is
automatically renamed to match.

### 5b. Set a field to empty string

```
frontdoc update 9g5fav -f notes=
```

### 5c. Remove a field from metadata

```
frontdoc update 9g5fav --unset notes
```

### 5d. Update content programmatically

```
frontdoc update 9g5fav --content "# New content\n\nReplaces the entire body."
```

### 5e. Update content from stdin

```
echo "# Generated content" | frontdoc update 9g5fav --content -
```

### 5f. Update with skip validation

```
frontdoc update 9g5fav -f custom_field="value" --skip-validation
```

### 5g. Error on no changes

```
frontdoc update 9g5fav
```

Returns error: "no fields or content to update".

---

## 6. Deleting Documents

### 6a. Delete with confirmation prompt

```
frontdoc delete 9g5fav
```

### 6b. Force delete (scripting)

```
frontdoc delete 9g5fav --force
```

---

## 7. Listing Documents

### 7a. List a collection

```
frontdoc list clients
frontdoc list cli
```

### 7b. List all documents

```
frontdoc list
```

### 7c. Simple field filter

```
frontdoc list clients --filter status=active
frontdoc list clients -f status=active -f country=US
```

`--filter` is repeatable. Multiple filters combine with AND logic.

### 7d. Query syntax (same as search)

```
frontdoc list clients "status:active amount>1000"
frontdoc list clients "_created_at>=2024-01-01 _created_at<=2024-12-31"
```

Supports all operators: `:`, `=`, `!=`, `>`, `<`, `>=`, `<=`.

### 7e. Field existence / absence

```
frontdoc list clients --has email
frontdoc list clients --lacks notes
```

### 7f. Combining filters and query

```
frontdoc list clients -f status=active "amount>1000"
```

### 7g. Limit results

```
frontdoc list clients -n 10
```

### 7h. Output formats

```
frontdoc list clients -o table
frontdoc list clients -o json
frontdoc list clients -o csv
```

---

## 8. Searching

### 8a. Full-text search

```
frontdoc search "kubernetes migration"
```

### 8b. Structured query (field-based)

```
frontdoc search "collection:clients status:active"
frontdoc search "collection:clients name:\"Acme Corp\""
```

### 8c. Comparison operators

```
frontdoc search "collection:invoices amount>1000"
frontdoc search "_created_at>=2024-01-01"
```

### 8d. Mixed query (structured + text)

```
frontdoc search "collection:projects kubernetes"
```

### 8e. Output formats

```
frontdoc search "acme" -o detail
frontdoc search "acme" -o table
frontdoc search "acme" -o json
frontdoc search "acme" -o csv
```

### 8f. Limit results

```
frontdoc search "acme" -n 5
```

---

## 9. Opening / Editing Documents

### 9a. Open existing document by ID

```
frontdoc open clients 9g5fav
```

The first argument is always a collection name or alias. The second argument
is a document ID within that collection.

### 9b. Find-or-create via slug template

```
frontdoc open journals 2024-03-22
frontdoc open journals today
```

If `journals` has slug `journal-{{date}}-{{short_id}}`, this opens the existing
`journal-2024-03-22.md` or creates it.
When creation is needed, `open` applies the collection template selection
rules (single template auto-applies, multiple templates prompt, none uses
empty content). The initial content is edited through a temporary draft file
in `journal/` with reserved prefix `.tdo-`, and only persisted to
`journal-YYYY-MM-DD.md` if edited content changed and passes validation.

### 9c. Open with default slug values

```
frontdoc open journals
```

If the `date` field has `default: today` in the schema, the date is filled
automatically. If any template variable has no default and no argument,
the draft is staged with empty values for those fields so they can be filled
in during edit.
If this path creates a document, the selected template content is applied to
the draft baseline before editing.

### 9d. Post-edit behavior

After the editor closes:
1. For existing documents, validation runs on the modified document. If errors
   are found, the user is warned and offered the chance to re-open the editor
   to fix.
2. For new documents opened via slug/default resolution, unchanged draft
   content is discarded and no file is created.
3. If draft content changed and validation fails, the user can:
   re-open the draft, keep the draft file under `.tdo-*`, or discard.
4. If draft content changed and validation passes, the final document is
   created from the draft and the draft is removed.
5. If a slug-relevant field changed, the file is automatically renamed.

### 9e. Web UI (local server)

```
frontdoc web
frontdoc serve
frontdoc web --host 127.0.0.1 --port 8080 --no-open
frontdoc -C /path/to/repo web
frontdoc -C ~/documents serve --collection clients
frontdoc serve --collection clients --collection journal
```

Starts a local HTTP server and serves a Web UI for:
- visualizing collections and documents
- searching/filtering documents
- creating/updating/deleting documents
- running validation checks and viewing issues

Startup behavior:
1. Resolve repository root from current directory or global `-C` path.
2. Bind server to host/port and print the resolved URL.
3. If one or more `--collection` flags are passed, serve only that resolved
   collection set (aliases allowed).
4. Serve the Web UI shell for SPA routes and static bundle assets from
   `/ui/*`.
5. If browser auto-open is enabled, attempt to open the URL best-effort.
   If no browser is available, continue serving without failing.
6. Run until interrupted.

Navigation behavior and UX details:
See `spec/13-web-ui-navigation.md`.

---

## 10. Attaching Files

### 10a. Attach with auto-reference

```
frontdoc attach 9g5fav /path/to/banner.jpg
```

Converts file document to folder document if needed. Appends a markdown
reference link to the content.

### 10b. Attach without reference

```
frontdoc attach 9g5fav /path/to/data.csv --no-reference
```

### 10c. Overwrite existing attachment

```
frontdoc attach 9g5fav /path/to/banner.jpg --force
```

---

## 11. Validation / Health Checks

### 11a. Validate all documents

```
frontdoc check
```

Reports: field types, filename mismatches, broken references, broken wiki
links, stale wiki link titles (for documents in known collections).

### 11b. Validate a single collection

```
frontdoc check clients
```

### 11c. Auto-fix

```
frontdoc check --fix
frontdoc check clients --fix
```

Fixes: filename renames, currency/country casing, stale wiki link titles,
folder collapse when only `index.md` remains.

### 11d. Prune orphaned attachments

```
frontdoc check --fix --prune-attachments
```

### 11e. Verbose

```
frontdoc check --verbose
```

---

## 12. Relationships

### 12a. View a document's relationships

```
frontdoc relationships 9g5fav
frontdoc relationships 9g5fav -o json
```

Shows outgoing (wiki links + field references) and incoming references.

---

## 13. Graph

### 13a. Full repository graph

```
frontdoc graph
frontdoc graph -o dot > graph.dot
frontdoc graph -o mermaid > graph.mmd
frontdoc graph -o json
```

### 13b. Collection-scoped graph

```
frontdoc graph clients
```

### 13c. Focused graph (one hop from a document)

```
frontdoc graph 9g5fav
frontdoc graph 9g5fav -o dot --file relations.dot
```

Wiki link edges and field reference edges use different styles.

---

## 14. Statistics

```
frontdoc stats
frontdoc stats -o json
```

Document counts per collection plus total.

---

## 15. Shell Completion

```
frontdoc completion bash >> ~/.bashrc
frontdoc completion zsh >> ~/.zshrc
frontdoc completion fish > ~/.config/fish/completions/frontdoc.fish
```

---

## 16. Template Management

Templates are documents in the `templates` collection.

### 16a. Create the templates collection

```
frontdoc schema create templates
```

Gets default schema: alias `tpl`, slug `{{name}}-{{short_id}}`, required
fields `name` and `for`.

### 16b. Create a template document (single step)

```
frontdoc create templates "Client Onboarding" -f for=clients --content "# {{name}}\n\nClient: {{client_id}}\n"
```

### 16c. Create and edit a template (two steps)

```
frontdoc create templates "Client Onboarding" -f for=clients
frontdoc open templates <template-id>
```

Add `{{field_name}}` and `{{field | filter}}` placeholders in the markdown
body. Use `\{{` for literal braces.

### 16d. List templates

```
frontdoc list templates
```

---

## 17. Field Type Migration

```
frontdoc schema field update clients status --type enum --enum-values "active,inactive"
frontdoc check
frontdoc check --fix
frontdoc update <id> -f status=active
```

Change the type, check what breaks, auto-fix what is possible, manually fix
the rest.

---

## 18. LLM Agent / Scripting

All commands support `-o json` for machine consumption and non-interactive
flags:

```
frontdoc schema show -o json
frontdoc list clients -o json
frontdoc read <id> -o json
frontdoc create clients -f name="X" -o json
frontdoc search "query" -o json
frontdoc update <id> -f status=done -o json
frontdoc update <id> --content "new body" -o json
frontdoc delete <id> --force -o json
frontdoc stats -o json
```

---

## 19. Working from a Different Directory

```
frontdoc -C /path/to/repo list clients
frontdoc -C ~/documents create clients "Acme Corp"
```

`-C` follows git convention: frontdoc searches upward from that path for
`frontdoc.yaml` to find the repository root.

---

## 20. End-to-End Example

```
frontdoc init

frontdoc schema create clients --slug "{{name}}-{{short_id}}"
frontdoc schema field create clients name --type string --required
frontdoc schema field create clients email --type email
frontdoc schema field create clients status --type enum --enum-values "active,inactive,lead"

frontdoc schema create projects --slug "{{name}}-{{short_id}}"
frontdoc schema field create projects name --type string --required
frontdoc schema field create projects client_id --type reference --target clients

frontdoc create clients "Acme Corp" -f email="hello@acme.com" -f status=active
frontdoc create projects "Website Redesign" -f client_id=9g5fav

frontdoc search "acme"
frontdoc relationships 9g5fav
frontdoc graph clients -o mermaid > deps.mmd
frontdoc check
```
