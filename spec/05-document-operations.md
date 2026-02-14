# tmdoc Specification: Document Operations

## Document Model

A Document has four properties:

- `Path` (string) -- file path for file documents, folder path for folder
  documents
- `Metadata` (map of string to any) -- YAML frontmatter key-value pairs
- `Content` (string) -- markdown body
- `IsFolder` (bool) -- true if this is a folder document

### Derived Properties

- `ContentPath()` -- returns `Path/index.md` for folder docs, `Path` for file
  docs
- `GetCollection()` -- returns the first path component (everything before the
  first `/`). Subdirectories within a collection folder are allowed and do not
  affect collection membership (e.g. `clients/archive/doc.md` belongs to
  `clients`). Root-level documents have no valid collection; their path has no
  `/`, so `GetCollection()` returns the filename itself, which will fail
  collection membership validation
- `GetID()` -- returns `metadata["_id"]` or `""`
- `GetShortID()` -- last N characters of the full ULID (the random portion),
  where N is the collection's `short_id_length` (default 6)
- `DisplayName()` -- first checks the collection's slug template for a
  field reference (e.g. if slug is `{{short_id}}-{{name}}`, uses `name`);
  then falls back to `name`, `_title`, `title`, `subject`, `summary` in
  order; then to filename (without extension), then short ID, then
  `"Untitled"`

### Serialization (Build)

`Build()` produces the full document text:

1. If metadata is non-empty, emit `---\n`.
2. Marshal metadata as YAML with `_id` first, `_created_at` second, then
   remaining persisted fields (excluding virtual `_title`).
3. Emit `---\n`.
4. If content doesn't start with `\n`, emit one blank line.
5. Emit content.

### Saving

- File documents: write `Build()` output directly to `Path`.
- Folder documents: ensure `Path` directory exists, write `Build()` output to
  `Path/index.md`.

All writes use 0644 permissions for files, 0755 for directories.

## ID Generation

- Full ID: ULID, lowercase Crockford base32
  (e.g. `01arz3ndektsv4rrffq69g5fav`)
- Short ID: last N characters of the ULID (the random portion), where N is
  the collection's `short_id_length` (default 6).
- IDs are generated on document creation if `_id` is not already present in
  metadata.
- ULIDs are time-sortable: documents created later have lexicographically
  greater IDs.

## Document Builder

The Builder provides a fluent API for constructing documents:

```
NewBuilder(collections, collection)
  .WithField(key, value)
  .WithContent(content)
  .SkipValidation()
  .Build() -> Document
```

### Build Steps

1. Generate a ULID `_id` if not already set.
2. Set `_created_at` to current time in RFC 3339 if not already set.
3. Unless validation is skipped or the collection is "templates":
   a. Verify every provided field exists in the collection's schema (except
      built-in fields `_id`, `_created_at`, `_title`). Any user-provided
      field starting with `_` is rejected as reserved/read-only. Reference
      fields ending in `_id` are allowed if defined in the collection's
      `references` map.
   b. Verify all required fields (per schema) are present.
4. Return the Document.

## Filename Generation

`GenerateFilename(collection)`:

1. Get the collection's `slug` template from its `_schema.yaml`.
2. Render the template: replace `{{field_name}}` placeholders with
   slugified metadata values, `{{short_id}}` with the short ID, and
   `{{date}}` with the date field or today. `_title` is available as a
   virtual field from markdown content. Apply any filters (e.g.
   `{{date | year}}` extracts the year). If a placeholder references a
   field not present in metadata or virtual fields, return an error.
3. Slugify each path segment: lowercase, replace non-alphanumerics (except
   `/`) with hyphens, collapse consecutive hyphens, trim trailing hyphens.
   Placeholder values are slugified before interpolation and `/` is removed,
   so only literal `/` in the slug template creates path segments.
4. Append `.md` if not already present.
5. If the slug contains `/`, ensure parent directories exist (created
   automatically during Save).

When a slug template produces a path with `/`, the directory portion is
created on save if it does not exist. `ValidateFilename` compares the full
relative path within the collection folder, not just the basename.

## Create Operation

`DocumentService.Create(options)`:

**Options**:
- `Collection` (string) -- required
- `Fields` (map) -- metadata key-value pairs
- `Content` (string) -- markdown body
- `TemplateContent` (string) -- template content to process
- `SkipValidation` (bool)
- `Overwrite` (bool) -- allow overwriting existing file

**Steps**:

1. Create a Builder for the collection.
2. If SkipValidation, configure the builder to skip.
3. Add all provided fields.
4. For any schema field with a `default` value that wasn't provided, inject
   the default (processing it through validation, e.g. date parsing).
5. If TemplateContent is provided, process it through the template engine
   (replacing `{{field}}` placeholders) and set as content. Otherwise use
   Content directly.
6. Call `builder.Build()` to produce the Document.
7. Unless SkipValidation, run document validation (type-specific field
   validation such as email format, enum membership, number ranges, and
   reference validation). This is a separate pass from the Builder's schema
   conformance checks (step 6). If errors, return them as a combined error
   message.
8. Compute the target path: `{collection_name}/{generated_filename}`.
9. If not Overwrite and the target already exists, return an error.
10. Save the document (always as a file, never as a folder on initial create).
11. Return the Document and its path.

## Update Operation

`DocumentService.Update(docPath, options)`:

**Options**:
- `Fields` (map) -- fields to set (key-value pairs)
- `UnsetFields` (list of string) -- fields to remove from metadata
- `Content` (*string) -- if non-nil, replace content
- `SkipValidation` (bool)

**Steps**:

1. Parse the existing document from the given path.
2. Determine the document's collection from its path (first path segment).
3. Unless SkipValidation, verify all provided field names exist in the
   collection's schema. Reject any field name starting with `_` as
   reserved/read-only.
4. Apply field updates: set new values from Fields, remove fields listed in
   UnsetFields. Unsetting reserved fields (`_*`) is not allowed.
5. If Content is provided, replace the document content.
6. Unless SkipValidation, run document validation.
7. Save back to disk. For folder documents, write to `{path}/index.md`.
8. If any slug-relevant field changed, run Auto-Rename (see below).

## Delete Operation

`DocumentService.Delete(path)`:

1. Verify the path exists.
2. Remove it recursively (handles both files and folders).

## Upsert by Slug

`DocumentService.UpsertBySlug(collection, args, options)`:

Used by the `open` command to resolve slug-target documents based on template
variables (e.g. `tmdoc open journals 2024-03-22`), and by internal create
paths that still need immediate upsert behavior.

**Steps**:

1. Get the collection's slug template. Extract placeholder variable names.
2. Map positional args to template variables in order.
3. Search existing documents of the collection for one whose metadata matches
   all template variable values.
4. If found, return the existing document (not created).
5. If not found by metadata match, compute the expected filename from the
   template and check if a file or folder exists at that path.
6. If found on disk, parse and return it.
7. Otherwise, create a new document with the given fields (injecting defaults
   and today's date for `date` fields). If options provide template content
   (directly or via resolver), process and apply it as initial document
   content.
8. Return the new document with a "created" flag.

## Open Draft Staging

When `open` resolves a missing target, it stages edits via a temporary draft
path inside the same collection before creating the real document.

**Rules**:

1. Draft filename must use reserved prefix `.tmdoc-open-`.
2. Draft lives under the same collection root as the final target.
3. Draft files are excluded from normal document collection/listing and are
   not considered real documents.
4. If edited draft content is unchanged from initial baseline, discard draft
   and do not create target.
5. If edited draft content changes and passes validation, persist to target
   and remove draft.
6. If validation fails, user may re-open draft, keep draft, or discard.

## Auto-Rename

`DocumentService.AutoRename(path)`:

Automatically renames a document's file/folder when its filename no longer
matches the expected filename derived from the current metadata and the
collection's slug template. The ULID is always preserved -- auto-rename
never changes the document's ID.

Auto-rename is triggered by:

- The `update` command, after saving field changes.
- The `open` command, after the editor closes and changes are detected.
- The `check --fix` command, during filename validation repair.

**Steps**:

1. Look up the collection config from the document's path (first path
   segment) and regenerate the expected filename from the current metadata
   (short ID, current name/_title/title).
2. If the expected path matches the current path, do nothing.
3. If the expected path differs, rename via VFS.
4. For folder documents, the target is the folder name (filename without
   `.md`).
5. Return the new path (or the unchanged path if no rename was needed).

## Attach Operation

`DocumentService.AttachFile(docPath, sourcePath, addReference, force)`:

1. If the document is a file (not a folder):
   a. Create a directory named after the file (without `.md`).
   b. Move the `.md` file into the directory as `index.md`.
   c. Update `docPath` to point to the new folder.
2. Read the source file from the OS filesystem.
3. Write it into the document's folder via VFS.
4. If `addReference` is true:
   a. Parse the document.
   b. Append `\n\n[filename](filename)\n` to the content.
   c. Save via Update with SkipValidation.
5. Return the destination path of the attached file.

**Folder collapse note**: The inverse operation (collapsing a folder document
back to a file) is handled by `check --fix`. Collapse is blocked if any file
other than `index.md` exists in the folder, excluding files in the `ignore`
list (see `tmdoc.yaml` in 03-configuration.md). Ignored files are silently
removed during collapse.

## List Operation

`DocumentService.List(filters...)`:

Delegates to `Repository.CollectAll(filters...)`. Returns all matching
DocumentRecords.
