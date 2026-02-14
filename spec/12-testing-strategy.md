# frontdoc Specification: Testing Strategy

## Approach

All tests use real implementations -- no mocking. The VFS abstraction makes
this possible by providing an in-memory filesystem (MemoryVFS) that behaves
identically to the disk VFS.

## Test Setup Pattern

```
1. Create a MemoryVFS.
2. Create a Repository with the MemoryVFS.
3. Write test fixtures (`_schema.yaml` files, `frontdoc.yaml`, documents) directly into the MemoryVFS.
4. Create services with the test config and repository.
5. Exercise the service methods.
6. Assert on return values and VFS state.
```

No temp directories, no filesystem cleanup, no test isolation concerns.

## Test Categories

### Unit Tests

Cover:
- Document parsing and serialization
- Slug generation and filename rendering
- Query parsing
- Validation rules (email, currency, date, etc.)
- Filename pattern matching
- Builder validation
- Config loading and merging
- Filter composition
- Template processing
- Schema operations
- Collection membership derivation from path
- Web UI route/state helpers (URL parsing, canonical route keys)

Style: table-driven tests where multiple input/output scenarios apply.

For the Vue Web UI, unit and component tests use:
- Vitest as test runner
- Vue Test Utils for component rendering and interaction
- JSDOM for browser-like DOM APIs

### Integration Tests

Cover:
- Full CLI command execution
- End-to-end workflows (create -> read -> update -> delete)
- Config override behavior
- Attachment workflows
- Relationship detection
- Web server shell and static bundle surface (`/`, `/ui/*`)

These tests may use the full Manager and exercise multiple services in
sequence.

### Browser E2E Tests

Cover:
- Web UI shell render and route navigation in a real browser context
- Core read/search interactions against the live `/api/*` server

Browser E2E tests use Playwright and spawn `frontdoc web` against a temporary
test repository initialized during the test.

## Key Test Invariants

1. MemoryVFS state is the ground truth -- read files back from VFS to verify
   writes.
2. Documents round-trip: parse -> build -> parse should produce equivalent
   results.
3. Validation errors should contain the field name and a human-readable
   explanation.
4. Search results should be deterministic for the same input data.
5. Config persistence should exclude defaults -- only user-customized values
   are written.
6. Every test document must be placed in a collection folder (top-level
   directory). No root-level documents.
7. Builder does not set a `type` field -- collection is always derived from
   the document's path.
