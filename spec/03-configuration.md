# tmdoc Specification: Configuration

## Overview

tmdoc uses a distributed configuration model:

- **`tmdoc.yaml`** at the repository root contains repository-wide
  configuration.
- **`_schema.yaml`** inside each collection directory defines that
  collection's schema (slug, fields, references).

A directory is a collection if and only if it contains a `_schema.yaml` file.

## Repository Root Discovery

The repository root is found by searching upward from the working directory
(or the path given with `-C`) for a `tmdoc.yaml` file. If found, that
directory is the root. If not found, return an error indicating the
repository is not initialized (suggest running `tmdoc init`).

The `--directory` / `-C` flag overrides the starting directory: the upward
search for `tmdoc.yaml` begins from the specified path instead of the
current working directory.

## `tmdoc.yaml` -- Repository Configuration

Located at the repository root. Unknown keys are preserved on read and
re-serialized on write.

```yaml
aliases:
  cli: clients
  inv: invoices
  tpl: templates
ignore:
  - .DS_Store
  - Thumbs.db
```

### `aliases`

Each key is a short prefix (typically 2-4 characters). Each value is a
collection directory name. Alias prefixes must be unique across the file.

### `ignore`

A list of filenames to ignore inside folder documents. These files do not
count as attachments and are silently removed during folder collapse
(`check --fix`). Default value if omitted: `[".DS_Store", "Thumbs.db"]`.

This file is the single source of truth for prefix uniqueness. Because it is
one file, git merge conflicts make alias collisions visible.

### Alias Auto-Generation

When creating a collection without an explicit prefix, one is auto-generated:

1. Check well-known overrides (e.g. "templates" -> "tpl").
2. Otherwise, extract up to 3 consonant characters from the lowercase name.
3. If all characters were filtered out, fall back to the first 3 characters.

## `_schema.yaml` -- Collection Schema

Located at `<collection_dir>/_schema.yaml`. Defines the schema for that
collection:

```yaml
slug: "{{name}}-{{short_id}}"
fields:
  name:
    type: string
    required: true
    weight: 10
  email:
    type: email
references:
  project_id: projects             # references projects collection by ID
  client_id: clients               # references clients collection by ID
```

### Schema Properties

| Property          | Type   | Required | Description                                    |
|-------------------|--------|----------|------------------------------------------------|
| `slug`            | string | yes      | Filename template for documents in this collection. |
| `short_id_length` | int    | no       | Short ID length (4--16, default 6).            |
| `fields`          | map    | no       | Field definitions (omitted when empty).        |
| `references`      | map    | no       | Cross-collection references (omitted when empty). |

The collection name is the directory name -- it is not stored in
`_schema.yaml`. The alias (prefix) is not stored here either; it lives in
`tmdoc.yaml`.

A minimal valid `_schema.yaml` needs only `slug`:

```yaml
slug: "{{short_id}}"
```

### Slug Auto-Generation

When creating a collection without an explicit `slug`, a default is
generated and persisted to `_schema.yaml`:

1. Check the collection's field definitions for `title`, `name`, or
   `subject` (in that priority order).
2. If a matching field is found: `{{field_name}}`
3. If no matching field: `{{short_id}}`

Slug templates do not need to include `{{short_id}}`. During filename
generation, tmdoc automatically appends `-<short_id>` to the basename unless
the basename already ends with that short ID.

The auto-generated slug is stored in `_schema.yaml` and can be edited by the
user at any time. There is no hidden default -- `schema show` always
displays the effective slug template.

## Short ID

The short ID is derived from the last N characters of the ULID (the random
portion). The default length is 6. Characters are Crockford base32
(`[0-9a-z]` excluding `i`, `l`, `o`, `u`).

The length can be overridden per collection via the `short_id_length`
property in `_schema.yaml`. Valid values are 4--16. This is useful for
collections that grow large enough to risk short ID collisions (6 chars
is comfortable up to ~50,000 documents).

For example, with ULID `01arz3ndektsv4rrffq69g5fav` and the default
length of 6, the short ID is `9g5fav` (from the random portion
`tsv4rrffq69g5fav`).

## Collection Identification

A directory is a collection if and only if it contains `_schema.yaml`. There
is no auto-discovery of schema-less directories. This means:

- Before `tmdoc init`, tmdoc cannot operate (no collections recognized).
- `tmdoc init` creates `tmdoc.yaml` to mark the repository root.
- `schema create <name>` creates the directory, writes `_schema.yaml`, and
  adds an alias entry to `tmdoc.yaml`.

## Field Types

| Type        | Stored As          | Validation                                |
|-------------|--------------------|-------------------------------------------|
| `string`    | string             | none                                      |
| `email`     | string             | regex: standard email pattern              |
| `currency`  | string (uppercase) | ISO 4217 code from a known set            |
| `country`   | string (uppercase) | ISO 3166-1 alpha-2 code from a known set  |
| `date`      | string             | YYYY-MM-DD format                         |
| `datetime`  | string             | RFC 3339 format (always quoted in YAML)   |
| `number`    | int/float          | optional min/max constraints               |
| `enum`      | string             | must be one of `enum_values`               |
| `array`     | list               | must be an array                           |
| `reference` | string             | referenced document must exist and match collection |

### Enum Fields

Fields are `string` by default unless the schema explicitly declares
`type: enum` with `enum_values`.

## Field Ordering (Interactive Prompts)

Fields presented to the user during interactive creation are sorted by weight.
Lower weight = higher priority (shown first). Default weights by name:

| Weight | Fields                                    |
|--------|-------------------------------------------|
| 10-20  | name, title, subject, _id                 |
| 30-35  | email, contact_email, username            |
| 40-45  | status, priority                          |
| 50-55  | date, due_date, _created_at               |
| 60     | (unknown fields -- default)               |
| 70-75  | description, notes, content               |
| 90-95  | tags, categories, labels                  |

Custom weights can be set per field via the `weight` property.

## Built-in Collections

### Templates Collection

The templates collection follows the same rules as any other collection -- it
requires `templates/_schema.yaml`. Its defaults are:

- Collection name / directory: `templates`
- Alias: `tpl` (in `tmdoc.yaml`)
- `slug`: `{{name}}-{{short_id}}`
- Required fields: `name` (string), `for` (string)

The `for` field references a target collection name.

`schema create templates` creates it with these defaults.

## Schema Validation

On load, each `_schema.yaml` is validated:

- Field defaults must match their declared type (e.g. an enum default must be
  in `enum_values`, a number default must be numeric).
- Field and reference names beginning with `_` are rejected (`_*` is a
  reserved system namespace).
- Invalid defaults produce a load error with field path and expected type.

`tmdoc.yaml` is validated for alias uniqueness -- duplicate prefixes or
prefixes that collide with collection names produce a load error.

## Schema Persistence

When saving a `_schema.yaml`:

1. Empty `fields` and `references` maps are omitted entirely.
2. Uses standard YAML serialization.

When saving `tmdoc.yaml`:

1. Prepends a header comment with a documentation link.
2. Uses standard YAML serialization.

## Date Input Parsing

Date and datetime fields accept shorthand input during interactive
operations. The input is parsed and stored in the canonical format.

Accepted date inputs:

- `YYYY-MM-DD` -- canonical format, stored as-is
- `today` -- current date
- `yesterday` -- current date minus 1 day
- `tomorrow` -- current date plus 1 day
- `+N` / `-N` -- offset in days from the current date (e.g. `+7`, `-3`)

Accepted datetime inputs:

- RFC 3339 string -- stored as-is
- Any accepted date input -- converted to `YYYY-MM-DDT00:00:00Z`

No other formats are accepted. Ambiguous natural language inputs (e.g.
"last week", "next friday") are intentionally not supported.

Dates are stored as `YYYY-MM-DD`. Datetimes as RFC 3339.
