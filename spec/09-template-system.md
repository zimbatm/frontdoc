# tmdoc Specification: Template System

## Overview

Templates are documents stored in the `templates/` collection folder that
provide pre-defined structures for creating new documents. They support
variable substitution and automatic discovery.

The templates collection follows the same rules as any other collection --
it requires `templates/_schema.yaml` to be recognized. See Built-in
Collections in 03-configuration.md for its default schema.

## Template Discovery

### Discovery Location

Templates are discovered from the `templates/` collection folder only.
Example templates belong in documentation, not in runtime discovery paths.

### Discovery Process

`TemplateEngine.FindTemplates()`:

1. Verify `templates/_schema.yaml` exists (the templates collection must be
   initialized). If not present, return no templates.
2. Walk the templates directory.
3. For each `.md` file (skip `_schema.yaml`, directories, and non-markdown
   files):
   a. Parse as a document.
   b. Extract `name` from metadata.
   c. Extract `for` from metadata (the target collection name).
4. Return all discovered templates.

### Filtering by Collection

`FindTemplatesForCollection(collection)`: returns templates where `for`
matches the given collection name. The `for` value is resolved through
`ResolveCollectionAlias` before comparison, so both canonical names and
aliases work consistently (e.g. `for: cli` matches collection `clients` if
`cli` is an alias for `clients`).

## Template Processing

`TemplateEngine.ProcessTemplate(template, values)`:

All templates (slug templates and content templates) share the same
processing rules:

1. Find all `{{...}}` placeholders in the template string.
2. For each placeholder:
   a. Parse the placeholder: `{{field_name}}` or `{{field_name | filter}}`.
   b. Look up `field_name` in the values map. If not found, return an error
      identifying the missing field.
   c. If a filter is present, apply it (see Filters below).
   d. Replace the placeholder with the resulting string value.
3. Return the processed string.

### Filters

Filters are applied with `|` pipe syntax inside placeholders:

- `{{date | year}}` -- extract the year from a date value (YYYY)
- `{{date | month}}` -- extract the month (MM)
- `{{date | day}}` -- extract the day (DD)
- `{{field | upper}}` -- uppercase
- `{{field | lower}}` -- lowercase

Filters are optional. Unfiltered fields are used as-is (slug templates
slugify the result during filename generation; content templates insert the
raw value).

### Escaping

To produce a literal `{{` in template output, use `\{{`. The backslash is
consumed and the braces are emitted as-is without placeholder processing.

## Template Service

The TemplateService wraps the template engine with schema awareness:

### GetTemplatesForCollection

1. The templates directory is `templates/`. It must contain `_schema.yaml`
   to be recognized.
2. Create a template engine for the `templates/` directory with VFS.
3. Filter templates by collection using `FindTemplatesForCollection`.
4. Return matching results.

### ProcessTemplate

Delegates to the template engine's ProcessTemplate.

## Template Usage in Document Creation

When creating a document:

1. If `--no-template` is specified, skip template selection entirely and
   create with empty content (or user-provided `--content`). This bypasses
   auto-selection even when exactly one template exists for the collection.
2. If `--template "Name"` is specified, find the matching template and use its
   content.
3. If neither flag is specified but templates exist for the collection:
   - If exactly one template: use it automatically.
   - If multiple templates: prompt the user to choose (interactive mode).
   - If no templates: create with empty content (or user-provided content).
4. The template's content goes through ProcessTemplate with the document's
   field values before being set as the new document's content.
5. Template metadata fields (`_id`, `_created_at`, `_title`, `name`, `for`)
   are NOT carried
   over -- only the content body is used.

## Template Document Format

```
---
_id: "..."
_created_at: "..."
name: Project Kickoff
for: projects
---

# Project: {{name}}

Client: {{client_id}}
Budget: {{budget}} {{currency}}

## Objectives

[Define project objectives here]
```

Required fields:
- `name` -- template name for display and selection
- `for` -- target collection name
