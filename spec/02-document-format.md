# frontdoc Specification: Document Format

## File Structure

Every document is a single file (or folder; see below) consisting of two
sections:

1. **YAML frontmatter** enclosed between `---` delimiters
2. **Markdown content** (GitHub Flavored Markdown)

```
---
_id: "01arz3ndektsv4rrffq69g5fav"
_created_at: "2024-03-15T10:30:00Z"
name: Acme Corporation
status: active
---

# Acme Corporation

Free-form markdown content here...
```

### Parsing Rules

- Frontmatter starts with `---\n` at the very beginning of the file.
- It ends at the next `\n---\n`.
- Everything between is parsed as YAML into a string-keyed map.
- Everything after the closing `---\n` is the markdown content body.
- If the file does not start with `---\n`, the entire file is treated as
  content with an empty metadata map.
- An unclosed `---` (opening delimiter with no closing one) is a parse error.

### Standard Fields

Every document automatically receives these fields on creation:

| Field        | Type   | Description                        |
|--------------|--------|------------------------------------|
| `_id`         | string | ULID (Universally Unique Lexicographically Sortable Identifier) |
| `_created_at` | string | RFC 3339 timestamp of creation |
| `_title`      | string | Virtual title extracted from markdown content |

Additional fields are defined per collection in `_schema.yaml`.

The `_title` field is virtual and is never written to frontmatter. It is
derived from content by:

1. Stripping leading whitespace from content (`\n`, `\r`, spaces, tabs, etc).
2. Taking the first non-empty line.
3. If that line is an ATX heading (`#` through `######`), using its text
   (with surrounding whitespace stripped) as `_title`.
4. Otherwise, `_title` is empty.

Any frontmatter key beginning with `_` is reserved for system fields. User
schemas (`fields` and `references`) MUST NOT declare keys with `_` prefix.

A document's collection membership is determined by its location in the
filesystem: the top-level folder containing the document is its collection.
For example, a document at `clients/acme-corp-9g5fav.md` belongs to the
`clients` collection. There is no `type` field in metadata -- the collection
is always derived from the path.

**Datetime representation**: All datetime values (including `_created_at`)
are stored and handled as RFC 3339 strings. YAML values must be quoted
(e.g. `_created_at: "2024-03-15T10:30:00Z"`) to prevent YAML parsers from
auto-converting them to native datetime objects. The parser must be
configured to disable automatic datetime conversion if the YAML library
does not respect quoting.

### Serialization Order

When writing frontmatter back to disk, fields are ordered:

1. `_id` -- always first
2. `_created_at` -- always second
3. All remaining fields -- alphabetically

This ensures deterministic output suitable for version control diffs.

A single blank line separates the closing `---` from the markdown content.

## Filename Conventions

Every collection has a `slug` template that determines filenames. The
template uses `{{variable_name}}` syntax:

- `{{short_id}}` -- short ID derived from the document's ULID
- `{{date}}` -- value of the `date` field, or today's date as fallback
- `{{field_name}}` -- value of any metadata field (or virtual `_title`),
  slugified

Templates support the same `{{field}}` and `{{field | filter}}` syntax as
content templates (see 09-template-system.md for the full processing rules
and available filters). Placeholder values are slugified before
interpolation. Slugification removes/replaces `/` in values, so placeholder
values never create path separators.

Examples:

| Slug template | Produced filename |
|---|---|
| `{{name}}` | `acme-corp-9g5fav.md` |
| `journal-{{date}}` | `journal-2024-03-22-9g5fav.md` |
| `{{short_id}}` | `9g5fav.md` |
| `{{date | year}}/{{name}}` | `2024/acme-corp-9g5fav.md` (see Subdirectory Slugs) |

Slugification: field values are lowercased, `/` is replaced, non-alphanumerics
are replaced with hyphens, consecutive hyphens are collapsed, trailing hyphens
are trimmed. The `.md` extension is appended if not already present.
Generated document basenames MUST NOT start with `.`.
If slug processing would produce a dot-prefixed basename (for example `.md`),
the operation must fail with a filename error.

### Subdirectory Slugs

Slug templates may contain `/` to place documents in subdirectories within
the collection folder. Only `/` that appears literally in the slug template
creates subdirectories. For example, `{{date | year}}/{{name}}`
produces `clients/2024/acme-corp-9g5fav.md`. The subdirectory is created
automatically. The document still belongs to the `clients` collection
(collection membership is determined by the top-level folder).

## File Documents vs. Folder Documents

### File Documents (default)

A document is a single `.md` file:

```
clients/
  acme-corp-9g5fav.md
```

### Folder Documents

When a file has attachments, it becomes a folder document:

```
blog/
  xyz789-my-post/
    index.md          -- the document content
    banner.jpg        -- attachment
    data.csv          -- attachment
```

Detection rule: a path is a folder document if it is a directory AND contains
an `index.md` file.

When parsing a folder document, the metadata and content are read from
`index.md`, but the document's logical path is the folder itself (not
`index.md`).

### Conversion Between File and Folder

- **File to folder**: happens automatically on first `attach`. The `.md` file
  is moved into a new directory (named after the file without `.md`) as
  `index.md`, then the attachment is placed alongside it.
- **Folder to file**: can be triggered by `check --fix` when only `index.md`
  remains (no attachments or extra files). The `index.md` is moved back out as
  a standalone `.md` file and the empty directory is removed.

### Attachment Reference Detection

References are extracted from three patterns in the document content:

1. **Inline links/images**: `!?\[[^\]]*\]\(([^)]+)\)` -- matches
   `[text](target)` and `![alt](target)`.
2. **Reference-style links**: `[ref]: url` definitions -- the URL portion
   is extracted.
3. **HTML image tags**: `<img\s[^>]*src="([^"]+)"` -- inline HTML images.

Target normalization before comparison:

1. Strip leading `./` prefix.
2. Strip query strings (`?...`).
3. Strip fragment identifiers (`#...`).
4. Compare by basename only (directory path is ignored).

Files in the `ignore` list (see `frontdoc.yaml` in 03-configuration.md) do
not prevent automatic collapse. Other non-`index.md` files do block
collapse.

## Wiki-Style Links

Documents can reference each other inline using double-bracket syntax.
Links always resolve by ID (short or full). The display title after `:` is
a human-readable label and is not used for resolution.

Supported formats:

- `[[9g5fav:Acme Corporation]]` -- short ID with display title
- `[[clients/9g5fav:Acme Corporation]]` -- with collection prefix
- `[[9g5fav]]` -- short ID only (no display title)
- `[[01arz3ndektsv4rrffq69g5fav]]` -- full ULID

The display title is optional. When present, it makes the source readable
without requiring a lookup. The `check` command validates that the ID
resolves and that the display title matches the document's current
`DisplayName()`. The `check --fix` command updates stale display titles
automatically. The `rename` command updates both the ID and display title
in all linking documents when a document's ID changes.

The collection prefix (e.g. `clients/`) is optional and cosmetic -- it is
not used for resolution. It can help readers understand the link target
without looking it up.

These are "soft references" -- they appear in content, not in metadata
fields.

## Display Name Resolution

`DisplayName()` is used by Web UI lists and wiki link title checks/fixes.

Resolution order:

1. If collection schema has `title_field`, use that metadata field when
   present and non-empty.
2. Otherwise, from the collection slug template, use the first template
   variable that is not `short_id` (for example `{{date}}` in
   `journal-{{date}}-{{short_id}}`).
3. Fallback metadata keys: `name`, `_title`, `title`, `subject`, `summary`.
4. Filename basename (without `.md`, excluding `index.md`).
5. Short ID from `_id`.
6. `Untitled`.

## Templates

Template documents are stored in the `templates/` collection folder. They are
identified by belonging to that collection, not by any metadata field. They
have two required fields:

- `name` -- human-readable template name
- `for` -- the collection this template applies to

Template content uses the same `{{field_name}}` and `{{field | filter}}`
placeholder syntax as slug templates. All placeholders must resolve --
missing fields produce an error. Use `\{{` to emit literal braces. See
09-template-system.md for the full processing rules.
