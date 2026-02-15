# frontdoc Specification: Validation

## Overview

Validation happens at multiple levels:

1. **Schema validation** (Builder) -- field names exist in schema, required
   fields present.
2. **Field validation** (Validator) -- field values conform to their declared
   type.
3. **Collection membership validation** -- every document must reside in a
   known collection folder.
4. **Reference validation** (ReferenceValidator) -- referenced documents exist
   and belong to the correct collection.
5. **Wiki link validation** (WikiLinkValidator) -- wiki-style links in content
   resolve to existing documents.
6. **Filename validation** (FilenameValidator) -- filenames match expected
   patterns.

## Reserved Fields

The `_` prefix is reserved for system fields.

- Documents may contain system fields `_id` and `_created_at`.
- `_title` is virtual (derived from content) and is never persisted.
- User-defined schema fields and `references` keys MUST NOT start with `_`.
- User input MUST NOT set, unset, or modify `_id`, `_created_at`, or `_title`.

## Validator

The core Validator holds a map of field names to FieldValidator rules. It
validates documents by:

1. Checking all required fields are present.
2. For each field in the metadata, running its type-specific validation.

### Type-Specific Validation

**Email**: Must match the regex
`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`

**Currency**: Must be a valid ISO 4217 currency code (the full standard set).
Must be uppercase. Schemas may optionally restrict to a subset using
`enum_values` on the field definition.

**Country**: Must be a valid ISO 3166-1 alpha-2 country code (the full
standard set). Must be uppercase. Schemas may optionally restrict to a
subset using `enum_values` on the field definition.

**Date**: Must parse as `YYYY-MM-DD`.

**DateTime**: Must parse as an RFC 3339 string. Native time values from YAML
parsing are not accepted (datetime values must be quoted in YAML).

**Number**: Must be numeric (int, float, or string parseable as float).
Optional min/max constraints.

**Boolean**: Must be a boolean value. During CLI/web input normalization,
common boolean inputs are accepted and stored canonically as booleans:
`true/false`, `1/0`, `yes/no`, `on/off` (case-insensitive).

**Enum**: Must be one of the declared `enum_values` (case-insensitive
comparison).

**Array**: Must be a list (array of any values or array of strings).

**Typed Array (`array<T>`)**: Must be a list, and each item must satisfy
validation rules for `T`. For `array<reference>`, reference resolution is
applied to each item.

**Reference**: No type-level validation (deferred to ReferenceValidator).

**String**: No validation.

### Non-required fields

If a field is not required and its value is nil or empty string, validation
is skipped regardless of type.

## Building Validators from Schema

`BuildValidatorFromSchema(collection)` creates a Validator from the
collection's `_schema.yaml`:

1. For each field in the schema's `fields` map:
   a. Map the schema `type` string to the internal FieldType enum.
   b. Copy `required`, `enum_values`, `min`, `max` from the field definition.
   c. If `pattern` is set, compile it as a regex.
   d. For reference fields, copy the reference target from the `references`
      map in the same `_schema.yaml`.
2. Register each FieldValidator in the Validator.

## Collection Membership Validation

Every document must reside in a known collection folder. A directory is a
known collection if and only if it contains `_schema.yaml`. During
validation:

1. `check` validates documents returned by `Repository.CollectAll`, which only
   returns documents inside known collections.
2. For explicitly validated raw documents (`ValidateRaw`), extract the first
   path segment and verify that directory is a known collection.
3. If not, report an error (severity: error, not warning): document is not in
   a known collection.
4. `check --fix` does NOT auto-fix this (moving files between directories is
   destructive). The user must either move the document manually or run
   `schema create <folder-name>` to register the folder as a collection
   (which creates `_schema.yaml` in that directory).

Temporary open drafts are excluded from validation entirely. Files with
basename prefix `.tdo-` are staging artifacts and are not treated as
documents until persisted to their final path.

For non-draft documents, dot-prefixed basenames are invalid. If expected
filename generation yields a basename beginning with `.`, report
`filename.invalid`.

## Reference Validation

`ReferenceValidator.ValidateReferences(metadata, references)`:

References always resolve by document ID. For each reference definition
(e.g. `client_id: clients`):

1. Get the field value from metadata. Skip if absent.
2. Verify it's a string.
3. The reference target is a collection name.
4. Look up the referenced document by ID: try full ID match first, then
   short ID prefix match.
5. If not found: error.
6. If found but in the wrong collection (checked by path): error.

For `array<reference>` fields, apply the same checks to each string item in
the array.

## Wiki Link Validation

`WikiLinkValidator.ValidateContent(content)`:

1. Find all `[[...]]` patterns in the content using regex.
2. Parse each link: extract the ID portion (before `:` if present, stripping
   any `collection/` prefix).
3. Resolve the ID via `Repository.FindByID(id)`.
4. If the ID doesn't resolve, record a "broken wiki-style link" error.
5. If the link has a display title (after `:`) and the resolved document's
   `DisplayName()` differs, record a "stale wiki link title" warning.

### Link Format Validation

- Empty links are invalid.
- Nested brackets are invalid.
- Links longer than 200 characters are invalid.
- The ID portion must be non-empty.

### Auto-Fix (`check --fix`)

Stale display titles are updated to match the document's current
`DisplayName()`. Broken links (unresolvable ID) are not auto-fixed.

## Filename Validation

### Filename Pattern

As a basic sanity check, filenames must match:
`^[a-z0-9][a-z0-9_/-]*\.md$`

This is a basic sanity check only. Primary filename validation is done by
regenerating the expected filename from the document's metadata and the
collection's slug template, then comparing.

### Collision Detection

When a slug template does not include `{{short_id}}`, `check` warns if two
or more documents in the same collection produce the same expected filename.

### Validation Steps

`ValidateFilename(docPath, collection, docID, doc)`:

1. Skip documents in the templates collection.
2. Generate the expected relative path from the document's current metadata
   and collection's slug template. This may include subdirectories.
3. For folder documents: compare the folder path to the expected path
   without `.md`.
4. For file documents: compare the relative path within the collection
   folder to the expected path.
5. If paths don't match: error with expected path.

## Validation Service

The ValidationService orchestrates validation for the CLI layer:

- `ValidateDocument(collection, fields)` -- runs schema + field + reference
  validation.
- `ValidateSingleField(collection, fieldName, value)` -- validates one field,
  with date parsing for date/datetime types.
- `ValidateWikiLinks(content)` -- validates wiki links in content.
- `ValidateFilename(...)` -- validates filename against expected pattern.
- `ProcessFieldValue(fieldType, value)` -- converts raw input to stored
  format (e.g. natural language date -> YYYY-MM-DD).

## Auto-Fix Behavior (`check --fix`)

When the `--fix` flag is passed to the `check` command, the validation
service attempts to automatically repair certain categories of issues.

### Fix Ordering

Fixes are applied in this order:

1. **Filename rename** -- if the filename does not match the expected
   pattern, rename the file/folder first (so subsequent fixes operate on
   the correct path).
2. **Field-level fixes** -- currency/country case correction and other
   metadata repairs.
3. **Unreferenced attachment removal** -- detect and delete orphaned files.
   This step only runs when `--prune-attachments` is passed, not with
   `--fix` alone.
4. **Folder collapse** -- collapse folder documents back to files when
   appropriate.

### Unreferenced Attachment Detection

For folder documents, all files other than `index.md` are checked against
references in the document content. References are extracted from three
patterns:

1. **Inline links**: `!?\[[^\]]*\]\(([^)]+)\)` -- standard Markdown links
   and images.
2. **Reference-style links**: `[ref]: url` definitions at the end of the
   document (the URL portion is extracted).
3. **HTML image tags**: `<img\s[^>]*src="([^"]+)"` -- inline HTML images.

Comparison is by basename after normalization. Unreferenced attachments are
only removed when the `--prune-attachments` flag is passed (not by `--fix`
alone).

### Folder Collapse

After removing unreferenced attachments, if only `index.md` remains in a
folder document (ignoring files in the `ignore` list from `frontdoc.yaml`,
see 03-configuration.md), the folder is collapsed back to a single `.md`
file. Ignored files are silently removed during collapse. Other non-ignored
files block collapse.

Folder collapse is suppressed for collections with `index_file` set, since
those collections always use folder format by design.

### Currency/Country Case Correction

If a `currency` or `country` field contains a valid code in the wrong case
(e.g. `usd` instead of `USD`), the fix uppercases it automatically.

The auto-fix inspects the field's declared type in the schema directly to
determine whether case correction applies, rather than parsing error message
strings.

### Template `for` Field Validation

For template documents, the `for` field is validated against existing
collection names. A collection exists if its directory contains
`_schema.yaml`. The `for` value is resolved through `ResolveCollectionAlias`
before comparison, so both canonical names and aliases are accepted (e.g.
`for: cli` matches collection `clients` if `cli` is an alias). If the
resolved value does not match any known collection, a validation error is
reported.
