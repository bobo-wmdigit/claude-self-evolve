/**
 * State migration chain tests
 * Run: node --test tests/state.test.js
 */
import test, { describe } from "node:test";
import assert from "node:assert";
import { migrateStateChain } from "../packages/claude-code/.claude/lib/evolve-core.js";

describe("migrateStateChain", () => {
  test("v1 state migrates to v2", () => {
    const v1State = {
      schema_version: 1,
      count: 3,
      timestamp: 1700000000,
      last_capture_at: 1700000100,
      last_compact_at: 1700000200,
      last_reset_reason: "test",
      runtime_gene_count: 5,
      spark_record_count: 10,
    };
    const { state, warnings } = migrateStateChain(v1State, 2);
    assert.ok(state !== null, "state should not be null for v1->v2");
    assert.strictEqual(state.schema_version, 2);
    assert.strictEqual(state.counter, 3); // count -> counter
    assert.strictEqual(state.last_prompt_at, 1700000000); // timestamp -> last_prompt_at
    assert.strictEqual(state.last_capture_at, 1700000100);
    assert.strictEqual(state.warnings, undefined); // warnings is in return, not state
    assert.deepStrictEqual(warnings, []);
  });

  test("v2 state passes through unchanged", () => {
    const v2State = {
      schema_version: 2,
      counter: 5,
      last_prompt_at: 1700000000,
      last_capture_at: 0,
      last_compact_at: 0,
      last_reset_reason: "",
      runtime_gene_count: 3,
      spark_record_count: 7,
    };
    const { state, warnings } = migrateStateChain(v2State, 2);
    assert.deepStrictEqual(state, v2State);
    assert.deepStrictEqual(warnings, []);
  });

  test("unknown future version passes through", () => {
    const futureState = { schema_version: 5, foo: "bar" };
    const { state, warnings } = migrateStateChain(futureState, 2);
    // Future version >= target (2), so it passes through as-is
    assert.deepStrictEqual(state, futureState);
    assert.deepStrictEqual(warnings, []);
  });

  test("pre-v1 state triggers reinitialize warning", () => {
    const { state, warnings } = migrateStateChain({ schema_version: 0 }, 2);
    assert.strictEqual(state, null);
    assert.ok(warnings.length > 0);
    assert.ok(warnings[0].includes("too old") || warnings[0].includes("reinitialize"));
  });

  test("undefined state triggers reinitialize", () => {
    const { state, warnings } = migrateStateChain(undefined, 2);
    assert.strictEqual(state, null);
  });

  test("null state triggers reinitialize", () => {
    const { state, warnings } = migrateStateChain(null, 2);
    assert.strictEqual(state, null);
  });

  test("v1 state with missing fields gets defaults", () => {
    const minimalV1 = { schema_version: 1 };
    const { state, warnings } = migrateStateChain(minimalV1, 2);
    assert.ok(state !== null);
    assert.strictEqual(state.counter, 0);
    assert.strictEqual(state.last_prompt_at, 0);
    assert.strictEqual(state.runtime_gene_count, 0);
    assert.deepStrictEqual(warnings, []);
  });

  test("no migration path warning for impossible gap", () => {
    // If someone creates a v3 state but only has v1->v2 migration
    // it should warn and return null
    // For now, v3 passes through since >= target (2).
    // But if we target v4 with only v1->v2 and v2->v3:
    // (This tests the chain loop stopping early)
    const v2State = { schema_version: 2, counter: 1 };
    // Target v3 with only v1->v2 migration available
    const { state, warnings } = migrateStateChain(v2State, 3);
    assert.strictEqual(state, null);
    assert.ok(warnings[0].includes("no migration path"));
  });
});
