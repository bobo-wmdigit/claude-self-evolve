#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  parseJsonl,
  countJsonlLines,
  retainJsonlLines,
  summarizeRecords,
  buildAuditEvents,
  extractEvolveBlock,
  validateEvolvePayload,
  extractGeneTitles,
  truncateContext,
  migrateStateChain,
  SCHEMA_VERSION,
  MAX_CONTEXT_CHARS,
  renderProtocolEn,
  renderProtocolZh,
  recordKey,
  dedupeRecords,
} from "./lib/evolve-core.js";

function renderProtocol(threshold) {
  return LANG === "en" ? renderProtocolEn(threshold) : renderProtocolZh(threshold);
}

const DEFAULT_COUNTER_THRESHOLD = 5;
const DEFAULT_COUNTER_WINDOW = 1800;
const DEFAULT_COMPACT_THRESHOLD = 5;
const DEFAULT_RUNTIME_LIMIT = 12;
const DEFAULT_SPARK_RETAIN = 100;
const DEFAULT_AUDIT_RETAIN = 500;
const LOCK_STALE_TTL = 30_000; // ms — stale lock detection fallback

// ── i18n ─────────────────────────────────────────────────────────
const LANG = process.env.EVOLVE_LANG || "zh";

function t(key) {
  const en = {
    prefix: "[evolve]",
    warn: "[evolve warning]",
    block: "[evolve block]",
    error: "[evolve error]",
    reminder: "\n[reminder] counter is halfway — remember to output [EVOLVE]{...}[/EVOLVE] block at the end of each reply.",
    noStdin: "Stop hook received no JSON input",
    recordWritten: "wrote spark.jsonl and reset counter",
    invalidPayload: "invalid EVOLVE block",
    compactDone: (r) => `compact done: runtime=${r.runtime}, archive=${r.archive}, spark=${r.spark}, archived_spark=${r.archivedSpark}`,
    missingFile: (f) => `missing file: ${f}`,
    missingScript: (f) => `missing script: ${f}`,
    notExecutable: (f) => `not executable: ${f}`,
    hookNotConnected: "UserPromptSubmit hook not connected",
    stopNotConnected: "Stop hook not connected",
    settingsParseError: (m) => `settings.local.json parse error: ${m}`,
    stateParseError: (m) => `state.json parse error: ${m}`,
    selfEvolveParseError: (m) => `self-evolve.json parse error: ${m}`,
    sparkParseError: (m) => `spark.jsonl parse error: ${m}`,
    archiveParseError: (m) => `archive spark parse error: ${m}`,
    auditParseError: (m) => `audit.jsonl parse error: ${m}`,
    jsonParseError: (m) => `JSON parse error: ${m}`,
    usage: "usage: evolve.mjs <hook|capture|compact|health|backup|restore> --project-dir <path>",
    backupDone: (p) => `backup saved to ${p}`,
    restoreDone: "restore complete",
    noBackup: "no backup archive found",
  };
  const zh = {
    prefix: "[自进化]",
    warn: "[自进化警告]",
    block: "[自进化阻断]",
    error: "[自进化错误]",
    reminder: "\n[提醒] counter 已过半，请确保每次回复末尾输出 [EVOLVE]{...}[/EVOLVE] 结构化块。",
    noStdin: "Stop hook 未收到 JSON 输入",
    recordWritten: "已写入 spark.jsonl 并重置 counter",
    invalidPayload: "EVOLVE 结构无效",
    compactDone: (r) => `compact 完成：runtime=${r.runtime} 条，archive=${r.archive} 条，spark=${r.spark} 条，archived_spark=${r.archivedSpark} 条`,
    missingFile: (f) => `缺少文件：${f}`,
    missingScript: (f) => `缺少脚本：${f}`,
    notExecutable: (f) => `脚本不可执行：${f}`,
    hookNotConnected: "UserPromptSubmit 未接入 evolve-hook.sh",
    stopNotConnected: "Stop 未接入 evolve-capture.sh",
    settingsParseError: (m) => `settings.local.json 解析失败：${m}`,
    stateParseError: (m) => `state.json 解析失败：${m}`,
    selfEvolveParseError: (m) => `self-evolve.json 解析失败：${m}`,
    sparkParseError: (m) => `spark.jsonl 解析失败：${m}`,
    archiveParseError: (m) => `archive spark 解析失败：${m}`,
    auditParseError: (m) => `audit.jsonl 解析失败：${m}`,
    jsonParseError: (m) => `JSON 解析失败：${m}`,
    usage: "usage: evolve.mjs <hook|capture|compact|health|backup|restore> --project-dir <path>",
    backupDone: (p) => `已备份到 ${p}`,
    restoreDone: "恢复完成",
    noBackup: "未找到备份文件",
  };
  return (LANG === "en" ? en : zh)[key] ?? en[key];
}

// ── CLI ──────────────────────────────────────────────────────────

function parseArgs() {
  const [command, ...rest] = process.argv.slice(2);
  const projectDirIndex = rest.indexOf("--project-dir");
  if (!["hook", "capture", "compact", "health", "backup", "restore"].includes(command)
    || projectDirIndex === -1
    || !rest[projectDirIndex + 1]) {
    console.error(`${t("usage")}`);
    process.exit(1);
  }
  return { command, projectDir: rest[projectDirIndex + 1] };
}

function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

// ── Paths ────────────────────────────────────────────────────────

function buildPaths(projectDir) {
  const root = path.resolve(projectDir);
  const evolveDir = path.join(root, ".evolve");
  return {
    projectDir: root,
    evolveDir,
    stateFile: path.join(evolveDir, "state.json"),
    sparkFile: path.join(evolveDir, "spark.jsonl"),
    auditFile: path.join(evolveDir, "audit.jsonl"),
    archiveDir: path.join(evolveDir, "archive"),
    runtimeFile: path.join(evolveDir, "genes.runtime.md"),
    archiveFile: path.join(evolveDir, "genes.archive.md"),
    lockPath: path.join(evolveDir, "lock"),
    installMetaFile: path.join(evolveDir, "self-evolve.json"),
    settingsFile: path.join(root, ".claude", "settings.local.json"),
  };
}

// ── File I/O ─────────────────────────────────────────────────────

function nowTs() { return Math.floor(Date.now() / 1000); }

function timestamp() {
  const date = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function atomicWrite(file, content) {
  ensureDir(path.dirname(file));
  const tmp = path.join(path.dirname(file),
    `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

function appendLine(file, content) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, content, "utf8");
}

function exists(file) { return fs.existsSync(file); }
function readText(file) { return exists(file) ? fs.readFileSync(file, "utf8") : ""; }

function loadJson(file, fallback) {
  if (!exists(file)) return fallback;
  return JSON.parse(readText(file));
}

function writeJson(file, payload) {
  atomicWrite(file, `${JSON.stringify(payload, null, 2)}\n`);
}

// ── State ────────────────────────────────────────────────────────

function initializeState(paths) {
  const state = {
    schema_version: SCHEMA_VERSION,
    counter: 0,
    last_prompt_at: 0,
    last_capture_at: 0,
    last_compact_at: 0,
    last_reset_reason: "",
    runtime_gene_count: 0,
    spark_record_count: 0,
  };
  writeJson(paths.stateFile, state);
  return state;
}

function migrateState(paths, state) {
  const result = migrateStateChain(state, SCHEMA_VERSION);
  if (result.warnings.length > 0) {
    console.warn(`${t("prefix")} ${result.warnings.join("; ")}`);
  }
  if (result.state === null) return initializeState(paths);
  writeJson(paths.stateFile, result.state);
  return result.state;
}

function ensureLayout(paths) {
  ensureDir(paths.evolveDir);
  if (!exists(paths.runtimeFile)) {
    const content = defaultRuntimeContent();
    atomicWrite(paths.runtimeFile, content.endsWith("\n") ? content : `${content}\n`);
  }
  if (!exists(paths.archiveFile)) atomicWrite(paths.archiveFile, `${defaultArchiveContent()}\n`);
  if (!exists(paths.sparkFile)) atomicWrite(paths.sparkFile, "");
  if (!exists(paths.auditFile)) atomicWrite(paths.auditFile, "");

  let state;
  if (!exists(paths.stateFile)) {
    state = initializeState(paths);
  } else {
    state = loadJson(paths.stateFile, {});
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      state = initializeState(paths);
    } else if (Number.parseInt(state.schema_version || 0, 10) !== SCHEMA_VERSION) {
      state = migrateState(paths, state);
    }
  }
  return state;
}

// ── Lock ─────────────────────────────────────────────────────────

async function withLock(paths, fn) {
  ensureDir(paths.evolveDir);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      // Stale lock detection via PID file
      if (exists(paths.lockPath)) {
        const pidFile = path.join(paths.lockPath, "pid");
        if (exists(pidFile)) {
          try {
            const pid = Number.parseInt(readText(pidFile), 10);
            if (pid > 0) process.kill(pid, 0);
          } catch (killError) {
            // ESRCH = process dead; ENOENT = pid file gone
            if (killError.code === "ESRCH" || killError.code === "ENOENT") {
              fs.rmSync(paths.lockPath, { recursive: true, force: true });
            }
          }
        }
        // Fallback: TTL-based stale detection
        try {
          const stat = fs.statSync(paths.lockPath);
          if (stat.isDirectory() && Date.now() - stat.mtimeMs > LOCK_STALE_TTL) {
            fs.rmSync(paths.lockPath, { recursive: true, force: true });
          }
        } catch {
          // stat failed — continue with mkdir attempt
        }
      }
      fs.mkdirSync(paths.lockPath);
      try {
        fs.writeFileSync(path.join(paths.lockPath, "pid"), String(process.pid));
      } catch {
        // Non-critical
      }
      try {
        return await fn();
      } finally {
        fs.rmSync(paths.lockPath, { recursive: true, force: true });
      }
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`could not acquire lock: ${paths.lockPath}`);
}

function loadState(paths) {
  if (!exists(paths.stateFile)) return initializeState(paths);
  const state = loadJson(paths.stateFile, {});
  return state && typeof state === "object" && !Array.isArray(state)
    ? state : initializeState(paths);
}

function writeState(paths, state) { writeJson(paths.stateFile, state); }

// ── JSONL helpers ────────────────────────────────────────────────

function countSparkRecords(paths) {
  if (!exists(paths.sparkFile)) return 0;
  return countJsonlLines(readText(paths.sparkFile));
}

function loadJsonlRecords(file) {
  if (!exists(file)) return [];
  return parseJsonl(readText(file), { skipInvalid: true });
}

function loadSparkRecords(paths) { return loadJsonlRecords(paths.sparkFile); }

function archiveSparkFileForNow(paths) {
  const date = new Date();
  const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return path.join(paths.archiveDir, `spark-${month}.jsonl`);
}

function archivedSparkFiles(paths) {
  if (!exists(paths.archiveDir)) return [];
  return fs.readdirSync(paths.archiveDir)
    .filter((name) => /^spark-\d{4}-\d{2}\.jsonl$/u.test(name))
    .sort()
    .map((name) => path.join(paths.archiveDir, name));
}


function loadArchivedSparkRecords(paths) {
  const records = [];
  for (const file of archivedSparkFiles(paths)) {
    records.push(...loadJsonlRecords(file));
  }
  return records;
}

function loadAllSparkRecords(paths) {
  return dedupeRecords([...loadArchivedSparkRecords(paths), ...loadSparkRecords(paths)]);
}

function countArchivedSparkRecords(paths) {
  return loadArchivedSparkRecords(paths).length;
}

function retainRecentSparkRecords(paths, retainCount) {
  const text = readText(paths.sparkFile);
  const retained = retainJsonlLines(text, retainCount);
  if (retained !== text) atomicWrite(paths.sparkFile, retained);
  return countJsonlLines(retained);
}

function pruneJsonlFile(file, retainCount) {
  const text = readText(file);
  const pruned = retainJsonlLines(text, retainCount);
  if (pruned !== text) atomicWrite(file, pruned);
  return countJsonlLines(pruned);
}

function appendAuditEvent(paths, event) {
  appendLine(paths.auditFile, `${JSON.stringify(event)}\n`);
}

// ── Defaults ─────────────────────────────────────────────────────

function defaultRuntimeContent() {
  return `# GENES Runtime

_（当前活跃基因。每轮自动注入，保持少而硬。）_

## 待初始化

- 首次进入项目时，先读 README、关键配置和目录结构，再补充本文件。
- 这里只保留当前高频有效、值得每轮提醒的规则。
- 每条规则要说明适用场景、经验教训和建议动作。
`;
}

function defaultArchiveContent() {
  return `# GENES Archive

_（历史归档基因。保留但不默认注入。）_
`;
}

// ── Rendering ────────────────────────────────────────────────────

function renderRuntime(entries) {
  const lines = [
    "# GENES Runtime", "", "_（当前活跃基因。每轮自动注入，保持少而硬。）_", "",
  ];
  if (entries.length === 0) {
    lines.push("## 待初始化", "", "- 当前还没有沉淀出的活跃规则。",
      "- 请在真实项目会话中逐步积累并通过 compact 生成 runtime。");
    return `${lines.join("\n").trimEnd()}\n`;
  }
  for (const entry of entries) {
    lines.push(
      `## ${entry.title}`, "",
      `- 类型：${entry.type}`,
      `- 适用场景：${entry.scenario}`,
      `- 经验教训：${entry.lesson}`,
      `- 建议动作：${entry.action}`,
      `- 验证强度：${entry.confidence}`,
      `- 出现频次：${entry.count}`,
      `- 最后验证：${entry.last_seen}`,
      "",
    );
  }
  lines.push(
    "## 自进化机制（通用）", "",
    "- 每轮只注入 runtime，不注入 archive。",
    "- 原始火花统一写入 `spark.jsonl`。",
    "- 通过 `evolve-compact.sh` 合并重复经验并更新 runtime。",
  );
  return `${lines.join("\n").trimEnd()}\n`;
}

function renderArchive(entries) {
  const lines = ["# GENES Archive", "", "_（历史归档基因。保留但不默认注入。）_", ""];
  if (entries.length === 0) {
    lines.push("_暂无归档内容_");
    return `${lines.join("\n").trimEnd()}\n`;
  }
  for (const entry of entries) {
    lines.push(
      `## ${entry.title}`, "",
      `- 类型：${entry.type}`,
      `- 适用场景：${entry.scenario}`,
      `- 经验教训：${entry.lesson}`,
      `- 建议动作：${entry.action}`,
      `- 验证强度：${entry.confidence}`,
      `- 出现频次：${entry.count}`,
      `- 最后验证：${entry.last_seen}`,
      "",
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function buildAdditionalContext(paths, state, threshold) {
  const runtime = readText(paths.runtimeFile).trim();
  const sparkCount = countSparkRecords(paths);
  const reminder = state.counter >= Math.ceil(threshold / 2) ? t("reminder") : "";
  return truncateContext([
    "---",
    `${t("prefix")} state: counter=${state.counter} / ${threshold} | spark=${sparkCount}`,
    renderProtocol(threshold),
    reminder,
    "Active GENES:",
    runtime || "_no runtime content_",
  ].join("\n").trim());
}

// ── Hook command ─────────────────────────────────────────────────

async function updatePromptState(paths, threshold, counterWindow) {
  return withLock(paths, async () => {
    ensureLayout(paths);
    const state = loadState(paths);
    const current = nowTs();
    const lastPromptAt = Number.parseInt(state.last_prompt_at || 0, 10) || 0;
    let counter = Number.parseInt(state.counter || 0, 10) || 0;
    if (lastPromptAt && current - lastPromptAt > counterWindow) counter = 0;
    counter += 1;
    state.counter = counter;
    state.last_prompt_at = current;
    state.spark_record_count = countSparkRecords(paths);
    writeState(paths, state);
    return state;
  });
}

async function commandHook(paths) {
  const threshold = envInt("EVOLVE_THRESHOLD", DEFAULT_COUNTER_THRESHOLD);
  const counterWindow = envInt("EVOLVE_COUNTER_WINDOW", DEFAULT_COUNTER_WINDOW);
  const state = await updatePromptState(paths, threshold, counterWindow);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: buildAdditionalContext(paths, state, threshold),
    },
  }));
  return 0;
}

// ── Capture command ──────────────────────────────────────────────

function extractLastMessageFromTranscript(transcriptPath) {
  if (!transcriptPath || !exists(transcriptPath)) return "";
  let lastText = "";
  for (const line of readText(transcriptPath).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const payload = JSON.parse(line);
      if (payload.type !== "assistant") continue;
      const content = payload.message?.content || [];
      const parts = content.filter((item) => item.type === "text")
        .map((item) => item.text || "");
      lastText = parts.filter(Boolean).join("\n");
    } catch {
      // Ignore malformed transcript lines.
    }
  }
  return lastText;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function fallbackRecord(hookInput) {
  const excerpt = String(hookInput.last_assistant_message || "").trim().slice(0, 240);
  return {
    record: "yes",
    title: "Forced checkpoint",
    type: "forced-checkpoint",
    scenario: "counter 达到阈值但回复未提供可解析的 EVOLVE 记录",
    lesson: excerpt || "系统未读到合格的 EVOLVE 结构化块，因此写入一条保底记录。",
    action: "回看最近一轮任务，把隐含规则补充为明确的工程经验。",
    confidence: "low",
  };
}

function buildRecord(payload, hookInput, mode) {
  const excerpt = String(hookInput.last_assistant_message || "").trim().slice(0, 240);
  return {
    id: randomUUID(),
    time: timestamp(),
    title: payload.title || "Forced checkpoint",
    type: payload.type || "forced-checkpoint",
    scenario: payload.scenario || "达到阈值但未形成合格的结构化经验块",
    lesson: payload.lesson || excerpt || "本轮缺少可解析经验，系统生成保底记录。",
    action: payload.action || "回看最近一轮任务，总结为可复用规则后再优化 runtime。",
    confidence: payload.confidence || "low",
    source: { hook: "Stop", mode, session_id: hookInput.session_id || "" },
    status: "raw",
  };
}

function appendRecord(paths, record) {
  appendLine(paths.sparkFile, `${JSON.stringify(record)}\n`);
}

async function maybeCompact(paths) {
  const threshold = envInt("EVOLVE_COMPACT_THRESHOLD", DEFAULT_COMPACT_THRESHOLD);
  if (countSparkRecords(paths) >= threshold) await commandCompact(paths, true);
}

async function commandCapture(paths) {
  const raw = await readStdin();
  if (!raw.trim()) {
    console.error(`${t("warn")} ${t("noStdin")}`);
    return 1;
  }
  const hookInput = JSON.parse(raw);
  const stopHookActive = Boolean(hookInput.stop_hook_active);
  let recordWritten = false;
  let validationError = null;
  let evolveBlockMissing = false;
  await withLock(paths, async () => {
    ensureLayout(paths);
    const state = loadState(paths);
    const threshold = envInt("EVOLVE_THRESHOLD", DEFAULT_COUNTER_THRESHOLD);
    const count = Number.parseInt(state.counter || 0, 10) || 0;
    let lastMessage = String(hookInput.last_assistant_message || "").trim();
    if (!lastMessage) {
      lastMessage = extractLastMessageFromTranscript(String(hookInput.transcript_path || "")).trim();
    }
    let payload = null;
    try {
      payload = extractEvolveBlock(lastMessage);
      if (payload !== null) validateEvolvePayload(payload, count >= threshold);
    } catch (error) {
      payload = null;
      validationError = error.message;
    }
    // Track missing EVOLVE blocks for awareness
    if (payload === null) {
      evolveBlockMissing = true;
      appendAuditEvent(paths, {
        time: timestamp(),
        event: "missing_evolve_block",
        counter: count,
        threshold,
      });
    }
    if (payload === null && count >= threshold && !stopHookActive) {
      console.error(`${t("block")} counter 已达阈值，但回复末尾没有合格的 EVOLVE 结构化块。`
        + "请补充 `[EVOLVE]{...}[/EVOLVE]` 后再结束。");
      process.exitCode = 2;
      return;
    }
    if (payload === null && count >= threshold && stopHookActive) {
      payload = fallbackRecord(hookInput);
    }
    if (payload !== null && payload.record === "yes") {
      appendRecord(paths, buildRecord(payload, hookInput,
        validationError === null ? "assistant" : "forced-fallback"));
      recordWritten = true;
      state.counter = 0;
      state.last_reset_reason = "record_written";
    } else if (payload !== null && payload.record === "no") {
      state.last_reset_reason = "skipped";
    } else if (validationError) {
      state.last_reset_reason = `invalid_evolve:${validationError}`;
    }
    state.last_capture_at = nowTs();
    state.spark_record_count = countSparkRecords(paths);
    writeState(paths, state);
  });
  if (process.exitCode === 2) return 2;
  if (recordWritten) {
    await maybeCompact(paths);
    console.log(`${t("prefix")} ${t("recordWritten")}`);
  } else if (validationError) {
    console.error(`${t("warn")} ${t("invalidPayload")}：${validationError}`);
  }
  return 0;
}

// ── Compact command ──────────────────────────────────────────────

function archiveSparkRecords(paths, records) {
  if (records.length === 0) return 0;
  ensureDir(paths.archiveDir);
  const archiveFile = archiveSparkFileForNow(paths);
  const existing = loadArchivedSparkRecords(paths);
  const seen = new Set(existing.map((record) => recordKey(record)));
  const additions = [];
  for (const record of records) {
    const key = recordKey(record);
    if (seen.has(key)) continue;
    seen.add(key);
    additions.push(record);
  }
  if (additions.length > 0) {
    appendLine(archiveFile, additions.map((record) => JSON.stringify(record)).join("\n") + "\n");
  }
  return additions.length;
}

async function commandCompact(paths, silent = false) {
  ensureLayout(paths);
  let result;
  await withLock(paths, async () => {
    const activeRecords = loadSparkRecords(paths);
    archiveSparkRecords(paths, activeRecords);
    const records = loadAllSparkRecords(paths);
    const runtimeLimit = envInt("EVOLVE_RUNTIME_LIMIT", DEFAULT_RUNTIME_LIMIT);
    const sparkRetain = envInt("EVOLVE_SPARK_RETAIN", DEFAULT_SPARK_RETAIN);
    const auditRetain = envInt("EVOLVE_AUDIT_RETAIN", DEFAULT_AUDIT_RETAIN);
    const beforeRuntimeTitles = extractGeneTitles(readText(paths.runtimeFile));
    const beforeArchiveTitles = extractGeneTitles(readText(paths.archiveFile));
    const [runtimeEntries, archiveEntries] = summarizeRecords(records, runtimeLimit, {
      nowEpochMs: Date.now(),
    });
    atomicWrite(paths.runtimeFile, renderRuntime(runtimeEntries));
    atomicWrite(paths.archiveFile, renderArchive(archiveEntries));
    for (const event of buildAuditEvents(
      beforeRuntimeTitles, beforeArchiveTitles,
      runtimeEntries, archiveEntries, records.length,
    )) {
      appendAuditEvent(paths, event);
    }
    const state = loadState(paths);
    state.last_compact_at = nowTs();
    state.runtime_gene_count = runtimeEntries.length;
    state.spark_record_count = retainRecentSparkRecords(paths, sparkRetain);
    state.archived_spark_record_count = countArchivedSparkRecords(paths);
    state.audit_event_count = pruneJsonlFile(paths.auditFile, auditRetain);
    writeState(paths, state);
    result = {
      runtime: runtimeEntries.length,
      archive: archiveEntries.length,
      spark: state.spark_record_count,
      archivedSpark: state.archived_spark_record_count,
    };
  });
  if (!silent) {
    console.log(`${t("prefix")} ${t("compactDone")(result)}`);
  }
  return 0;
}

// ── Health command ───────────────────────────────────────────────

function isExecutable(file) {
  try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; }
}

function commandHealth(paths) {
  const issues = [];
  ensureLayout(paths);
  for (const required of [paths.stateFile, paths.sparkFile, paths.auditFile, paths.runtimeFile, paths.archiveFile]) {
    if (!exists(required)) issues.push(t("missingFile")(required));
  }
  for (const requiredExec of [
    path.join(paths.projectDir, ".claude", "evolve-hook.sh"),
    path.join(paths.projectDir, ".claude", "evolve-capture.sh"),
    path.join(paths.projectDir, ".claude", "evolve-compact.sh"),
    path.join(paths.projectDir, ".claude", "evolve-health.sh"),
    path.join(paths.projectDir, ".claude", "evolve.mjs"),
  ]) {
    if (!exists(requiredExec)) issues.push(t("missingScript")(requiredExec));
    else if (!isExecutable(requiredExec)) issues.push(t("notExecutable")(requiredExec));
  }
  try {
    const settings = loadJson(paths.settingsFile, {});
    const hooks = settings.hooks || {};
    const promptCommands = (hooks.UserPromptSubmit || [])
      .flatMap((m) => m.hooks || []).map((h) => h.command);
    const stopCommands = (hooks.Stop || [])
      .flatMap((m) => m.hooks || []).map((h) => h.command);
    if (!promptCommands.includes("$CLAUDE_PROJECT_DIR/.claude/evolve-hook.sh")) {
      issues.push(t("hookNotConnected"));
    }
    if (!stopCommands.includes("$CLAUDE_PROJECT_DIR/.claude/evolve-capture.sh")
      && !stopCommands.includes("$CLAUDE_PROJECT_DIR/.claude/evolve-verify.sh")) {
      issues.push(t("stopNotConnected"));
    }
  } catch (error) {
    issues.push(t("settingsParseError")(error.message));
  }
  try { loadJson(paths.stateFile, {}); }
  catch (error) { issues.push(t("stateParseError")(error.message)); }
  let installedVersion = "unknown";
  let archivedSparkRecordCount = 0;
  let auditEventCount = 0;
  try {
    installedVersion = loadJson(paths.installMetaFile, {}).installed_version || "unknown";
  } catch (error) {
    issues.push(t("selfEvolveParseError")(error.message));
  }
  try { loadSparkRecords(paths); }
  catch (error) { issues.push(t("sparkParseError")(error.message)); }
  try { archivedSparkRecordCount = countArchivedSparkRecords(paths); }
  catch (error) { issues.push(t("archiveParseError")(error.message)); }
  try { auditEventCount = countJsonlLines(readText(paths.auditFile)); }
  catch (error) { issues.push(t("auditParseError")(error.message)); }
  const summary = {
    schema_version: SCHEMA_VERSION,
    installed_version: installedVersion,
    runtime_gene_count: loadState(paths).runtime_gene_count || 0,
    spark_record_count: countSparkRecords(paths),
    archived_spark_record_count: archivedSparkRecordCount,
    audit_event_count: auditEventCount,
    retention: {
      spark_retain: envInt("EVOLVE_SPARK_RETAIN", DEFAULT_SPARK_RETAIN),
      audit_retain: envInt("EVOLVE_AUDIT_RETAIN", DEFAULT_AUDIT_RETAIN),
    },
    issues,
  };
  console.log(JSON.stringify(summary, null, 2));
  return issues.length === 0 ? 0 : 1;
}

// ── Backup / Restore ─────────────────────────────────────────────

function commandBackup(paths) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupName = `evolve-backup-${ts}.tar.gz`;
  const backupPath = path.resolve(paths.projectDir, backupName);
  ensureDir(paths.evolveDir);
  // Use tar to archive .evolve/ directory
  try {
    execFileSync("tar", ["czf", backupPath, "-C", paths.projectDir, ".evolve"], { stdio: "pipe" });
  } catch (error) {
    // Fallback: copy files manually
    const dest = path.resolve(paths.projectDir, `evolve-backup-${ts}`);
    ensureDir(dest);
    copyRecursive(paths.evolveDir, path.join(dest, ".evolve"));
    console.log(`${t("backupDone")(dest)}`);
    return 0;
  }
  console.log(`${t("backupDone")(backupPath)}`);
  return 0;
}

function copyRecursive(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    if (fs.statSync(srcPath).isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function commandRestore(paths) {
  // Look for the most recent backup in project dir
  const backups = fs.readdirSync(paths.projectDir)
    .filter((f) => /^evolve-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.tar\.gz$/u.test(f))
    .sort()
    .reverse();
  if (backups.length === 0) {
    console.error(`${t("warn")} ${t("noBackup")}`);
    return 1;
  }
  const backupPath = path.join(paths.projectDir, backups[0]);
  // Extract into project dir (overwrites existing .evolve/)
  try {
    execFileSync("tar", ["xzf", backupPath, "-C", paths.projectDir], { stdio: "pipe" });
  } catch (error) {
    console.error(`${t("error")} ${error.message}`);
    return 1;
  }
  console.log(`${t("prefix")} ${t("restoreDone")} (${backups[0]})`);
  return 0;
}

// ── Entry ────────────────────────────────────────────────────────

async function main() {
  const { command, projectDir } = parseArgs();
  const paths = buildPaths(projectDir);
  try {
    if (command === "hook") return await commandHook(paths);
    if (command === "capture") return await commandCapture(paths);
    if (command === "compact") return await commandCompact(paths);
    if (command === "health") return commandHealth(paths);
    if (command === "backup") return commandBackup(paths);
    if (command === "restore") return commandRestore(paths);
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`${t("error")} ${t("jsonParseError")}: ${error.message}`);
    } else {
      console.error(`${t("error")} ${error.message}`);
    }
    return 1;
  }
  return 1;
}

process.exit(await main());
