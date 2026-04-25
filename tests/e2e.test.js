#!/usr/bin/env node
/**
 * E2E Test: Full lifecycle from install → capture → compact → restore
 *
 * Simulates the entire Claude Self-Evolve workflow:
 * 1. Create a test project
 * 2. Install self-evolve
 * 3. Simulate hook (UserPromptSubmit)
 * 4. Simulate capture (Stop hook with EVOLVE block)
 * 5. Trigger compact
 * 6. Verify genes.runtime.md content
 * 7. Test backup
 * 8. Test restore
 * 9. Test health check
 * 10. Cleanup
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROJECT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "evolve-e2e-"));

let passCount = 0;
let failCount = 0;
const results = [];

function assert(condition, message) {
  if (condition) {
    passCount += 1;
    results.push({ status: "PASS", message });
    console.log(`  ✓ ${message}`);
  } else {
    failCount += 1;
    results.push({ status: "FAIL", message });
    console.log(`  ✗ ${message}`);
  }
}

function runEvolve(command, env = {}) {
  const result = spawnSync("node", [
    path.join(PROJECT_DIR, ".claude/evolve.mjs"),
    command,
    "--project-dir",
    PROJECT_DIR,
  ], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT_DIR, EVOLVE_LANG: "en", ...env },
    encoding: "utf8",
    timeout: 10000,
  });
  return result;
}

function installSelfEvolve() {
  const result = spawnSync("bash", [
    path.join(ROOT, "install.sh"),
    PROJECT_DIR,
  ], { encoding: "utf8", timeout: 10000 });
  return result;
}

// ── Phase 1: Install ─────────────────────────────────────────────

console.log("\n=== Phase 1: Install ===");
fs.writeFileSync(path.join(PROJECT_DIR, "CLAUDE.md"), "# Test Project\n");
const installResult = installSelfEvolve();
assert(installResult.status === 0, "install.sh exits with code 0");
assert(fs.existsSync(path.join(PROJECT_DIR, ".claude/evolve.mjs")), "evolve.mjs copied");
assert(fs.existsSync(path.join(PROJECT_DIR, ".claude/lib/evolve-core.js")), "lib/evolve-core.js copied");
assert(fs.existsSync(path.join(PROJECT_DIR, ".evolve/state.json")), "state.json initialized");
assert(fs.existsSync(path.join(PROJECT_DIR, ".evolve/spark.jsonl")), "spark.jsonl initialized");

const settingsPath = path.join(PROJECT_DIR, ".claude/settings.local.json");
const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
assert(settings.hooks.UserPromptSubmit, "UserPromptSubmit hook registered");
assert(settings.hooks.Stop, "Stop hook registered");

// ── Phase 2: Hook (UserPromptSubmit) ─────────────────────────────

console.log("\n=== Phase 2: Hook (UserPromptSubmit) ===");
const hookResult = runEvolve("hook");
assert(hookResult.status === 0, "hook exits with code 0");

const hookOutput = JSON.parse(hookResult.stdout);
assert(hookOutput.hookSpecificOutput.hookEventName === "UserPromptSubmit",
  "hook outputs correct hookEventName");
assert(hookOutput.hookSpecificOutput.additionalContext.includes("[自进化状态]")
    || hookOutput.hookSpecificOutput.additionalContext.includes("[evolve] state"),
  "hook injects state context");
assert(hookOutput.hookSpecificOutput.additionalContext.includes("EVOLVE"),
  "hook injects EVOLVE protocol");

// Verify counter incremented
const state = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, ".evolve/state.json"), "utf8"));
assert(state.counter === 1, "counter incremented to 1");

// ── Phase 3: Multiple hooks + Capture ─────────────────────────────

console.log("\n=== Phase 3: Capture with EVOLVE block ===");

// Simulate 3 rounds of hook + capture
for (let round = 1; round <= 3; round += 1) {
  runEvolve("hook");

  const captureInput = {
    last_assistant_message: `Round ${round}: learned something important.\n[EVOLVE]{"record":"yes","title":"Round ${round} lesson","type":"engineering-rule","scenario":"always","lesson":"Lesson from round ${round}","action":"Apply round ${round} fix","confidence":"high"}[/EVOLVE]`,
    stop_hook_active: true,
    session_id: "test-session",
  };

  const captureResult = spawnSync("node", [
    path.join(PROJECT_DIR, ".claude/evolve.mjs"),
    "capture",
    "--project-dir",
    PROJECT_DIR,
  ], {
    input: JSON.stringify(captureInput),
    encoding: "utf8",
    timeout: 10000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT_DIR, EVOLVE_LANG: "en" },
  });

  assert(captureResult.status === 0, `capture round ${round} succeeds`);

  const sparkFile = fs.readFileSync(path.join(PROJECT_DIR, ".evolve/spark.jsonl"), "utf8");
  const sparkLines = sparkFile.split("\n").filter(l => l.trim());
  assert(sparkLines.length === round, `spark.jsonl has ${round} record(s)`);

  const sparkState = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, ".evolve/state.json"), "utf8"));
  assert(sparkState.counter === 0, `counter reset after round ${round}`);
}

// Verify spark records are valid JSON
const sparkContent = fs.readFileSync(path.join(PROJECT_DIR, ".evolve/spark.jsonl"), "utf8");
for (const line of sparkContent.split("\n").filter(l => l.trim())) {
  const record = JSON.parse(line);
  assert(record.source.hook === "Stop", `record has correct hook source`);
  assert(record.confidence === "high", `record has high confidence`);
}

// ── Phase 4: Compact (threshold trigger) ─────────────────────────

console.log("\n=== Phase 4: Compact ===");

// Write 5 more records to trigger auto-compact (threshold is 5)
for (let i = 0; i < 5; i += 1) {
  runEvolve("hook");
  const captureInput = {
    last_assistant_message: `Extra round ${i}.\n[EVOLVE]{"record":"yes","title":"Extra lesson ${i % 3}","type":"engineering-rule","scenario":"always","lesson":"Extra lesson ${i}","action":"Fix ${i}","confidence":"medium"}[/EVOLVE]`,
    stop_hook_active: true,
    session_id: "test-session",
  };
  spawnSync("node", [
    path.join(PROJECT_DIR, ".claude/evolve.mjs"),
    "capture",
    "--project-dir",
    PROJECT_DIR,
  ], {
    input: JSON.stringify(captureInput),
    encoding: "utf8",
    timeout: 10000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT_DIR, EVOLVE_LANG: "en" },
  });
}

// Manual compact
const compactResult = runEvolve("compact");
assert(compactResult.status === 0, "compact exits with code 0");
assert(compactResult.stdout.includes("compact done"), "compact outputs result");

// Verify genes.runtime.md was generated
const runtimeContent = fs.readFileSync(path.join(PROJECT_DIR, ".evolve/genes.runtime.md"), "utf8");
assert(runtimeContent.includes("# GENES Runtime"), "runtime file has header");
assert(runtimeContent.includes("##"), "runtime file has gene entries");

// Verify genes.archive.md was generated
const archiveContent = fs.readFileSync(path.join(PROJECT_DIR, ".evolve/genes.archive.md"), "utf8");
assert(archiveContent.includes("# GENES Archive"), "archive file has header");

// Verify audit events were written
const auditContent = fs.readFileSync(path.join(PROJECT_DIR, ".evolve/audit.jsonl"), "utf8");
assert(auditContent.includes("compact_run"), "audit contains compact_run event");
assert(auditContent.includes("promote_to_runtime") || auditContent.includes("move_to_archive"),
  "audit contains promotion or archival events");

// Verify state updated
const finalState = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, ".evolve/state.json"), "utf8"));
assert(finalState.last_compact_at > 0, "last_compact_at updated");
assert(finalState.runtime_gene_count > 0, "runtime_gene_count > 0");

// ── Phase 5: Health Check ────────────────────────────────────────

console.log("\n=== Phase 5: Health Check ===");
const healthResult = runEvolve("health");
assert(healthResult.status === 0, "health exits with code 0");
const healthOutput = JSON.parse(healthResult.stdout);
assert(Array.isArray(healthOutput.issues), "health outputs issues array");
assert(healthOutput.issues.length === 0, `health reports no issues (got: ${JSON.stringify(healthOutput.issues)})`);
assert(healthOutput.installed_version !== "unknown", "health shows installed version");
assert(healthOutput.runtime_gene_count > 0, "health shows runtime gene count");

// ── Phase 6: Backup ──────────────────────────────────────────────

console.log("\n=== Phase 6: Backup ===");
const backupResult = runEvolve("backup");
assert(backupResult.status === 0, "backup exits with code 0");

// Check backup file exists
const backupFiles = fs.readdirSync(PROJECT_DIR)
  .filter(f => f.startsWith("evolve-backup-") && f.endsWith(".tar.gz"));
assert(backupFiles.length > 0, "backup tar.gz file created");

// ── Phase 7: Restore ─────────────────────────────────────────────

console.log("\n=== Phase 7: Restore ===");
// Modify state to prove restore works
const modifiedState = { ...finalState, counter: 999 };
fs.writeFileSync(path.join(PROJECT_DIR, ".evolve/state.json"), JSON.stringify(modifiedState, null, 2));
const preRestoreState = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, ".evolve/state.json"), "utf8"));
assert(preRestoreState.counter === 999, "state modified before restore");

const restoreResult = runEvolve("restore");
assert(restoreResult.status === 0, "restore exits with code 0");

const postRestoreState = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, ".evolve/state.json"), "utf8"));
assert(postRestoreState.counter !== 999, "state restored (counter reset from 999)");

// ── Phase 8: Missing EVOLVE block detection ──────────────────────

console.log("\n=== Phase 8: Missing EVOLVE block ===");
runEvolve("hook");
const missingBlockInput = {
  last_assistant_message: "Just a normal reply with no EVOLVE block.",
  stop_hook_active: true,
  session_id: "test-session",
};
const missingResult = spawnSync("node", [
  path.join(PROJECT_DIR, ".claude/evolve.mjs"),
  "capture",
  "--project-dir",
  PROJECT_DIR,
], {
  input: JSON.stringify(missingBlockInput),
  encoding: "utf8",
  timeout: 10000,
  env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT_DIR, EVOLVE_LANG: "en" },
});

// Should succeed but log a warning
assert(missingResult.status === 0, "capture without EVOLVE block exits 0 (stop_hook_active)");
// Check audit for missing_evolve_block event
const auditAfterMissing = fs.readFileSync(path.join(PROJECT_DIR, ".evolve/audit.jsonl"), "utf8");
assert(auditAfterMissing.includes("missing_evolve_block"), "audit logs missing_evolve_block event");

// ── Phase 9: i18n ────────────────────────────────────────────────

console.log("\n=== Phase 9: i18n ===");
// English mode
const enResult = runEvolve("compact", { EVOLVE_LANG: "en" });
assert(enResult.status === 0, "compact in English mode");
assert(enResult.stdout.includes("compact done"), "English output contains 'compact done'");

// Chinese mode (default)
const zhResult = runEvolve("compact", { EVOLVE_LANG: "zh" });
assert(zhResult.status === 0, "compact in Chinese mode");
assert(zhResult.stdout.includes("compact 完成"), "Chinese output contains 'compact 完成'");

// ── Summary ──────────────────────────────────────────────────────

console.log("\n" + "=".repeat(60));
console.log(`E2E Test Results: ${passCount} passed, ${failCount} failed, ${passCount + failCount} total`);
console.log("=".repeat(60));

if (failCount > 0) {
  console.log("\nFailures:");
  for (const r of results) {
    if (r.status === "FAIL") console.log(`  ✗ ${r.message}`);
  }
}

// Cleanup
try {
  execFileSync("rm", ["-rf", PROJECT_DIR]);
} catch {
  // ignore
}

process.exit(failCount > 0 ? 1 : 0);
