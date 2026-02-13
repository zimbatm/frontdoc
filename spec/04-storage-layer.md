# tmdoc Specification: Storage Layer

## Virtual File System (VFS)

All file operations go through a VFS abstraction. This provides:

- Security: path normalization prevents traversal attacks
- Testability: in-memory implementation for unit tests
- Portability: storage backend can be swapped

### VFS Interface

The VFS extends a base filesystem interface with these operations:

```
Root() -> string
    Returns the absolute path of the VFS root.

Open(path) -> File
    Opens a file for reading.

Create(path) -> File
    Creates or truncates a file for writing.

Stat(path) -> FileInfo
    Returns file metadata.

ReadFile(path) -> bytes
    Reads entire file contents into memory.

WriteFile(path, data, permissions)
    Writes data to a file atomically (write to temp, then rename).

Exists(path) -> bool
    Checks if a path exists.

IsDir(path) -> bool
    Checks if a path is a directory.

IsFile(path) -> bool
    Checks if a path is a regular file.

MkdirAll(path, permissions)
    Creates a directory and all parents.

Remove(path)
    Removes a single file or empty directory.

RemoveAll(path)
    Recursively removes a directory and all contents.

Rename(oldPath, newPath)
    Atomically renames/moves a file or directory.

Walk(root, walkFunc)
    Walks the file tree depth-first, calling walkFunc for each entry.

ReadDir(path) -> []FileInfo
    Lists directory contents.
```

### Path Normalization

All paths are normalized before use:

1. Empty paths are rejected.
2. Absolute paths are rejected (all paths must be relative to VFS root).
3. Paths containing `..` traversal are rejected.
4. Paths are cleaned with standard path normalization.

### Symlink Policy

Symbolic links are not followed. This policy has two intentionally distinct
behaviors:

- **Directory walks**: Symlinks are skipped silently, so document listings
  and collection traversals are not affected by symlinks in the tree.
- **Direct operations**: If a path provided to a VFS operation (read, write,
  stat, etc.) resolves to a symlink, the operation returns an error. This
  gives the user clear feedback rather than silently operating on a
  potentially unexpected target.

### Concurrent Access

tmdoc assumes a single writer at all times. Commands that modify the
repository (create, update, delete, rename, attach, check --fix, schema
mutations, init) acquire an exclusive advisory lock (`flock`) on
`tmdoc.yaml` before performing any writes. If the lock is already held,
tmdoc blocks until it becomes available. Read-only commands (read, list,
search, graph, stats, schema show) do not acquire the lock.

No further synchronization is performed beyond this lock.

### Recovery Model

tmdoc assumes the repository is under version control (git or similar).
Multi-file operations (e.g. collection rename) do not attempt rollback on
partial failure. Instead, tmdoc logs which steps succeeded and which failed,
and the user recovers by reverting to the last committed state
(`git checkout`).

In multi-agent scenarios (e.g. multiple LLM agents operating on the same
repository), coordination should happen via git branches -- each agent works
on its own branch, and changes are merged through standard git workflows.

### Implementations

**BoundVFS (Disk)**:
- Rooted at an absolute directory on the real filesystem.
- Uses OS filesystem operations with boundary enforcement.
- WriteFile uses atomic write: write to `{path}.tmp-{nanos}`, then rename.

**MemoryVFS (Testing)**:
- Entirely in-memory filesystem.
- Rooted at `/`.
- Same interface, used for all unit tests.

## Repository

The Repository wraps VFS and provides document-specific operations.

### Construction

- `NewRepository(rootPath)` -- creates a repo with a disk VFS at the given path.
- `NewRepositoryWithVFS(vfs)` -- creates a repo with any VFS implementation.

### Document Collection

`CollectAll(filters...) -> [DocumentRecord]`

Walks the entire VFS from root, collecting all documents:

1. For each entry encountered during the walk:
   - Skip `_schema.yaml` files (reserved metadata, not documents).
   - If it is a directory containing `index.md`, treat as a folder document.
   - If it is a `.md` file (not `README.md`, not `index.md`, not hidden),
     treat as a file document.
   - Otherwise, skip.
2. Parse each qualifying entry into a Document.
3. Wrap in a DocumentRecord (Document + path + FileInfo).
4. Apply all filter functions. If any filter returns false, skip the document.
5. Return all passing documents.

A document's collection is derived from the first segment of its path. For
example, `clients/9g5fav-acme-corp.md` belongs to the `clients` collection.

A directory is only recognized as a collection if it contains `_schema.yaml`.
Documents found in directories without `_schema.yaml` are not in a known
collection and will fail collection membership validation.

### Document Lookup

`FindByID(partialID) -> DocumentRecord`

Finds a document by full or partial ID:

1. Walk all entries as in CollectAll.
2. For each markdown file/folder, extract the ID portion from the filename
   (the segment before the first `-` in the basename, or the entire basename
   if no `-` exists) and check if it starts with the partial ID
   (case-insensitive prefix match). Substring matches in the middle of slugs
   are not considered.
3. If the filename matches, parse the document and check if the metadata `id`
   field starts with the partial ID or equals it exactly.
4. If exactly one match: return it.
5. If multiple matches: return an error ("multiple documents match").
6. If no matches: return an error ("no document found").

### Filesystem Adapter

The Repository exposes a `FileSystem()` method that returns an adapter
implementing the document layer's FileSystem interface. This breaks the
circular dependency between the storage and document packages -- the document
package defines a minimal FileSystem interface, and the storage package
provides the adapter.

## Filters

Filters are predicate functions over DocumentRecord:

```
type Filter = (DocumentRecord) -> bool
```

Built-in filter constructors:

- `ByCollection(collectionName)` -- matches documents in a specific collection
  (by checking the first path segment)
- `ByField(field, value)` -- matches documents with a specific field value
- `HasField(field)` -- matches documents where the key exists in the metadata
  map, regardless of value (including nil/null/empty string)
- `And(filters...)` -- all filters must pass
- `Or(filters...)` -- any filter must pass
- `Not(filter)` -- inverts a filter

Additionally, the search engine provides:

- `ExcludeTemplatesFilter()` -- excludes documents in the `templates/`
  collection (by checking the path prefix)

Filters are applied during collection traversal, so rejected documents are
never accumulated in memory.
