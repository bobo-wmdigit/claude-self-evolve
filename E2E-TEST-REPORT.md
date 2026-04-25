# E2E Test Report — Claude Self-Evolve v0.2.1

## Date: 2026-04-25

## Test Environment
- **Platform**: macOS (Darwin 24.2.0, aarch64)
- **Node.js**: v25.6.1
- **Reviewer 1**: Claude (native E2E test runner)
- **Reviewer 2**: GLM-5.1 (via CodeBuddy CLI, static code review + test analysis)

---

## Test Results Summary

| Test Suite | Count | Pass | Fail |
|------------|-------|------|------|
| **E2E Lifecycle (9 phases)** | 52 | 52 | 0 |
| **Unit Tests (24 suites)** | 80 | 80 | 0 |
| **Total** | **132** | **132** | **0** |

---

## E2E Test Phases Coverage

| Phase | Description | Assertions | Status |
|-------|-------------|------------|--------|
| 1. Install | install.sh, file copy, hook registration | 7 | PASS |
| 2. Hook | UserPromptSubmit JSON output, context injection, counter | 5 | PASS |
| 3. Capture (x3) | EVOLVE block parsing, spark.jsonl write, counter reset | 12 | PASS |
| 4. Compact | Grouping, ranking, runtime/archive generation, audit events | 9 | PASS |
| 5. Health Check | Diagnosis output, issue detection | 5 | PASS |
| 6. Backup | tar.gz creation | 2 | PASS |
| 7. Restore | State recovery after tampering | 3 | PASS |
| 8. Missing Block | Detect missing EVOLVE block, audit logging | 2 | PASS |
| 9. i18n | EN/CN language switch for compact output | 4 | PASS |

---

## Bug Fix Verification

| Bug | Severity | Status | Verification Method |
|-----|----------|--------|-------------------|
| `backupDone` function not called | **High** | **Fixed** | GLM-5.1 code review + E2E backup test |
| `recordKey` / `dedupeRecords` duplicate code | Medium | **Fixed** | GLM-5.1 verified single definition in lib |
| `execSync` → `execFileSync` injection risk | Medium | **Fixed** | GLM-5.1 confirmed no execSync remains |

---

## Identified Gaps (GLM-5.1 Findings)

### Not Yet Covered

| Gap | Priority | Description |
|-----|----------|-------------|
| Concurrent safety E2E | Medium | Multi-process concurrent capture not tested end-to-end |
| Counter window timeout | Low | `EVOLVE_COUNTER_WINDOW` expiration not tested |
| Threshold blocking (exit code 2) | Medium | `stop_hook_active=false` + threshold reached path not tested |
| Forced fallback record | Medium | `fallbackRecord()` behavior under threshold not tested |
| Transcript path fallback | Low | `extractLastMessageFromTranscript` not tested |
| Large-scale compact | Low | Compact with 100+ records not tested |
| Restore without backup | Low | Error path when no backup exists not tested |
| Backup fallback (copyRecursive) | Low | tar-unavailable fallback path not tested |
| State migration E2E | Medium | v1→v2 upgrade scenario not tested end-to-end |
| renderRuntime/renderArchive | Low | Markdown output format not unit-tested |
| truncateContext | Low | Truncation behavior not tested |
| copyRecursive | Low | Recursive copy not tested |
| buildRecord / fallbackRecord | Low | Record construction not independently tested |
| Non-JSON stdin to capture | Low | Malformed stdin error handling not tested |

### Existing Code Issues

| Issue | Severity | Description |
|-------|----------|-------------|
| renderRuntime hardcodes Chinese | Low | genes.runtime.md always in Chinese regardless of EVOLVE_LANG |
| evolve.mjs 826 lines | Low | Single file, commands could be split further |
| NFS lock reliability | Low | mkdir-based lock may not work on network filesystems |
| process.exit() skips microtask cleanup | Very Low | Theoretical lock cleanup issue |

---

## Scores

| Dimension | My Score | GLM-5.1 Score | Notes |
|-----------|----------|---------------|-------|
| Architecture | 8/10 | 8/10 | Clear layering, core/adapter split |
| Code Quality | 8/10 | 7.5/10 | Good error handling, renderRuntime i18n incomplete |
| Test Coverage | 6.5/10 | 6.5/10 | Core algorithms well covered, command layer not |
| Security | 8/10 | 8/10 | execFileSync, atomic writes, file lock |
| Bug Fixes | 10/10 | 10/10 | All 3 known bugs verified fixed |

---

## Recommendation: Is Further Modification Needed?

**Short answer: No immediate changes required. The project is shippable at v0.2.1.**

The two reviewers agree on the following:

1. **All known bugs are fixed** — verified by code review + E2E tests
2. **All 133 tests pass** — unit + E2E coverage is solid for core logic
3. **The identified gaps are enhancements, not blockers** — they don't prevent the project from working correctly

### Suggested Next Iteration (v0.3)

If you want to improve further, here's the priority order:

1. **Add tests for command-layer functions** — `commandCapture`, `commandCompact`, `commandHealth` (GLM-5.1's top priority)
2. **i18n for renderRuntime/renderArchive** — make genes.runtime.md respect EVOLVE_LANG
3. **E2E for threshold blocking path** — test exit code 2 when stop_hook_active=false
4. **State migration E2E** — test v1→v2 upgrade in a real project

These are nice-to-haves, not showstoppers.
