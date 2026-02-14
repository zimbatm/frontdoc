# frontdoc Specification: Web UI Navigation

This document defines the information architecture and navigation model for
the local Web UI served by `frontdoc web` / `frontdoc serve`.

## Goals

- Minimize interaction friction for primary user intents.
- Keep URL-addressable state (deep links, refresh-safe navigation).
- Preserve keyboard-first access for frequent operations.
- Adapt layout to context and viewport, instead of enforcing a fixed pane count.

## Primary User Intents

1. Navigate and find information.
2. When a document is open, focus on editing it.

## Low-Friction Acceptance Criteria

### Intent 1: Navigate and find information

- A user can switch scope (all, collection, recent, validation) with one action.
- Search is always directly available from the list context.
- Opening a document from a list item takes one action and updates the URL.
- URL reload preserves the same scope and selected document context.
- On mobile, browse/search/new/validation remain reachable without hidden deep menus.

### Intent 2: Focus on editing an open document

- Entering a document route prioritizes workspace visibility over list density.
- Save, check, and delete actions remain visible without navigation detours.
- Field-level validation errors are visible at edit time before save.
- Wiki-link suggestion appears inline during `[[` authoring and can be inserted
  with one interaction.
- Drag/drop attachment uploads file and inserts a markdown reference without
  leaving editor context.
- Canonical slug URL is enforced after open/save when route used legacy ID.
- Mobile edit view presents a single focused workspace (no split requirement).

## Information Architecture

The UI is composed of three functional surfaces:

1. Global navigation surface:
   - Collections
   - Recent
   - Validation
2. List/discovery surface:
   - Search input
   - Optional filters/sort controls
   - Document list or validation issue list
3. Workspace/edit surface:
   - Edit / Preview / Split mode switch (desktop)
   - Metadata fields
   - Markdown editor and preview
   - Document actions

These are functional responsibilities, not a hard requirement for a fixed
3-pane layout at all times.

## Layout Adaptation Model

- The implementation may use different pane compositions based on route and
  viewport.
- Collection/recent/all views should prioritize navigation + list throughput.
- Document routes should prioritize editing focus.
- Validation view should prioritize issue scanning and quick open-to-fix flow.
- Mobile defaults to single-surface focus with fast switching.

## Route Model

The URL is the source of truth for navigation state.

- `/` -- all documents
- `/c/:collection` -- collection-scoped list
- `/c/:collection/:slug-or-id` -- open one document (canonicalized to slug)
- `/recent` -- recently updated documents
- `/validation` -- validation issue list

Canonical document URLs use the document slug path (collection-relative path
without `.md`, preserving subdirectories).

Legacy ID URLs are still accepted for compatibility. When a document is opened
via ID (short/full/collection-scoped), the UI/server should resolve the
document and redirect to the canonical slug URL.

## Primary Flows

1. Browse documents:
   - Select collection in navigation.
   - Navigate results in list.
   - Open document in workspace.
2. Search and jump:
   - Focus search.
   - Type query/filter expression.
   - Open highlighted result.
3. Create document:
   - Trigger new document action.
   - Use current collection context by default (route collection when present).
   - Resolve slug variables using schema defaults, consistent with `frontdoc open <collection>`.
   - If a matching slug-target document already exists, open it in workspace.
   - Otherwise stage a temporary draft baseline (including template auto-apply rules when applicable), edit it in workspace, then validate and persist to final path on save.
4. Validate and fix:
   - Open validation view.
   - Select issue to open target document.
   - Edit and re-run validation.

## Navigation Components

### Global Navigation

- Collection list with per-collection counts.
- Current scope highlight.
- Quick links for `Recent` and `Validation`.

### List/Discovery

- Search at top (`query`, optional collection filter).
- Sort options: `updated`, `created`, `name`.
- Keyboard selection and enter-to-open behavior.

### Workspace

- Mode tabs: `Edit`, `Preview`, `Split`.
- Save/validation status indicator.
- Action bar: `New`, `Delete`, `Check`.
- Rich editing affordances:
  - Typing `[[` opens wiki-link suggestions from documents visible to the UI.
  - Selecting suggestion inserts `[[<id-or-short-id>:<display-title>]]`.
  - Drag/drop file upload attaches file to open document and inserts markdown
    link/image reference.
- Metadata form fields are generated from the collection schema (`fields` in
  `_schema.yaml`), including required markers and type-appropriate controls.
- The Web UI performs client-side preflight validation for schema constraints
  (required, type checks, enum, range, pattern) before save, while server-side
  validation remains authoritative.

## Keyboard Navigation (v1)

- `/` -- focus search
- `j` / `k` -- move selection in list
- `Enter` -- open selected document
- `n` -- new document
- `e` -- edit mode
- `p` -- preview mode
- `s` -- split mode
- `[` / `]` -- previous/next document in current list
- `g c` -- collections view
- `g r` -- recent view
- `g v` -- validation view

## Mobile Navigation

Mobile uses a single-surface focused flow that prioritizes the active intent:

1. Discovery (navigation/list/search)
2. Document editing workspace

Bottom navigation includes:
- Browse
- Search
- New
- Validation

On mobile, split mode is disabled; users switch between `Edit` and `Preview`.

## Non-Goals (v1)

- Real-time multi-user navigation presence.
- Multi-tab workspace management.
- Arbitrary user-customizable route schemas.

## Frontend Implementation Baseline (v1.1)

The Web UI implementation uses:

- Vue 3 as the UI runtime.
- Vite for bundling.
- PrimeVue as the shared component system.
- A local design-token layer (CSS variables) for colors, spacing, typography,
  and motion.

Build and serving model:

- Frontend source lives under `webapp/`.
- Build output is emitted to `src/web/static/`.
- The server returns the SPA HTML shell for non-API routes and serves built
  assets from `/ui/*`.

This implementation baseline is an engineering choice; it does not alter the
navigation/route behavior defined above.

## Component Layout Mapping (v1.3)

The initial shell implementation maps functional surfaces to dedicated
components in `webapp/src/features/`:

- `app-shell/AppShell.vue` -- owns adaptive shell layout and surface emphasis.
- `navigation/LeftRail.vue` -- owns global navigation rendering.
- `doc-list/DocumentListPane.vue` -- owns search + list/issue rendering.
- `workspace/WorkspacePane.vue` -- owns document workspace rendering.

Component boundaries remain stable; visual composition can adapt by route and
viewport to reduce friction for active user intent.
