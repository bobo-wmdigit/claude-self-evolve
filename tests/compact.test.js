/**
 * Compact / ranking algorithm tests
 * Run: node --test tests/compact.test.js
 */
import test, { describe, before } from "node:test";
import assert from "node:assert";
import { summarizeRecords, buildAuditEvents, extractGeneTitles, renderProtocol, renderProtocolEn, renderProtocolZh, DECAY_RATE } from "../packages/claude-code/.claude/lib/evolve-core.js";

const FIXED_NOW = Date.parse("2025-01-15T10:00:00Z");

describe("summarizeRecords", () => {
  test("empty records returns two empty arrays", () => {
    const [runtime, archive] = summarizeRecords([], 12, { nowEpochMs: FIXED_NOW });
    assert.deepStrictEqual(runtime, []);
    assert.deepStrictEqual(archive, []);
  });

  test("single record goes to runtime", () => {
    const records = [
      {
        time: "2025-01-01 10:00:00",
        title: "Test rule",
        type: "engineering-rule",
        scenario: "always",
        lesson: "test",
        action: "test",
        confidence: "high",
      },
    ];
    const [runtime, archive] = summarizeRecords(records, 12, { nowEpochMs: FIXED_NOW });
    assert.strictEqual(runtime.length, 1);
    assert.strictEqual(runtime[0].title, "Test rule");
    assert.strictEqual(archive.length, 0);
  });

  test("more records than limit splits runtime/archive", () => {
    const records = Array.from({ length: 5 }, (_, i) => ({
      time: `2025-01-01 10:00:0${i}`,
      title: `Rule ${i}`,
      type: "engineering-rule",
      scenario: "test",
      lesson: "test",
      action: "test",
      confidence: "high",
    }));
    const [runtime, archive] = summarizeRecords(records, 3, { nowEpochMs: FIXED_NOW });
    assert.strictEqual(runtime.length, 3);
    assert.strictEqual(archive.length, 2);
  });

  test("duplicate type+title+action are grouped and counted", () => {
    const records = [
      { time: "2025-01-01 10:00:00", title: "Test rule", type: "engineering-rule", action: "do something", scenario: "s", lesson: "l", confidence: "low" },
      { time: "2025-01-01 10:00:01", title: "Test Rule", type: "Engineering-Rule", action: "Do Something", scenario: "s2", lesson: "l2", confidence: "high" },
    ];
    const [runtime, archive] = summarizeRecords(records, 12, { nowEpochMs: FIXED_NOW });
    // Case-insensitive grouping should produce 1 entry with count=2
    assert.strictEqual(runtime.length, 1);
    assert.strictEqual(runtime[0].count, 2);
    assert.strictEqual(runtime[0].confidence, "high");
    assert.strictEqual(archive.length, 0);
  });

  test("higher confidence record wins during group aggregation", () => {
    const records = [
      { time: "2025-01-01 10:00:00", title: "Rule", type: "t", action: "a", scenario: "s1", lesson: "l1", confidence: "low" },
      { time: "2025-01-01 10:00:01", title: "Rule", type: "t", action: "a", scenario: "s2", lesson: "l2", confidence: "high" },
    ];
    const [runtime] = summarizeRecords(records, 12, { nowEpochMs: FIXED_NOW });
    assert.strictEqual(runtime[0].confidence, "high");
    assert.strictEqual(runtime[0].lesson, "l2");
    assert.strictEqual(runtime[0].scenario, "s2");
  });

  test("higher count sorts before higher confidence", () => {
    const records = [
      { time: "2025-01-15 08:00:00", title: "Rare rule", type: "t", action: "a1", scenario: "s", lesson: "l", confidence: "high" },
      { time: "2025-01-15 08:00:00", title: "Frequent rule", type: "t", action: "a2", scenario: "s", lesson: "l", confidence: "low" },
      { time: "2025-01-15 08:00:00", title: "Frequent rule", type: "t", action: "a2", scenario: "s", lesson: "l", confidence: "low" },
      { time: "2025-01-15 08:00:00", title: "Frequent rule", type: "t", action: "a2", scenario: "s", lesson: "l", confidence: "low" },
      { time: "2025-01-15 08:00:00", title: "Frequent rule", type: "t", action: "a2", scenario: "s", lesson: "l", confidence: "low" },
    ];
    const [runtime] = summarizeRecords(records, 12, { nowEpochMs: FIXED_NOW });
    // Frequent (count=4, confidence=low=1, score=4) vs Rare (count=1, confidence=high=3, score=3)
    assert.strictEqual(runtime.length, 2);
    assert.strictEqual(runtime[0].title, "Frequent rule");
    assert.strictEqual(runtime[1].title, "Rare rule");
    assert.strictEqual(runtime[1].title, "Rare rule");
  });

  test("same count and confidence: more recent sorts first", () => {
    const records = [
      { time: "2025-01-01 08:00:00", title: "Old", type: "t", action: "a1", scenario: "s", lesson: "l", confidence: "high" },
      { time: "2025-01-01 12:00:00", title: "New", type: "t", action: "a2", scenario: "s", lesson: "l", confidence: "high" },
    ];
    const [runtime] = summarizeRecords(records, 12, { nowEpochMs: FIXED_NOW });
    assert.strictEqual(runtime[0].title, "New");
    assert.strictEqual(runtime[1].title, "Old");
  });

  test("different action creates separate entries", () => {
    const records = [
      { time: "2025-01-01 10:00:00", title: "Rule", type: "t", action: "do A", scenario: "s", lesson: "l", confidence: "high" },
      { time: "2025-01-01 10:00:01", title: "Rule", type: "t", action: "do B", scenario: "s", lesson: "l", confidence: "high" },
    ];
    const [runtime] = summarizeRecords(records, 12, { nowEpochMs: FIXED_NOW });
    assert.strictEqual(runtime.length, 2);
    assert.strictEqual(runtime[0].count, 1);
    assert.strictEqual(runtime[1].count, 1);
  });

  test("runtimeLimit=0 puts all records in archive", () => {
    const records = [
      { time: "2025-01-01 10:00:00", title: "Rule", type: "t", action: "a", scenario: "s", lesson: "l", confidence: "high" },
    ];
    const [runtime, archive] = summarizeRecords(records, 0, { nowEpochMs: FIXED_NOW });
    assert.strictEqual(runtime.length, 0);
    assert.strictEqual(archive.length, 1);
  });

  test("old frequent rule decays below new frequent rule", () => {
    const now = Date.parse("2025-01-15T10:00:00Z");
    // Old rule: count=3, high confidence, 10 days old
    const records = [
      { time: "2025-01-05 10:00:00", title: "Old frequent", type: "t", action: "a1", scenario: "s", lesson: "l", confidence: "high" },
      { time: "2025-01-05 10:00:00", title: "Old frequent", type: "t", action: "a1", scenario: "s", lesson: "l", confidence: "high" },
      { time: "2025-01-05 10:00:00", title: "Old frequent", type: "t", action: "a1", scenario: "s", lesson: "l", confidence: "high" },
      // New rule: count=3, high confidence, same day
      { time: "2025-01-15 09:00:00", title: "New frequent", type: "t", action: "a2", scenario: "s", lesson: "l", confidence: "high" },
      { time: "2025-01-15 09:00:00", title: "New frequent", type: "t", action: "a2", scenario: "s", lesson: "l", confidence: "high" },
      { time: "2025-01-15 09:00:00", title: "New frequent", type: "t", action: "a2", scenario: "s", lesson: "l", confidence: "high" },
    ];
    const [runtime] = summarizeRecords(records, 12, { nowEpochMs: now });
    // Same count and confidence, but Old decays by ~10 days
    assert.strictEqual(runtime.length, 2);
    assert.strictEqual(runtime[0].title, "New frequent");
    assert.ok(runtime[0].score > runtime[1].score, "new entry should have higher score due to decay");
  });

  test("entries have score field", () => {
    const records = [
      { time: "2025-01-01 10:00:00", title: "Rule", type: "t", action: "a", scenario: "s", lesson: "l", confidence: "high" },
    ];
    const [runtime] = summarizeRecords(records, 12, { nowEpochMs: FIXED_NOW });
    assert.ok(typeof runtime[0].score === "number", "entries should have a score field");
    assert.ok(runtime[0].score > 0, "score should be positive");
  });
});

describe("buildAuditEvents", () => {
  test("generates compact_run event with promotion tracking", () => {
    const beforeRuntime = new Set();
    const beforeArchive = new Set();
    const runtime = [{ title: "New Rule", score: 1 }];
    const archive = [];
    const events = buildAuditEvents(beforeRuntime, beforeArchive, runtime, archive, 5, "2025-01-01");

    assert.strictEqual(events.length, 2); // compact_run + promote
    assert.strictEqual(events[0].event, "compact_run");
    assert.deepStrictEqual(events[0].promoted_titles, ["New Rule"]);
    assert.strictEqual(events[1].event, "promote_to_runtime");
    assert.strictEqual(events[1].title, "New Rule");
  });

  test("generates drop_gene event when title disappears", () => {
    const beforeRuntime = new Set(["Old Rule"]);
    const beforeArchive = new Set();
    const runtime = [];
    const archive = [];
    const events = buildAuditEvents(beforeRuntime, beforeArchive, runtime, archive, 5, "2025-01-01");

    assert.strictEqual(events.length, 2); // compact_run + drop
    assert.deepStrictEqual(events[0].dropped_titles, ["Old Rule"]);
    assert.strictEqual(events[1].event, "drop_gene");
    assert.strictEqual(events[1].title, "Old Rule");
  });

  test("generates move_to_archive event", () => {
    const beforeRuntime = new Set();
    const beforeArchive = new Set();
    const runtime = [];
    const archive = [{ title: "Archived Rule", score: 0 }];
    const events = buildAuditEvents(beforeRuntime, beforeArchive, runtime, archive, 5, "2025-01-01");

    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[1].event, "move_to_archive");
  });

  test("no events when nothing changed", () => {
    const beforeRuntime = new Set(["Rule"]);
    const beforeArchive = new Set(["Old"]);
    const runtime = [{ title: "Rule", score: 1 }];
    const archive = [{ title: "Old", score: 0 }];
    const events = buildAuditEvents(beforeRuntime, beforeArchive, runtime, archive, 5, "2025-01-01");

    assert.strictEqual(events.length, 1); // only compact_run
    assert.strictEqual(events[0].event, "compact_run");
    assert.deepStrictEqual(events[0].promoted_titles, []);
    assert.deepStrictEqual(events[0].dropped_titles, []);
  });
});

describe("extractGeneTitles", () => {
  test("extracts ## headings, skips placeholders", () => {
    const md = `# GENES Runtime
## Rule One

- some content
## 待初始化
## Rule Two
## 自进化机制（通用）`;
    const titles = extractGeneTitles(md);
    assert.ok(titles.has("Rule One"));
    assert.ok(titles.has("Rule Two"));
    assert.strictEqual(titles.size, 2);
  });
});

describe("renderProtocol", () => {
  test("default (Chinese) includes threshold", () => {
    const protocol = renderProtocol(5);
    assert.ok(protocol.includes("5"));
    assert.ok(protocol.includes("[EVOLVE]"));
    assert.ok(protocol.includes("回复末尾"));
  });

  test("English variant includes key phrases", () => {
    const en = renderProtocolEn(10);
    assert.ok(en.includes("10"));
    assert.ok(en.includes("[EVOLVE]"));
    assert.ok(en.includes("not allowed"));
  });

  test("Chinese variant includes key phrases", () => {
    const zh = renderProtocolZh(10);
    assert.ok(zh.includes("10"));
    assert.ok(zh.includes("结构化块"));
  });
});
