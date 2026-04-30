/**
 * P0-P3 Integration Verification Tests
 * Run: node --test tests/p0-fixes.test.js
 */
import test, { describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { migrateStateChain, parseJsonl, summarizeRecords, DECAY_RATE } from "../packages/claude-code/.claude/lib/evolve-core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

describe("P0-1: CLAUDE-EVOLVE-MD.md must not be empty", () => {
  test("file exists and contains EVOLVE protocol", () => {
    const filePath = path.join(ROOT, "packages/claude-code/CLAUDE-EVOLVE-MD.md");
    assert.ok(fs.existsSync(filePath), "CLAUDE-EVOLVE-MD.md must exist");
    const content = fs.readFileSync(filePath, "utf8");
    assert.ok(content.length > 50, `file should have meaningful content, got ${content.length} chars`);
    assert.ok(content.includes("[EVOLVE]"), "must contain EVOLVE block example");
    assert.ok(content.includes("record"), "must contain record field docs");
    assert.ok(content.includes("confidence"), "must contain confidence field docs");
    assert.ok(content.includes("自进化机制"), "must contain Chinese section header");
  });

  test("install.sh upgrades legacy CLAUDE.md instructions with runtime markers", () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "evolve-legacy-install-"));
    fs.writeFileSync(path.join(projectDir, "CLAUDE.md"), [
      "# Existing Project",
      "",
      "## 自进化机制（/.evolve/）",
      "",
      "旧版说明，没有 runtime marker。",
      "",
      "## User Notes",
      "",
      "Keep this section.",
      "",
    ].join("\n"), "utf8");

    const result = spawnSync("bash", [path.join(ROOT, "install.sh"), projectDir], {
      encoding: "utf8",
      timeout: 10000,
    });

    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const content = fs.readFileSync(path.join(projectDir, "CLAUDE.md"), "utf8");
    assert.ok(content.includes("<!-- EVOLVE-RUNTIME-BEGIN -->"));
    assert.ok(content.includes("<!-- EVOLVE-RUNTIME-END -->"));
    assert.ok(content.includes("## User Notes"));
    assert.ok(content.includes("Keep this section."));
    assert.strictEqual(content.match(/## 自进化机制（\/.evolve\/）/g)?.length, 1);
  });
});

describe("P0-2: Migration chain framework", () => {
  test("migrateStateChain function is exported", () => {
    assert.ok(typeof migrateStateChain === "function");
  });

  test("evolve.mjs imports from lib/evolve-core.js", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "packages/claude-code/.claude/evolve.mjs"),
      "utf8",
    );
    assert.ok(
      source.includes('from "./lib/evolve-core.js"'),
      "evolve.mjs must import from lib/evolve-core.js",
    );
  });
});

describe("P0-3: ensureLayout inside withLock", () => {
  test("commandCapture calls ensureLayout inside withLock", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "packages/claude-code/.claude/evolve.mjs"),
      "utf8",
    );
    const captureMatch = source.match(
      /async function commandCapture[\s\S]*?await withLock\(paths, async \(\) => \{[\s\S]*?ensureLayout\(paths\)/,
    );
    assert.ok(captureMatch !== null, "commandCapture must call ensureLayout inside withLock");
  });

  test("updatePromptState calls ensureLayout inside withLock", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "packages/claude-code/.claude/evolve.mjs"),
      "utf8",
    );
    const updateMatch = source.match(
      /async function updatePromptState[\s\S]*?return withLock\(paths, async \(\) => \{[\s\S]*?ensureLayout\(paths\)/,
    );
    assert.ok(updateMatch !== null, "updatePromptState must call ensureLayout inside withLock");
  });
});

describe("P1: JSONL corruption tolerance", () => {
  test("evolve.mjs uses parseJsonl with skipInvalid", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "packages/claude-code/.claude/evolve.mjs"),
      "utf8",
    );
    assert.ok(
      source.includes("skipInvalid: true"),
      "loadJsonlRecords must use skipInvalid: true",
    );
  });

  test("lib parseJsonl handles corrupted lines", () => {
    const text = '{"id":1}\n{bad json\n{"id":2}\n';
    const records = parseJsonl(text);
    assert.strictEqual(records.length, 2);
  });
});

describe("P1: Stale lock detection", () => {
  test("evolve.mjs has PID-based stale lock detection", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "packages/claude-code/.claude/evolve.mjs"),
      "utf8",
    );
    assert.ok(source.includes("process.kill(pid, 0)"), "must check PID liveness");
    assert.ok(source.includes("LOCK_STALE_TTL"), "must have TTL constant");
  });
});

describe("P2-1: Time decay in ranking", () => {
  test("evolve-core.js exports DECAY_RATE", () => {
    assert.ok(typeof DECAY_RATE === "number");
    assert.ok(DECAY_RATE > 0);
  });

  test("summarizeRecords accepts nowEpochMs option", () => {
    const records = [{ time: "2025-01-01 10:00:00", title: "Rule", type: "t", action: "a", scenario: "s", lesson: "l", confidence: "high" }];
    const [runtime] = summarizeRecords(records, 12, { nowEpochMs: Date.now() });
    assert.ok(typeof runtime[0].score === "number");
  });
});

describe("P2-2: Missing EVOLVE block detection", () => {
  test("evolve.mjs logs missing_evolve_block audit event", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "packages/claude-code/.claude/evolve.mjs"),
      "utf8",
    );
    assert.ok(
      source.includes('"missing_evolve_block"'),
      "capture must log missing_evolve_block audit event",
    );
  });

  test("hook adds reminder when counter is halfway", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "packages/claude-code/.claude/evolve.mjs"),
      "utf8",
    );
    assert.ok(
      source.includes("Math.ceil(threshold / 2)"),
      "hook must check for halfway counter",
    );
  });
});

describe("P2-3: JSDoc types", () => {
  test("lib/evolve-core.js has JSDoc annotations", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "packages/claude-code/.claude/lib/evolve-core.js"),
      "utf8",
    );
    assert.ok(source.includes("@param"), "must have @param annotations");
    assert.ok(source.includes("@returns"), "must have @returns annotations");
    assert.ok(source.includes("@typedef"), "must have @typedef annotations");
  });
});

describe("P3-2: i18n language switch", () => {
  test("evolve.mjs has EVOLVE_LANG env var support", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "packages/claude-code/.claude/evolve.mjs"),
      "utf8",
    );
    assert.ok(source.includes("EVOLVE_LANG"), "must have EVOLVE_LANG support");
    assert.ok(source.includes("function t(key)"), "must have t() translation function");
  });

  test("runtime messages use translation function", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "packages/claude-code/.claude/evolve.mjs"),
      "utf8",
    );
    assert.ok(source.includes('t("prefix")'), "must use t('prefix')");
    assert.ok(source.includes("evolveDone"), "must have evolveDone translation");
    assert.ok(source.includes("compactDone"), "must keep compactDone translation");
    assert.ok(source.includes('t("missingFile")'), "must use t('missingFile')");
  });

  test("install.sh copies lib/evolve-core.js", () => {
    const source = fs.readFileSync(path.join(ROOT, "install.sh"), "utf8");
    assert.ok(source.includes("evolve-core.js"),
      "install.sh must copy lib/evolve-core.js");
  });
});

describe("P3-3: Backup/restore commands", () => {
  test("evolve.mjs supports backup and restore commands", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "packages/claude-code/.claude/evolve.mjs"),
      "utf8",
    );
    assert.ok(
      source.includes('"backup"') && source.includes('"restore"'),
      "parseArgs must accept backup and restore commands",
    );
    assert.ok(source.includes("function commandBackup"), "must have commandBackup function");
    assert.ok(source.includes("function commandRestore"), "must have commandRestore function");
  });
});

describe("CLI naming", () => {
  test("evolve is the primary manual aggregation command and compact remains compatible", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "packages/claude-code/.claude/evolve.mjs"),
      "utf8",
    );
    assert.ok(source.includes('"evolve"'), "parseArgs must accept evolve");
    assert.ok(source.includes('"compact"'), "parseArgs must keep compact alias");
    assert.ok(source.includes("function commandEvolve"), "must expose commandEvolve");
  });

  test("installer copies primary evolve.sh and legacy evolve-compact.sh", () => {
    const source = fs.readFileSync(path.join(ROOT, "install.sh"), "utf8");
    assert.ok(source.includes("evolve.sh"), "install.sh must copy evolve.sh");
    assert.ok(source.includes("evolve-compact.sh"), "install.sh must keep legacy wrapper");
  });
});
