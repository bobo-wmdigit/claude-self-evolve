/**
 * EVOLVE block parser and validation tests
 * Run: node --test tests/evolve-parser.test.js
 */
import test, { describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractEvolveBlock, validateEvolvePayload, ValidationError } from "../packages/claude-code/.claude/lib/evolve-core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

describe("extractEvolveBlock", () => {
  test("extracts valid EVOLVE block", () => {
    const msg = 'Some text\n[EVOLVE]{"record":"yes","title":"test"}[/EVOLVE]';
    const result = extractEvolveBlock(msg);
    assert.deepStrictEqual(result, { record: "yes", title: "test" });
  });

  test("returns null when no EVOLVE block present", () => {
    assert.strictEqual(extractEvolveBlock("just plain text"), null);
  });

  test("returns null for null/undefined input", () => {
    assert.strictEqual(extractEvolveBlock(null), null);
    assert.strictEqual(extractEvolveBlock(""), null);
    assert.strictEqual(extractEvolveBlock(undefined), null);
  });

  test("returns null on malformed JSON inside EVOLVE tags", () => {
    const msg = '[EVOLVE]{bad json}[/EVOLVE]';
    assert.strictEqual(extractEvolveBlock(msg), null);
  });

  test("handles whitespace around JSON", () => {
    const msg = '[EVOLVE]  {"record":"no","reason":"ok"}  [/EVOLVE]';
    const result = extractEvolveBlock(msg);
    assert.strictEqual(result.record, "no");
  });

  test("captures first block when multiple exist", () => {
    const msg = '[EVOLVE]{"record":"yes","title":"first"}[/EVOLVE]\n[EVOLVE]{"record":"yes","title":"second"}[/EVOLVE]';
    const result = extractEvolveBlock(msg);
    assert.strictEqual(result.title, "first");
  });
});

describe("validateEvolvePayload", () => {
  test("valid record=yes payload passes", () => {
    const payload = {
      record: "yes",
      title: "Test",
      type: "engineering-rule",
      scenario: "always",
      lesson: "learned",
      action: "do it",
      confidence: "high",
    };
    assert.doesNotThrow(() => validateEvolvePayload(payload, false));
    assert.doesNotThrow(() => validateEvolvePayload(payload, true));
  });

  test("valid record=no payload passes (threshold not reached)", () => {
    const payload = { record: "no", reason: "routine turn" };
    assert.doesNotThrow(() => validateEvolvePayload(payload, false));
  });

  test("record=no rejected when threshold reached", () => {
    const payload = { record: "no", reason: "routine turn" };
    assert.throws(() => validateEvolvePayload(payload, true), ValidationError);
  });

  test("record=no without reason rejected", () => {
    const payload = { record: "no" };
    assert.throws(() => validateEvolvePayload(payload, false), ValidationError);
  });

  test("missing fields rejected for record=yes", () => {
    const payload = { record: "yes", title: "Test" };
    assert.throws(() => validateEvolvePayload(payload, false), ValidationError);
  });

  test("invalid confidence rejected", () => {
    const payload = {
      record: "yes", title: "T", type: "t", scenario: "s", lesson: "l", action: "a", confidence: "extreme",
    };
    assert.throws(() => validateEvolvePayload(payload, false), ValidationError);
  });

  test("invalid record value rejected", () => {
    const payload = { record: "maybe" };
    assert.throws(() => validateEvolvePayload(payload, false), ValidationError);
  });
});

describe("missing evolve block detection", () => {
  test("evolve.mjs appends missing_evolve_block audit event", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "packages/claude-code/.claude/evolve.mjs"),
      "utf8",
    );
    assert.ok(
      source.includes('"missing_evolve_block"'),
      "capture must log missing_evolve_block audit event",
    );
    assert.ok(
      source.includes("evolveBlockMissing"),
      "capture must track evolveBlockMissing flag",
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
    assert.ok(
      source.includes("EVOLVE"),
      "reminder must mention EVOLVE block",
    );
  });
});
