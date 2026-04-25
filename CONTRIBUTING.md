# Contributing

Claude Self-Evolve uses a standard branch-and-PR workflow.

## Workflow

1. Start from an up-to-date `main` branch.
2. Create a topic branch:

   ```bash
   git switch -c codex/short-description
   ```

3. Make a focused change.
4. Run the relevant local checks. At minimum:

   ```bash
   node --check packages/claude-code/.claude/evolve.mjs
   ```

5. Commit with a short imperative message.
6. Push the branch and open a pull request.
7. Merge only after review.

## Scope

This project is project-local by design. Changes should preserve these constraints:

- do not install global Claude Code hooks
- do not share memory across projects
- preserve existing project hooks during install
- preserve `.evolve/` data unless the user explicitly resets it
- keep the runtime dependency-free beyond Node.js standard library

## Release Notes

PR descriptions should include:

- what changed
- why it changed
- user impact
- validation performed
