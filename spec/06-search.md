# tmdoc Specification: Search

## Search Engine

The search engine supports two modes, unified behind a single entry point.

### Unified Search

`UnifiedSearch(query) -> [SearchResult]`

1. Parse the query string into expressions.
2. If any expression has a field name (structured query), delegate to
   QuerySearch.
3. Otherwise, delegate to ScoredFullTextSearch.

### Structured Query Search

`QuerySearch(query) -> [DocumentRecord]`

Finds documents matching all query expressions (AND logic). Templates are
excluded from results.

For each document, every expression must pass:

- **Field expressions** (e.g. `collection:clients`): evaluate against the
  document's metadata or virtual fields.
- **Text expressions** (no field): search in content, then in `title` field,
  then in `name` field. If found anywhere, the expression passes.

The `collection` field is a virtual field: it is not stored in metadata but
is derived from the document's path (first path segment). Querying
`collection:clients` matches all documents whose path starts with `clients/`.

Returns documents wrapped in SearchResult with score 1.0 (all matches are
equal for structured queries).

### Full-Text Search

`ScoredFullTextSearch(query) -> [SearchResult]`

Scans all documents (excluding templates) and scores each one:

**Scoring algorithm**:

Scoring uses relative priority tiers. Higher tiers dominate lower tiers:

| Priority | Component                | Condition                                           |
|----------|--------------------------|-----------------------------------------------------|
| 1 (highest) | Exact match in title/name | `title` or `name` field equals the full query (case-insensitive) |
| 2        | Exact match in metadata  | Full query appears in a metadata string field       |
| 3        | Filename match           | File path contains the full query                   |
| 4        | Content exact match      | Full query appears in content (case-insensitive)    |
| 5        | Prefix/word matches      | Query words found as prefixes or substrings in metadata or content |
| 6 (lowest) | Partial word matches    | Individual query words found in content             |

Within the same tier, results are ordered by number of matching fields/
occurrences. Across tiers, a match in a higher tier always outranks any
number of matches in lower tiers.

Content exact matches also record the matching lines. Metadata exact matches
record which field matched.

Documents with score > 0 are included. Results are sorted by tier (highest
first), then by match count within tier, then by creation date (newest
first) as the final tiebreaker.

### Top Result Disambiguation

`GetTopResult(query) -> (topResult, ambiguousResults)`

Used by commands that need a single document (e.g. `open`, `read`):

1. Run UnifiedSearch.
2. If 0 results: return nil, nil.
3. If 1 result: return it as the top result.
4. If the top result is in a strictly higher tier than the second result:
   return top as unambiguous.
5. Otherwise, collect all results in the same tier as the top result as
   "ambiguous" and return them for the user to choose from.

When multiple results have the same score and tier, the tiebreaker is
creation date (newest first, based on ULID ordering).

### Search Result

A SearchResult contains:

- `Document` (DocumentRecord) -- the matched document
- `Matches` (list of Match) -- where the query matched
- `Score` (float) -- relevance score

A Match contains:

- `Field` (string) -- "content" or a metadata field name
- `Context` (string) -- the matching text/line
- `Line` (int) -- line number (for content matches)

## Query Language

### Syntax

A query string is split on whitespace (respecting quoted values). Each token
is parsed as an expression.

### Expression Types

**Field expressions** (contain an operator):

```
field:value     -- equals (case-insensitive)
field=value     -- equals
field!=value    -- not equals
field>value     -- greater than
field<value     -- less than
field>=value    -- greater than or equal
field<=value    -- less than or equal
```

The `:` and `=` operators are equivalent.

**Text expressions** (no operator found):

Treated as a full-text search term with operator "contains".

### Value Parsing

Values are parsed in this order:

1. If quoted with `"` or `'`, treat as string (quotes stripped).
2. If parseable as float64, treat as number.
3. If parseable as boolean (`true`/`false`), treat as boolean.
4. Otherwise, treat as string.

### Operator Evaluation

**Equality** (`:`/`=`):
- String comparison is case-insensitive.
- For comma-separated values in metadata (e.g. `tags = "api,rest,docs"`),
  each part is checked individually.
- Numeric values compared as float64.

**Comparison** (`>`, `<`, `>=`, `<=`):
- If both values are numeric, compare as float64.
- If both are strings, compare lexicographically.

### Query Splitting

Whitespace splits tokens, but quoted segments are preserved:

- `collection:clients status:active` -> two expressions
- `name:"John Doe"` -> one expression with value "John Doe"
- `kubernetes migration` -> two text search expressions
