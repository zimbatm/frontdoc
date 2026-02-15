# frontdoc Specification: Dependency Injection & Service Wiring

## Manager

The Manager is the dependency injection container. It holds references to the
loaded schemas, aliases, repository, and all services. CLI commands interact
with the system exclusively through the Manager.

### Construction

**`New(rootPath)`**:

1. Find the repository root by searching upward for `frontdoc.yaml` (see
   Root Discovery in 03-configuration.md). If found, that directory is root.
   If not found, return an error indicating the repository is not
   initialized.
2. Create a Repository (VFS) at the root.
3. Load `frontdoc.yaml` via VFS.
4. If `repository_id` is missing, generate a ULID, persist it to
   `frontdoc.yaml`, and continue with the updated config.
5. Parse alias mappings.
6. Create Repository with the loaded `repository_id`.
7. Scan all top-level subdirectories for `_schema.yaml` files. For each one
   found, parse it and register the directory as a collection.
8. Create services in dependency order:
   a. TemplateService(schemas, aliases, repo)
   b. ValidationService(schemas, aliases, repo)
   c. DocumentService(schemas, aliases, repo, validationService,
      templateService)
   d. SearchService(schemas, aliases, repo)
   e. SchemaService(schemas, aliases, repo)

### Exposed Services

- `Aliases()` -> map of alias -> collection name (from `frontdoc.yaml`)
- `Schemas()` -> map of collection name -> schema (from `_schema.yaml` files)
- `Repository()` -> Repository
- `Documents()` -> DocumentService
- `Search()` -> SearchService
- `Validation()` -> ValidationService
- `Templates()` -> TemplateService
- `Schema()` -> SchemaService

### Convenience Methods

- `Create(opts)` -- delegates to Documents().Create, wraps result in
  DocumentRecord
- `FindByID(id)` -- delegates to Repository.FindByID
- `List(filters...)` -- delegates to Repository.CollectAll
- `RootPath()` -- returns VFS root

## Service Dependencies

```
                  Manager
                 /   |   \     \      \
                v    v    v     v      v
         DocSvc  SearchSvc  SchemaSvc  TemplateSvc  ValidationSvc
           |                             |               |
           +-------- depends on ---------+               |
           +-------- depends on -------------------------+
           |
           v
        Repository
           |
           v
          VFS
```

- DocumentService depends on ValidationService and TemplateService.
- SearchService, SchemaService, TemplateService, ValidationService each
  depend only on the loaded schemas/aliases and Repository.
- All services share the same schema and alias data structures.

## Init Flow

**`Init(path)`**:

1. Write `frontdoc.yaml` with generated `repository_id` and empty aliases section.
2. Call `New(path)` to create a fully initialized Manager.

## Schemas and Aliases as Shared Mutable State

The schema map (collection name -> schema from `_schema.yaml`) and alias map
(prefix -> collection name from `frontdoc.yaml`) are loaded once at startup and
shared by reference across all services. SchemaService mutates these maps
in place when adding/removing collections or fields, then persists the
changes to disk (`_schema.yaml` and `frontdoc.yaml`).

No snapshot or copy-on-write semantics are needed. The advisory lock on
`frontdoc.yaml` ensures a single writer at any time (see Concurrent Access in
04-storage-layer.md), and each CLI invocation processes one command
sequentially.

## Template Content Transfer

When creating a document from a template, only the template's markdown
content body is used (with `{{field}}` placeholders replaced). The
template's own metadata fields (`_id`, `_created_at`, `_title`, `name`,
`for`) are never carried over to the new document. The new document gets a
fresh `_id` and `_created_at`,
and is placed in the target collection's folder.

## Circular Dependency Avoidance

The document module defines its own minimal `FileSystem` interface. The
storage module provides an adapter that bridges VFS to this interface. This
avoids a circular dependency between the document and storage modules.
