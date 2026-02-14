# tmdoc Specification: CLI Interface

## Global Flags

| Flag            | Short | Description                                    |
|-----------------|-------|------------------------------------------------|
| `--directory`   | `-C`  | Run as if started in this path                 |

The `-C` flag follows git convention: tmdoc runs as if started in the given
path. The repository root is discovered by searching upward from that path
for `tmdoc.yaml`, the same way it searches upward from the current working
directory. The process working directory is not changed.

## Document Identifiers

All commands that accept a document identifier use the `<id>` format:

- **Short ID**: `9g5fav` -- last N characters of the ULID
- **Full ULID**: `01arz3ndektsv4rrffq69g5fav`
- **Collection-scoped ID**: `clients/9g5fav` -- collection prefix narrows
  the search

There is no implicit search fallback. If the ID does not match a document,
the command returns an error. Use `tmdoc search` to find documents by name
or content, then use the ID from the results.

## Manager Initialization

Before any subcommand runs, the manager is created:

1. Use `New(workDir)` where workDir is the resolved `-C` path or the current
   directory.
2. The manager discovers the repository root (see Root Discovery in
   03-configuration.md), loads `tmdoc.yaml` for aliases, and scans for
   `_schema.yaml` files to identify collections.
3. Creates VFS and initializes all services.

## Output Format Baseline

Every command that produces output supports at least `-o json` for machine
consumption. Commands may support additional formats relevant to their use
case. The full set of available formats:

| Format   | Description                                  |
|----------|----------------------------------------------|
| table    | Human-readable aligned columns               |
| detail   | Verbose with context (search results)        |
| json     | Machine-readable JSON                        |
| csv      | Comma-separated values                       |
| raw      | Original YAML+Markdown content               |
| markdown | Formatted display with metadata              |
| text     | Plain text (schema)                          |
| yaml     | YAML format (schema, excludes defaults)      |
| dot      | Graphviz DOT format (graphs)                 |
| mermaid  | Mermaid diagram format (graphs)              |
| path     | Just the file path (create)                  |

## Commands

### init

**Usage**: `tmdoc init`

Initialize a tmdoc repository in the current directory (or `-C` path).

**Behavior**:
1. If `tmdoc.yaml` already exists, report "already initialized".
2. Write `tmdoc.yaml` with an empty aliases section.

### create (alias: new)

**Usage**: `tmdoc create [collection] [title] [flags]`

Create a new document.

**Flags**:
- `--collection` / `-c` -- collection name
- `--field` / `-f` -- field values as `key=value` (repeatable)
- `--template` -- template name to use
- `--no-template` -- skip template selection entirely (create with empty or
  user-provided content)
- `--content` -- initial content
- `--skip-validation` -- bypass validation
- `--output` / `-o` -- output format (json, path, default)

**Positional title**: The second positional argument is the document title.
It is mapped to the field referenced in the collection's slug template. For
example, if the slug is `{{short_id}}-{{name}}`, the positional title sets
the `name` field. If the slug template does not reference a field (e.g.
`{{short_id}}` only), the positional title is ignored.

**Behavior**:
1. Resolve collection from positional arg, `--collection` flag, or
   interactive prompt.
2. Resolve collection aliases (prefix -> collection name).
3. Gather fields from `--field` flags and positional title.
   Fields beginning with `_` are reserved and rejected.
4. Find templates for the collection. If `--no-template` specified, skip
   template selection. If `--template` specified, use it. Otherwise:
   - One template: use automatically.
   - Multiple: prompt user to choose.
   - None: no template.
5. Create the document via DocumentService.
6. Output the result (path, JSON, or formatted summary).

### read (alias: get)

**Usage**: `tmdoc read <id>`

Retrieve and display a document.

**Flags**:
- `--output` / `-o` -- format: markdown (default), json, raw

**Behavior**:
1. Find the document by ID (short, full, or collection-scoped).
2. If not found, return an error.
3. Display in the requested format.

### update (alias: modify)

**Usage**: `tmdoc update <id> [flags]`

Update document fields and/or content programmatically.

**Flags**:
- `--field` / `-f` -- field values as `key=value` (repeatable)
- `--unset` -- remove a field from metadata (repeatable)
- `--content` -- replace the document's markdown body. Use `--content -` to
  read from stdin.
- `--skip-validation` -- bypass validation
- `--output` / `-o` -- output format (json, default)

**Behavior**:
1. Find the document by ID.
2. If no `--field`, `--unset`, or `--content` flags are provided, return an
   error: "no fields or content to update".
3. Parse field flags. Fields set via `-f key=value` update or add the field.
   Fields set via `-f key=` set the field to an empty string. Fields named
   in `--unset` are removed from metadata. Fields beginning with `_` are
   reserved and cannot be set or unset.
4. If `--content` is provided, replace the document content. If the value is
   `-`, read content from stdin.
5. Update via DocumentService.
6. After saving, if a slug-relevant field changed, automatically rename the
   file to match the new expected filename (see Auto-Rename in
   05-document-operations.md).

### delete (alias: rm)

**Usage**: `tmdoc delete <id>`

Delete a document.

**Flags**:
- `--force` -- skip confirmation prompt
- `--output` / `-o` -- output format (json, default)

**Behavior**:
1. Find the document by ID.
2. Unless `--force`, prompt for confirmation.
3. Delete via DocumentService.

### list (alias: ls)

**Usage**: `tmdoc list [collection] [query] [flags]`

List documents.

**Flags**:
- `--output` / `-o` -- format: table (default), json, csv
- `--filter` / `-f` -- field filter as `key=value` (repeatable)
- `--has` -- field existence filter (repeatable)
- `--lacks` -- field absence filter (repeatable)
- `--limit` / `-n` -- stop after collecting N results

**Query syntax**: An optional positional query string after the collection
name uses the same syntax as `search` (see 06-search.md). Field expressions
(e.g. `status:active`, `amount>1000`, `_created_at>=2024-01-01`) and text
expressions are supported. The `--filter` flag is a convenience shorthand
for simple `key=value` equality; both can be combined.

**Behavior**:
1. Build filters from collection, query, --filter, --has, --lacks.
2. Collect documents via Repository.
3. Sort results alphabetically by path.
4. Format and display.

### search (alias: find)

**Usage**: `tmdoc search <query>`

Search documents.

**Flags**:
- `--output` / `-o` -- format: detail (default), table, json, csv
- `--limit` / `-n` -- stop after collecting N results

**Behavior**:
1. Run UnifiedSearch with the query.
2. Format and display results with scores.

### open (alias: edit)

**Usage**: `tmdoc open <collection|alias> [<id|arg>]`

Open a document in `$EDITOR`. The first argument is always a collection name
or alias. The optional second argument identifies an existing document or
provides a slug template argument for find-or-create.

**Behavior**:
1. Resolve the collection from the first positional argument (including
   alias resolution).
2. If a second argument is provided:
   a. Try to find an existing document by ID (short or full) within the
      collection.
   b. If not found by ID, use UpsertBySlug: map the argument to the first
      slug template variable and find-or-create the document. If creation is
      needed, resolve template content (single template auto, multiple prompt,
      none empty) and apply it.
3. If no second argument is provided:
   a. For each unfilled slug template variable, check if the corresponding
      field has a `default` value in the schema. If so, use it (processing
      through date parsing etc., so `default: today` becomes the current
      date).
   b. If any template variable has no default and no argument, return an
      error: "missing argument for template variable `{{field}}`".
   c. Use UpsertBySlug with the resolved values. If creation is needed,
      resolve template content (single template auto, multiple prompt, none
      empty) and apply it.
4. Open the document's content path in `$EDITOR` (falls back to `vi`).
5. After the editor closes, run validation on the modified document. If
   validation errors are found, warn the user and offer to re-open the
   editor to fix the issues.
6. If a slug-relevant field changed, automatically rename the file to match
   the new expected filename.

### attach

**Usage**: `tmdoc attach <id> <file-path>`

Attach a file to a document.

**Flags**:
- `--force` -- overwrite existing attachment
- `--no-reference` -- don't add markdown link
- `--output` / `-o` -- output format (json, default)

**Behavior**:
1. Find the document by ID.
2. Call AttachFile on DocumentService.

### check

**Usage**: `tmdoc check [collection] [flags]`

Validate documents. If a collection name is provided, only documents in that
collection are validated. Otherwise, all documents are validated.

**Flags**:
- `--fix` -- automatically fix fixable issues
- `--prune-attachments` -- remove unreferenced attachments from folder
  documents (implies `--fix`)
- `--verbose` -- show detailed output
- `--output` / `-o` -- output format (text (default), json)

**Behavior**:
1. Collect documents (all, or filtered by collection).
2. For each document, run:
   a. Collection membership validation (document in a directory with
      `_schema.yaml`).
   b. Field validation (required fields, type constraints).
   c. Filename validation (pattern matching).
   d. Directory validation (document in correct collection folder).
   e. Reference validation (metadata references resolve to existing documents
      in the correct collection).
   f. Template `for` field validation (value resolved through alias
      resolution, must match a known collection).
   g. Wiki link validation (broken links).
3. Report issues with severity (error, warning).
4. If `--fix`, apply automatic repairs in order:
   a. Rename files to match expected filename pattern.
   b. Fix currency/country field casing (e.g. `usd` -> `USD`).
   c. Update stale wiki link display titles.
   d. Remove unreferenced attachments from folder documents (only when
      `--prune-attachments` is passed).
   e. Collapse folder documents back to files when only `index.md` remains
      (files in the `ignore` list from `tmdoc.yaml` are silently removed;
      other files block collapse).

### schema

**Usage**: `tmdoc schema <subcommand>`

Manage the schema.

**Subcommands**:
- `schema show` -- aggregate all `_schema.yaml` files and `tmdoc.yaml`
  aliases into a unified view.
  - `--output`: text (default), json, yaml
- `schema create <collection>` -- create directory, write `_schema.yaml`,
  add alias to `tmdoc.yaml`.
  - `--prefix` (maps to Alias), `--slug` (maps to Slug)
- `schema read <collection>` -- read `<collection>/_schema.yaml` and show
  the alias from `tmdoc.yaml`.
  - `--output`: text (default), json, yaml
- `schema update <collection>` -- modify `<collection>/_schema.yaml` and
  optionally update the alias in `tmdoc.yaml`.
- `schema rename <old-name> <new-name>` -- rename cascade: move directory,
  update `_schema.yaml` files with references, update templates, update
  alias target in `tmdoc.yaml` (see 08-schema-management.md).
- `schema delete <collection>` -- remove documents, `_schema.yaml`,
  directory, and alias from `tmdoc.yaml`.
  - `--remove-documents`, `--force`
- `schema field create <collection> <field>` -- add a field to
  `<collection>/_schema.yaml`.
  - `--type` (field type), `--required`, `--default`, `--enum-values`,
    `--min`, `--max`, `--weight`, `--target` (required when type is
    `reference`: specifies the target collection for the reference)
- `schema field update <collection> <field>` -- update a field in
  `<collection>/_schema.yaml`.
- `schema field delete <collection> <field>` -- remove a field from
  `<collection>/_schema.yaml`.

### relationships

**Usage**: `tmdoc relationships <id>`

Show document relationships.

**Outgoing relationships**: Both wiki links in the document's content and
field references (e.g. `client_id`) from the document's metadata are shown.

**Incoming relationships**: Other documents that reference the target are
found using a match hierarchy: exact full ID, then short ID prefix, then
collection/name match, then plain name match.

**Flags**:
- `--output` / `-o` -- format: text (default), json

### graph

**Usage**: `tmdoc graph [collection|id]`

Generate a relationship graph. Edges are derived from both wiki links and
field references (e.g. `client_id`). Wiki link edges and field reference
edges use different styles (e.g. solid vs dashed lines in DOT/Mermaid
output) to distinguish the relationship type.

The positional argument is optional. If it matches a collection name or
alias, the graph is scoped to that collection. If it matches a document ID,
the graph is focused to one hop from that document. If omitted, a full
repository graph is generated.

**Flags**:
- `--output` / `-o` -- format: dot (default), mermaid, json
- `--file` -- write to file instead of stdout

### stats

**Usage**: `tmdoc stats`

Show repository statistics: document counts grouped by collection and total
count. No other statistics are computed.

**Flags**:
- `--output` / `-o` -- format: text (default), json

### completion

**Usage**: `tmdoc completion <shell>`

Generate shell completion scripts for bash, zsh, fish, or powershell.

## Interactive Mode

When required information is not provided via flags:

1. Prompt for collection selection (if not specified).
2. Prompt for template selection (if multiple available).
3. Prompt for required field values in weight order.
4. Prompt for confirmation on destructive operations (delete).

Interactive prompts use a survey/prompt library. Non-interactive use (scripts,
LLM agents) should provide all values via flags.
