# tmdoc CLI Workflows

Extrapolated from the spec documents. Each workflow describes a user goal
and the CLI invocations needed to achieve it.

---

## 1. Repository Setup

**Goal**: Initialize a new tmdoc repository.

```
tmdoc init
```

Creates `tmdoc.yaml` at the current directory (or `-C` path) with an empty
aliases section. Prerequisite for all other operations.

**Error case**: If `tmdoc.yaml` already exists, reports "already initialized".

---

## 2. Schema / Collection Management

### 2a. Create a collection

```
tmdoc schema create clients
tmdoc schema create clients --prefix cli --slug "{{short_id}}-{{name}}"
```

Creates `clients/` directory, `clients/_schema.yaml`, and adds alias to
`tmdoc.yaml`. Auto-generates alias and slug if not specified.

### 2b. View all schemas

```
tmdoc schema show
tmdoc schema show -o json
tmdoc schema show -o yaml
```

### 2c. View a single collection's schema

```
tmdoc schema read clients
tmdoc schema read cli
```

Aliases work everywhere a collection name is accepted.

### 2d. Update a collection's schema

```
tmdoc schema update clients --slug "{{short_id}}-{{name}}" --prefix cl
```

### 2e. Rename a collection

```
tmdoc schema rename clients customers
```

Cascade: moves directory, moves all documents, updates `_schema.yaml`
references in other collections, updates template `for` fields, updates
`tmdoc.yaml` alias target.

### 2f. Delete a collection

```
tmdoc schema delete clients
tmdoc schema delete clients --remove-documents
tmdoc schema delete clients --remove-documents --force
```

### 2g. Add a field

```
tmdoc schema field create clients email --type email --required
tmdoc schema field create clients status --type enum --enum-values "active,inactive,archived"
tmdoc schema field create invoices amount --type number --min 0
tmdoc schema field create projects client_id --type reference --target clients
```

The `--target` flag is required when `--type reference` is used. It
specifies the collection that the reference points to.

### 2h. Update a field

```
tmdoc schema field update clients email --required=false
tmdoc schema field update clients status --default active
```

### 2i. Remove a field

```
tmdoc schema field delete clients email
```

---

## 3. Document Creation

### 3a. Create with positional args

```
tmdoc create clients "Acme Corporation"
```

The positional title is mapped to the field referenced in the collection's
slug template. If slug is `{{short_id}}-{{name}}`, this sets `name`.

### 3b. Create with flags

```
tmdoc create -c clients -f name="Acme Corporation" -f email="contact@acme.com" -f status=active
```

### 3c. Create with explicit template

```
tmdoc create clients "Acme Corp" --template "Client Onboarding"
```

### 3d. Create without template (bypass auto-selection)

```
tmdoc create clients "Acme Corp" --no-template
```

### 3e. Create with inline content

```
tmdoc create clients "Acme Corp" --content "# Notes\n\nFirst meeting went well."
```

### 3f. Create with skip validation (bulk import)

```
tmdoc create clients "Acme Corp" --skip-validation
```

### 3g. Output just the file path (scripting)

```
tmdoc create clients "Acme Corp" -o path
```

### 3h. Output as JSON (LLM agents)

```
tmdoc create clients "Acme Corp" -o json
```

### 3i. Interactive creation (no args)

```
tmdoc create
```

Prompts for collection, template, and required fields in weight order.

---

## 4. Reading Documents

### 4a. Read by short ID

```
tmdoc read 9g5fav
```

### 4b. Read by full ULID

```
tmdoc read 01arz3ndektsv4rrffq69g5fav
```

### 4c. Read by collection-scoped ID

```
tmdoc read clients/9g5fav
```

Narrows lookup to the specified collection.

### 4d. Output formats

```
tmdoc read 9g5fav -o markdown
tmdoc read 9g5fav -o json
tmdoc read 9g5fav -o raw
```

---

## 5. Updating Documents

### 5a. Update specific fields

```
tmdoc update 9g5fav -f status=inactive
tmdoc update 9g5fav -f email="new@acme.com" -f status=active
```

If the updated field affects the slug template (e.g. `name`), the file is
automatically renamed to match.

### 5b. Set a field to empty string

```
tmdoc update 9g5fav -f notes=
```

### 5c. Remove a field from metadata

```
tmdoc update 9g5fav --unset notes
```

### 5d. Update content programmatically

```
tmdoc update 9g5fav --content "# New content\n\nReplaces the entire body."
```

### 5e. Update content from stdin

```
echo "# Generated content" | tmdoc update 9g5fav --content -
```

### 5f. Update with skip validation

```
tmdoc update 9g5fav -f custom_field="value" --skip-validation
```

### 5g. Error on no changes

```
tmdoc update 9g5fav
```

Returns error: "no fields or content to update".

---

## 6. Deleting Documents

### 6a. Delete with confirmation prompt

```
tmdoc delete 9g5fav
```

### 6b. Force delete (scripting)

```
tmdoc delete 9g5fav --force
```

---

## 7. Listing Documents

### 7a. List a collection

```
tmdoc list clients
tmdoc list cli
```

### 7b. List all documents

```
tmdoc list
```

### 7c. Simple field filter

```
tmdoc list clients --filter status=active
tmdoc list clients -f status=active -f country=US
```

`--filter` is repeatable. Multiple filters combine with AND logic.

### 7d. Query syntax (same as search)

```
tmdoc list clients "status:active amount>1000"
tmdoc list clients "_created_at>=2024-01-01 _created_at<=2024-12-31"
```

Supports all operators: `:`, `=`, `!=`, `>`, `<`, `>=`, `<=`.

### 7e. Field existence / absence

```
tmdoc list clients --has email
tmdoc list clients --lacks notes
```

### 7f. Combining filters and query

```
tmdoc list clients -f status=active "amount>1000"
```

### 7g. Limit results

```
tmdoc list clients -n 10
```

### 7h. Output formats

```
tmdoc list clients -o table
tmdoc list clients -o json
tmdoc list clients -o csv
```

---

## 8. Searching

### 8a. Full-text search

```
tmdoc search "kubernetes migration"
```

### 8b. Structured query (field-based)

```
tmdoc search "collection:clients status:active"
tmdoc search "collection:clients name:\"Acme Corp\""
```

### 8c. Comparison operators

```
tmdoc search "collection:invoices amount>1000"
tmdoc search "_created_at>=2024-01-01"
```

### 8d. Mixed query (structured + text)

```
tmdoc search "collection:projects kubernetes"
```

### 8e. Output formats

```
tmdoc search "acme" -o detail
tmdoc search "acme" -o table
tmdoc search "acme" -o json
tmdoc search "acme" -o csv
```

### 8f. Limit results

```
tmdoc search "acme" -n 5
```

---

## 9. Opening / Editing Documents

### 9a. Open existing document by ID

```
tmdoc open clients 9g5fav
```

The first argument is always a collection name or alias. The second argument
is a document ID within that collection.

### 9b. Find-or-create via slug template

```
tmdoc open journals 2024-03-22
tmdoc open journals today
```

If `journals` has slug `journal-{{date}}`, this opens the existing
`journal-2024-03-22.md` or creates it.

### 9c. Open with default slug values

```
tmdoc open journals
```

If the `date` field has `default: today` in the schema, the date is filled
automatically. If any template variable has no default and no argument,
returns an error.

### 9d. Post-edit behavior

After the editor closes:
1. Validation runs on the modified document. If errors are found, the user
   is warned and offered the chance to re-open the editor to fix.
2. If a slug-relevant field changed, the file is automatically renamed.

---

## 10. Attaching Files

### 10a. Attach with auto-reference

```
tmdoc attach 9g5fav /path/to/banner.jpg
```

Converts file document to folder document if needed. Appends a markdown
reference link to the content.

### 10b. Attach without reference

```
tmdoc attach 9g5fav /path/to/data.csv --no-reference
```

### 10c. Overwrite existing attachment

```
tmdoc attach 9g5fav /path/to/banner.jpg --force
```

---

## 11. Validation / Health Checks

### 11a. Validate all documents

```
tmdoc check
```

Reports: collection membership, field types, filename mismatches, broken
references, broken wiki links, stale wiki link titles.

### 11b. Validate a single collection

```
tmdoc check clients
```

### 11c. Auto-fix

```
tmdoc check --fix
tmdoc check clients --fix
```

Fixes: filename renames, currency/country casing, stale wiki link titles,
folder collapse when only `index.md` remains.

### 11d. Prune orphaned attachments

```
tmdoc check --fix --prune-attachments
```

### 11e. Verbose

```
tmdoc check --verbose
```

---

## 12. Relationships

### 12a. View a document's relationships

```
tmdoc relationships 9g5fav
tmdoc relationships 9g5fav -o json
```

Shows outgoing (wiki links + field references) and incoming references.

---

## 13. Graph

### 13a. Full repository graph

```
tmdoc graph
tmdoc graph -o dot > graph.dot
tmdoc graph -o mermaid > graph.mmd
tmdoc graph -o json
```

### 13b. Collection-scoped graph

```
tmdoc graph clients
```

### 13c. Focused graph (one hop from a document)

```
tmdoc graph 9g5fav
tmdoc graph 9g5fav -o dot --file relations.dot
```

Wiki link edges and field reference edges use different styles.

---

## 14. Statistics

```
tmdoc stats
tmdoc stats -o json
```

Document counts per collection plus total.

---

## 15. Shell Completion

```
tmdoc completion bash >> ~/.bashrc
tmdoc completion zsh >> ~/.zshrc
tmdoc completion fish > ~/.config/fish/completions/tmdoc.fish
```

---

## 16. Template Management

Templates are documents in the `templates` collection.

### 16a. Create the templates collection

```
tmdoc schema create templates
```

Gets default schema: alias `tpl`, slug `{{short_id}}-{{name}}`, required
fields `name` and `for`.

### 16b. Create a template document (single step)

```
tmdoc create templates "Client Onboarding" -f for=clients --content "# {{name}}\n\nClient: {{client_id}}\n"
```

### 16c. Create and edit a template (two steps)

```
tmdoc create templates "Client Onboarding" -f for=clients
tmdoc open templates <template-id>
```

Add `{{field_name}}` and `{{field | filter}}` placeholders in the markdown
body. Use `\{{` for literal braces.

### 16d. List templates

```
tmdoc list templates
```

---

## 17. Field Type Migration

```
tmdoc schema field update clients status --type enum --enum-values "active,inactive"
tmdoc check
tmdoc check --fix
tmdoc update <id> -f status=active
```

Change the type, check what breaks, auto-fix what is possible, manually fix
the rest.

---

## 18. LLM Agent / Scripting

All commands support `-o json` for machine consumption and non-interactive
flags:

```
tmdoc schema show -o json
tmdoc list clients -o json
tmdoc read <id> -o json
tmdoc create clients -f name="X" -o json
tmdoc search "query" -o json
tmdoc update <id> -f status=done -o json
tmdoc update <id> --content "new body" -o json
tmdoc delete <id> --force -o json
tmdoc stats -o json
```

---

## 19. Working from a Different Directory

```
tmdoc -C /path/to/repo list clients
tmdoc -C ~/documents create clients "Acme Corp"
```

`-C` follows git convention: tmdoc searches upward from that path for
`tmdoc.yaml` to find the repository root.

---

## 20. End-to-End Example

```
tmdoc init

tmdoc schema create clients --slug "{{short_id}}-{{name}}"
tmdoc schema field create clients name --type string --required
tmdoc schema field create clients email --type email
tmdoc schema field create clients status --type enum --enum-values "active,inactive,lead"

tmdoc schema create projects --slug "{{short_id}}-{{name}}"
tmdoc schema field create projects name --type string --required
tmdoc schema field create projects client_id --type reference --target clients

tmdoc create clients "Acme Corp" -f email="hello@acme.com" -f status=active
tmdoc create projects "Website Redesign" -f client_id=9g5fav

tmdoc search "acme"
tmdoc relationships 9g5fav
tmdoc graph clients -o mermaid > deps.mmd
tmdoc check
```
