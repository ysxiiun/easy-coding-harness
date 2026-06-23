# Memory Migration Procedure

> Loaded by ec-init when old-format memory is detected during initialization.
> Migration scope is strictly `.easy-coding/memory/` — never modify business code, specs, or other project files.

## Trigger Conditions

Any ONE of the following triggers automatic migration during ec-init (no user confirmation
needed — migration is part of initialization, not a separate decision):

1. `.easy-coding/memory/long/MEMORY.md` exists but lacks `memory_schema: 2` in its frontmatter
2. `.easy-coding/memory/long/BUSINESS.md` is missing
3. `.easy-coding/memory/long/TECHNICAL.md` is missing
4. `.easy-coding/memory/short/*.md` files exist that lack YAML frontmatter or have `memory_schema != 2`
5. `MEMORY.md` is still old-format long-form prose rather than a schema-2 index/navigation file

## Migration Principles

1. Migration executes automatically as part of ec-init. Inform the user what was detected and what will be migrated, but do not ask for confirmation — the user already triggered initialization.
2. Old long-term memory content must not be discarded — migrate it to `BUSINESS.md`, `TECHNICAL.md`, the new index, or deprecated records.
3. Old short-term memories are NOT converted to new format first. All old short memories participate in a single batch settlement.
4. After successful migration, delete all processed old short-term files. New schema-2 short memories then follow the sliding window rules.
5. If old and new content conflict, trust current code and user's latest statement. Old content goes to the "Deprecated Records" section of the appropriate file.
6. The migration process must output an audit summary listing what was identified, migrated, deleted, and not distilled.
7. Migration is a one-time operation, not incremental.

## Old Long-Term Memory Split Rules

Read the old `.easy-coding/memory/long/MEMORY.md` and split content by topic. **Also read
`BUSINESS.md` and `TECHNICAL.md` if they already exist** — they may contain entries from
prior usage. Merge existing entries with newly split content; do not overwrite or discard
entries already present in these files.

**→ BUSINESS.md:**
- Business rules, field semantics, business workflows, state transitions
- Upstream/downstream contracts, business troubleshooting experience

**→ TECHNICAL.md:**
- Architecture decisions, interface decisions, tech selections
- Engineering rules, implementation patterns
- Pitfalls and fix strategies, verification/release/installation experience

**→ Deprecated Records:**
- Expired content, content superseded by current code, content conflicting with user's latest statement

After splitting, rewrite `MEMORY.md` as a `memory_schema: 2` index containing only: Topic, Type, Keywords, Detail File, Status, Last Updated, Source.

## Old Short-Term Memory Batch Settlement

Read `.easy-coding/memory/short/*.md`:

- Files lacking YAML frontmatter, or with `memory_schema != 2`, are treated as old-format
- Do NOT require old short memories to first gain new frontmatter — settle them as-is
- ALL old short memories participate in one batch, even if fewer than 10 (to prevent re-triggering migration)
- Stable sorting order:
  1. By frontmatter `date` ascending
  2. If date is missing, unparseable, or tied → by filename prefix number ascending
  3. Still tied → by filename ascending
- Classify all old short memories by content into: business candidates, technical candidates, non-distillation content
- Write results to `BUSINESS.md` / `TECHNICAL.md`
- Update `MEMORY.md` index with sources
- After success, delete all processed old short files

**Content that does NOT enter long-term memory:**
- Routine file modification lists
- One-time task logs
- Temporary logs, temp order numbers, one-time mock data
- Implementation details with no reuse value

## Migration Audit Output

```markdown
### Memory Migration Complete

- Old-format files identified: {file list}
- Business topics migrated: {topic list; "none" if none}
- Technical topics migrated: {topic list; "none" if none}
- Old short memories deleted: {file list; "none" if none}
- Non-distilled content and reasons: {summary; "none" if none}
- Conflict handling: {old content deprecated / new content adopted / no conflicts}

Proceeding with new memory structure.
```

## Return

After migration completes, return to ec-init's normal flow. Background data should be re-loaded using the new three-file memory structure.
