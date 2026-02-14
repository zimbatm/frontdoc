# tmdoc Specification: Overview

## Purpose

tmdoc is a CLI tool for managing collections of Markdown documents with YAML
frontmatter. It eliminates the friction of choosing filenames when capturing
information by auto-generating unique IDs, organizing documents into collections, and making everything searchable.

The core premise: all of an organization's structured knowledge can fit in a
single git repository as plain-text YAML+Markdown files, accessible to both
humans and LLM agents.

## Target Use Cases

- Knowledge management systems
- Business documentation (clients, projects, invoices)
- Personal note-taking and journaling
- Any structured document collection stored in version control
- LLM-friendly document stores (structured metadata + natural language content)

## Terminology

This specification uses the following terms consistently:

- **Repository**: The root directory containing `tmdoc.yaml` and collection
  folders.
- **Collection**: A top-level folder that contains `_schema.yaml`.
- **Schema**: The `_schema.yaml` file defining slug, fields, and references
  for one collection.
- **Alias**: A short prefix in `tmdoc.yaml` that maps to a collection name.
- **Document**: A YAML-frontmatter + Markdown record in a collection.
- **File Document**: A single `.md` file document.
- **Folder Document**: A directory document whose content file is `index.md`
  (used for attachments).
- **ID**: The full ULID stored in frontmatter (`_id` field).
- **Short ID**: The last N characters of the ULID (default N=6, configurable
  per collection).
- **Reference**: A metadata field value that points to another document by ID.
- **Wiki Link**: A content link in `[[...]]` form that resolves to a document.
- **Template**: A document in the `templates` collection used to generate
  initial content for new documents.

The canonical term in the spec and code is **Repository**.

## Design Principles

1. **Zero lock-in** -- Documents are standard Markdown with YAML frontmatter.
   No proprietary format, no database. Works with any text editor and any VCS.

2. **Convention over configuration** -- `tmdoc init` creates a `tmdoc.yaml`
   file to mark the repository root. Collections are created explicitly with
   `schema create`, which generates `_schema.yaml` with sensible defaults
   (auto-generated alias and slug). A directory only becomes a collection when
   `_schema.yaml` exists.

3. **Eliminate filename friction** -- `tmdoc add` generates a ULID, derives a
   short ID, and produces a consistent filename. The user never has to think
   about naming.

4. **Plain-text first** -- Everything is a file on disk. The tool is
   designed for repositories up to ~10,000 documents without any indexing.
   If performance becomes an issue at larger scales, indices can be layered
   on top. The source of truth is always the filesystem.

5. **Clean architecture** -- Thin CLI layer delegates to service layer, which
   delegates to domain and storage layers. All file I/O goes through a virtual
   filesystem abstraction so the entire stack is testable with in-memory
   storage.

6. **LLM-ready** -- Structured YAML metadata is machine-parseable. JSON output
   modes on every command enable programmatic consumption. Schema discovery
   lets agents understand collections without prior knowledge.

## High-Level Architecture

```
+-----------------+
|   CLI Layer     |  Parses args, calls services, formats output
+--------+--------+
         |
+--------v--------+
|  Service Layer   |  Business logic, orchestration, validation
+--------+--------+
         |
+--------v--------+
|  Domain Layer    |  Core entities, search, templates, validation rules
+--------+--------+
         |
+--------v--------+
|  Storage Layer   |  VFS abstraction (disk or in-memory)
+-----------------+
```

A **Manager** object (dependency injection container) wires all services
together and is the single entry point used by CLI commands.
