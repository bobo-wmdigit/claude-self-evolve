/**
 * JSONL parsing, corruption handling, and line retention tests
 * Run: node --test tests/jsonl.test.js
 */
import test, { describe } from "node:test";
import assert from "node:assert";
import { parseJsonl, countJsonlLines, retainJsonlLines } from "../packages/claude-code/.claude/lib/evolve-core.js";

describe("parseJsonl", () => {
  test("parses valid JSONL correctly", () => {
    const text = `{"id":1,"title":"a"}
{"id":2,"title":"b"}`;
    const records = parseJsonl(text);
    assert.strictEqual(records.length, 2);
    assert.strictEqual(records[0].title, "a");
    assert.strictEqual(records[1].title, "b");
  });

  test("skips empty lines", () => {
    const text = `{"id":1}

{"id":2}
`;
    const records = parseJsonl(text);
    assert.strictEqual(records.length, 2);
  });

  test("skips corrupted lines by default (skipInvalid=true)", () => {
    const text = `{"id":1}
{invalid json
{"id":2}
not json at all
{"id":3}`;
    const records = parseJsonl(text);
    assert.strictEqual(records.length, 3);
    assert.strictEqual(records[0].id, 1);
    assert.strictEqual(records[1].id, 2);
    assert.strictEqual(records[2].id, 3);
  });

  test("throws on corrupted lines when skipInvalid=false", () => {
    const text = `{"id":1}\n{bad`;
    assert.throws(() => parseJsonl(text, { skipInvalid: false }), /invalid JSONL line/);
  });

  test("returns empty array for empty string", () => {
    assert.deepStrictEqual(parseJsonl(""), []);
    assert.deepStrictEqual(parseJsonl("\n\n"), []);
  });

  test("handles CRLF line endings", () => {
    const text = '{"id":1}\r\n{"id":2}';
    const records = parseJsonl(text);
    assert.strictEqual(records.length, 2);
  });
});

describe("countJsonlLines", () => {
  test("counts non-empty lines", () => {
    assert.strictEqual(countJsonlLines('{"a":1}\n{"b":2}\n'), 2);
  });

  test("skips blank lines", () => {
    assert.strictEqual(countJsonlLines('{"a":1}\n\n{"b":2}\n'), 2);
  });

  test("returns 0 for empty string", () => {
    assert.strictEqual(countJsonlLines(""), 0);
    assert.strictEqual(countJsonlLines("\n\n"), 0);
  });

  test("counts even invalid JSON lines", () => {
    // This function counts text lines, not valid JSON records
    assert.strictEqual(countJsonlLines('{"a":1}\nbad json\n{"b":2}'), 3);
  });
});

describe("retainJsonlLines", () => {
  test("keeps last N lines", () => {
    const text = '{"a":1}\n{"b":2}\n{"c":3}\n{"d":4}\n';
    const result = retainJsonlLines(text, 2);
    assert.ok(result.includes('"c":3'));
    assert.ok(result.includes('"d":4'));
    assert.ok(!result.includes('"a":1'));
    assert.ok(!result.includes('"b":2'));
  });

  test("returns original text when under limit", () => {
    const text = '{"a":1}\n';
    assert.strictEqual(retainJsonlLines(text, 5), text);
  });

  test("returns empty string when retainCount is 0", () => {
    const text = '{"a":1}\n{"b":2}\n';
    assert.strictEqual(retainJsonlLines(text, 0), "");
  });

  test("handles empty input", () => {
    assert.strictEqual(retainJsonlLines("", 5), "");
  });

  test("handles input with only newlines", () => {
    assert.strictEqual(retainJsonlLines("\n\n\n", 2), "\n\n\n");
  });
});
