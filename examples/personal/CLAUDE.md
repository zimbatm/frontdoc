# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A frontdoc personal knowledge management repository. Documents are Markdown files with YAML frontmatter, organized into collections. Each collection has a `_schema.yaml` defining its fields, slug pattern, and references.

## Commands

- `frontdoc list [collection]` -- list documents (add `-o table` for table output)
- `frontdoc open <collection> [idOrArg]` -- create or open a document in `$EDITOR`
- `frontdoc create <collection> <title>` -- create a new document
- `frontdoc search <query>` -- full-text search across documents
- `frontdoc check --verbose` -- validate all documents against schemas (run before committing)

Collection aliases are defined in `frontdoc.yaml`: `jrn` (journal), `tsk` (tasks), `ctc` (contacts), `area` (areas), `skl` (skills), `tpl` (templates).

## Collections

| Collection  | Slug pattern | Key fields |
|-------------|-------------|------------|
| journal     | `{{date}}`  | date (required), title, mood (enum: focused/calm/tired/stressed), tags |
| tasks       | auto        | title (required), status (required, enum: todo/doing/done), due_date, area_id (ref to areas) |
| contacts    | auto        | name (required), email, notes |
| areas       | `{{name}}`  | name (required), review_date |
| skills      | `{{name}}`  | name (required), description (required); uses `index_file: SKILL.md` (folder documents) |
| templates   | `{{name}}`  | name (required), for (required) |

## Document Conventions

- Every document has system fields `_id` and `_created_at` in its frontmatter.
- Wiki links use double-bracket syntax with short IDs: `[[al1ce9:Alice Chen]]`, `[[9home1:Personal]]`.
- The short ID is the last 6 characters of the `_id` field.
- References between collections (e.g., `area_id` in tasks) use these short IDs.
- The `skills/` collection uses folder documents -- each skill is a directory with a `SKILL.md` entry file, which doubles as a Claude Code skill when symlinked to `.claude/skills/`.
