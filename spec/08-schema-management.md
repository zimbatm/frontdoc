# tmdoc Specification: Schema Management

## Schema Service

The SchemaService manages collection definitions at runtime. Changes are
persisted to per-collection `_schema.yaml` files and to the aliases section
of `tmdoc.yaml`.

## Collection Operations

### Add Collection

`SchemaService.AddCollection(options)`:

**Options**: Name, Alias, Slug, Fields

**Steps**:

1. Validate: name is non-empty.
2. Verify collection doesn't already exist (no `<name>/_schema.yaml`).
3. If Alias is empty, auto-generate from name (see Alias Auto-Generation in
   03-configuration.md).
4. Verify Alias is not already used by another collection in `tmdoc.yaml`.
5. If Slug is empty, auto-generate from the collection's field definitions
   (see Slug Auto-Generation in 03-configuration.md).
6. Create the directory on disk via VFS (directory name = collection name).
7. Write `<name>/_schema.yaml` with slug, fields, and references.
8. Add the alias entry to `tmdoc.yaml`.
9. Save `tmdoc.yaml`. On failure, log what succeeded and what failed.
   Recovery is via version control (see Recovery Model in
   04-storage-layer.md).

### Remove Collection

`SchemaService.RemoveCollection(options)`:

**Options**: Name, RemoveDocuments, Force

**Steps**:

1. Verify collection exists (`<name>/_schema.yaml` present).
2. Unless Force: count documents in this collection. If any exist and
   RemoveDocuments is false, return error with count.
3. If RemoveDocuments: delete all documents in this collection (by collecting
   and removing each one individually -- does NOT remove the entire directory,
   only matching documents). Also remove templates that target this collection.
4. Remove `<name>/_schema.yaml`.
5. Remove the alias entry from `tmdoc.yaml`.
6. Remove the directory if empty.
7. Save `tmdoc.yaml`. On failure, log what succeeded and what failed.
   Recovery is via version control (see Recovery Model in
   04-storage-layer.md).

### Update Collection

`SchemaService.UpdateCollection(options)`:

**Options**: Name, Alias*, Slug*, Fields* (pointer/optional)

The collection name is immutable in an update operation. To rename a
collection, use `RenameCollection` (see below).

**Steps**:

1. Verify collection exists (`<name>/_schema.yaml` present).
2. If Alias is being changed, verify no conflict with other aliases in
   `tmdoc.yaml`.
3. Apply all non-nil updates to the in-memory schema.
4. Write updated `<name>/_schema.yaml`.
5. If Alias changed, update `tmdoc.yaml`.

### Rename Collection

`SchemaService.RenameCollection(oldName, newName)`:

**Steps**:

1. Verify the old collection exists (`<oldName>/_schema.yaml` present).
2. Validate the new name (non-empty, valid characters, not reserved, not
   already in use).
3. Read `<oldName>/_schema.yaml`.
4. Create the new directory on disk via VFS.
5. Write `<newName>/_schema.yaml` (same content as old).
6. Move all documents from the old folder to the new folder via VFS.
7. Scan all other `_schema.yaml` files: update reference definitions that
   target the old collection (e.g. `oldName` becomes `newName`).
8. Update template `for` fields: for every template whose `for` value equals
   `oldName`, change it to `newName`.
9. Update `tmdoc.yaml`: change the alias target from `oldName` to `newName`.
10. Remove `<oldName>/_schema.yaml`.
11. Remove the old directory if empty.
12. Save all modified files. On failure, log which steps succeeded and
    which failed. Recovery is via version control (see Recovery Model in
    04-storage-layer.md).

### Reserved Collection Names

These names cannot be used for collections: `all`, `none`, `default`.

### Collection Name Validation

Collection names can only contain: letters, digits, underscore, dash.

## Field Operations

### Add Field

`SchemaService.AddFieldToCollection(collectionName, fieldName, field)`:

1. Verify collection exists (`<collectionName>/_schema.yaml` present).
2. Verify field doesn't already exist.
3. Reject field names beginning with `_` (`_*` is reserved for system
   fields).
4. Add field to the schema's fields map.
5. Write updated `<collectionName>/_schema.yaml`. On failure, rollback.

### Update Field

`SchemaService.UpdateFieldInCollection(collectionName, fieldName, update)`:

Partial update -- only changes fields that are non-nil in the update struct:
type, required, description, default, enum_values, pattern, min, max, weight.

1. Verify collection and field exist.
2. Apply non-nil updates.
3. Write updated `<collectionName>/_schema.yaml`.

### Remove Field

`SchemaService.RemoveFieldFromCollection(collectionName, fieldName)`:

1. Verify collection and field exist.
2. Remove field.
3. Write updated `<collectionName>/_schema.yaml`. On failure, rollback.

## Field Type Migration

Changing a field's type in `_schema.yaml` (e.g. from `string` to `number`)
does not automatically migrate existing documents. Documents with values
incompatible with the new type will fail validation on the next `tmdoc check`
run.

Recommended migration workflow:

1. Update the field type in `_schema.yaml` via `schema field update`.
2. Run `tmdoc check` to identify all documents with incompatible values.
3. For types with auto-fix support (e.g. currency/country case), run
   `tmdoc check --fix` to correct them automatically.
4. For other type changes, update affected documents manually via
   `tmdoc update` or edit the files directly.

## Collection Alias Resolution

`ResolveCollectionAlias(nameOrPrefix) -> collectionName`

1. If the input matches an existing collection name (a directory with
   `_schema.yaml`), return it.
2. If it matches any alias key in `tmdoc.yaml`, return the alias target.
3. Otherwise, return the input as-is (let the caller decide).

This allows users to type `cli` instead of `clients` in any command.

## Pre-Init State

Without `tmdoc.yaml` or any `_schema.yaml` files, tmdoc cannot identify
collections. Most commands will report that the repository is not initialized
and suggest running `tmdoc init`.
