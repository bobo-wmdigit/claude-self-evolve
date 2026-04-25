/**
 * File lock mechanism tests — stale lock detection + concurrent access
 * Run: node --test tests/lock.test.js
 */
import test, { describe, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const LOCK_STALE_TTL = 30_000; // match evolve.mjs value

function exists(file) { return fs.existsSync(file); }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readText(file) { return fs.readFileSync(file, "utf8"); }

// Copy of the lock function from evolve.mjs for isolated testing
async function withLock(lockPath, evolveDir, fn) {
  ensureDir(evolveDir);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      if (exists(lockPath)) {
        const pidFile = path.join(lockPath, "pid");
        if (exists(pidFile)) {
          try {
            const pid = Number.parseInt(readText(pidFile), 10);
            if (pid > 0) process.kill(pid, 0);
          } catch (killError) {
            if (killError.code === "ESRCH" || killError.code === "ENOENT") {
              fs.rmSync(lockPath, { recursive: true, force: true });
            }
          }
        }
        try {
          const stat = fs.statSync(lockPath);
          if (stat.isDirectory() && Date.now() - stat.mtimeMs > LOCK_STALE_TTL) {
            fs.rmSync(lockPath, { recursive: true, force: true });
          }
        } catch {
          // continue
        }
      }
      fs.mkdirSync(lockPath);
      try { fs.writeFileSync(path.join(lockPath, "pid"), String(process.pid)); } catch {}
      try { return await fn(); }
      finally { fs.rmSync(lockPath, { recursive: true, force: true }); }
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`could not acquire lock: ${lockPath}`);
}

describe("withLock — basic locking", () => {
  let tmpDir, lockPath;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "evolve-lock-test-"));
    lockPath = path.join(tmpDir, "lock");
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("lock is acquired and released correctly", async () => {
    let entered = false;
    await withLock(lockPath, tmpDir, async () => {
      entered = true;
      return "done";
    });
    assert.ok(entered);
    assert.ok(!exists(lockPath), "lock dir should be cleaned up after release");
  });

  test("PID file is written during lock", async () => {
    let pidDuringLock;
    await withLock(lockPath, tmpDir, async () => {
      pidDuringLock = Number.parseInt(readText(path.join(lockPath, "pid")), 10);
    });
    assert.strictEqual(pidDuringLock, process.pid);
  });
});

describe("withLock — stale lock detection", () => {
  let tmpDir, lockPath;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "evolve-stale-lock-"));
    lockPath = path.join(tmpDir, "lock");
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("stale lock (dead PID) is cleaned up and lock acquired", async () => {
    // Simulate a stale lock from a dead process
    fs.mkdirSync(lockPath);
    fs.writeFileSync(path.join(lockPath, "pid"), "999999999");

    // should detect dead process, remove stale lock, acquire
    let acquired = false;
    await withLock(lockPath, tmpDir, async () => {
      acquired = true;
    });
    assert.ok(acquired, "should acquire lock after stale PID cleanup");
    assert.ok(!exists(lockPath), "lock dir cleaned after use");
  });

  test("stale lock (no PID file) waits for timeout or TTL", async () => {
    // Lock dir without PID file — should fall back to TTL check
    // Since mtime is "now", TTL won't trigger, so it will timeout
    fs.mkdirSync(lockPath);

    // No PID file means it falls to TTL check. TTL is 30s and lock was
    // just created, so TTL won't trigger either. Should timeout after
    // 200 * 25ms = 5s.
    const start = Date.now();
    try {
      await withLock(lockPath, tmpDir, async () => {});
      assert.fail("should have thrown");
    } catch (error) {
      assert.ok(error.message.includes("could not acquire lock"));
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 4000, `timeout should take ~5s, got ${elapsed}ms`);
    }
  });
});

describe("withLock — concurrent access", () => {
  let tmpDir, lockPath;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "evolve-concurrent-"));
    lockPath = path.join(tmpDir, "lock");
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("sequential locks do not interfere", async () => {
    const results = [];
    await withLock(lockPath, tmpDir, async () => { results.push(1); });
    await withLock(lockPath, tmpDir, async () => { results.push(2); });
    assert.deepStrictEqual(results, [1, 2]);
  });

  test("rapid sequential acquisition works", async () => {
    const promises = [];
    for (let i = 0; i < 10; i += 1) {
      promises.push(withLock(lockPath, tmpDir, async () => i));
    }
    const results = await Promise.all(promises);
    assert.strictEqual(results.length, 10);
    assert.deepStrictEqual(new Set(results).size, 10, "all 10 results should be unique");
  });
});
