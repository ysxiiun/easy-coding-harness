# Business Memory

Durable business rules, product decisions, and domain context. Maintained by ec-memory
during MEMORY_LONG; entries are distilled from short memories whose `target_long` is
`business` or `both`.

Entry format — one `##` section per entry:

- Heading: `## BM-{NNN} {short title}`
- First line: `status: active` (active | deprecated | superseded | deleted)
- Body: the rule or decision, why it holds, and which tasks/files evidence it.

Conflict priority when distilling: current code > latest user confirmation > this round's
candidate > existing entries. Index every entry in MEMORY.md.
