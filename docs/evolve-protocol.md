# EVOLVE Protocol

Every Claude response should end with one standalone EVOLVE block.

## Useful Record

```text
[EVOLVE]{"record":"yes","title":"Short stable title","type":"engineering-rule","scenario":"When this applies","lesson":"What was learned","action":"What to do next time","confidence":"high"}[/EVOLVE]
```

Required fields for `record=yes`:

- `title`
- `type`
- `scenario`
- `lesson`
- `action`
- `confidence`

`confidence` must be `low`, `medium`, or `high`.

## Routine Turn

```text
[EVOLVE]{"record":"no","reason":"routine turn"}[/EVOLVE]
```

`record=no` is allowed only while the local counter is below `EVOLVE_THRESHOLD`.

## Good Records

Prefer recording:

- user corrections
- recurring failure modes
- stable project constraints
- installation or migration lessons
- commands or workflows that should be reused

Skip ordinary Q&A and one-off facts unless they change future behavior.
