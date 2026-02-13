# tmdoc Specification Index

This specification describes the architecture and design of tmdoc, a CLI tool
for managing YAML+Markdown document collections. It is intended to provide
enough detail to re-implement the project in any programming language.

The specification focuses on behavior, data formats, algorithms, and
architecture -- not on language-specific implementation details.

## Documents

1. [Overview](01-overview.md) -- Purpose, design principles, high-level
   architecture.

2. [Document Format](02-document-format.md) -- YAML+Markdown file structure,
   frontmatter parsing, filename conventions, file vs. folder documents,
   wiki-style links, templates.

3. [Configuration](03-configuration.md) -- `tmdoc.yaml` alias file,
   `_schema.yaml` collection schemas, field types, collection
   identification, date input parsing.

4. [Storage Layer](04-storage-layer.md) -- VFS abstraction, path
   normalization, disk and memory implementations, Repository pattern, filter
   system.

5. [Document Operations](05-document-operations.md) -- Document model,
   Builder pattern, ID generation, CRUD operations, upsert-by-slug, rename,
   attach.

6. [Search](06-search.md) -- Unified search, full-text scoring, structured
   query language, top-result disambiguation.

7. [Validation](07-validation.md) -- Collection validation, reference
   validation, wiki link validation, filename validation, validator
   construction from schema.

8. [Schema Management](08-schema-management.md) -- Collection CRUD, field
   CRUD, alias resolution.

9. [Template System](09-template-system.md) -- Template discovery, variable
   substitution, template service.

10. [CLI Interface](10-cli-interface.md) -- All commands, flags, output
    formats, interactive mode.

11. [Dependency Injection](11-dependency-injection.md) -- Manager container,
    service wiring, init flow, shared schemas and aliases.

12. [Testing Strategy](12-testing-strategy.md) -- In-memory VFS testing, test
    categories, key invariants.
