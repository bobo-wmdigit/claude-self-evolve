#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const SCHEMA_VERSION = 2;
const DEFAULT_COUNTER_THRESHOLD = 5;
const DEFAULT_COUNTER_WINDOW = 1800;
const DEFAULT_COMPACT_THRESHOLD = 10;
const DEFAULT_RUNTIME_LIMIT = 12;
const MAX_CONTEXT_CHARS = 8000;
const CONFIDENCE_SCORE = { low: 1, medium: 2, high: 3 };

class ValidationError extends Error {}

function parseArgs() {
  const [command, ...rest] = process.argv.slice(2);
  const projectDirIndex = rest.indexOf("--project-dir");
  if (!["hook", "capture", "compact", "health"].includes(command) || projectDirIndex === -1 || !rest[projectDirIndex + 1]) {
    console.error("usage: evolve.mjs <hook|capture|compact|health> --project-dir <path>");
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

function buildPaths(projectDir) {
  const root = path.resolve(projectDir);
  const evolveDir = path.join(root, ".evolve");
  return {
    projectDir: root,
    evolveDir,
    stateFile: path.join(evolveDir, "state.json"),
    sparkFile: path.join(evolveDir, "spark.jsonl"),
    auditFile: path.join(evolveDir, "audit.jsonl"),
    runtimeFile: path.join(evolveDir, "genes.runtime.md"),
    archiveFile: path.join(evolveDir, "genes.archive.md"),
    legacyGenesFile: path.join(evolveDir, "GENES.md"),
    legacySparkFile: path.join(evolveDir, "SPARK.md"),
    legacyCounterFile: path.join(evolveDir, ".counter"),
    lockPath: path.join(evolveDir, "lock"),
    installMetaFile: path.join(evolveDir, "self-evolve.json"),
    settingsFile: path.join(root, ".claude", "settings.local.json"),
  };
}

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function timestamp() {
  const date = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(file, content) {
  ensureDir(path.dirname(file));
  const tmp = path.join(path.dirname(file), `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

function appendLine(file, content) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, content, "utf8");
}

function exists(file) {
  return fs.existsSync(file);
}

function readText(file) {
  return exists(file) ? fs.readFileSync(file, "utf8") : "";
}

function loadJson(file, fallback) {
  if (!exists(file)) return fallback;
  return JSON.parse(readText(file));
}

function writeJson(file, payload) {
  atomicWrite(file, `${JSON.stringify(payload, null, 2)}\n`);
}

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

function defaultLegacyGenesContent() {
  return `# 🧠 GENES（兼容视图）

_（请优先维护 \`genes.runtime.md\` 与 \`genes.archive.md\`。本文件由脚本同步生成，用于兼容旧项目习惯。）_
`;
}

function defaultLegacySparkContent() {
  return `# SPARK

_（兼容视图。原始记录已迁移到 \`spark.jsonl\`，本文件仅做人类可读摘要。）_
`;
}

function initializeState(paths) {
  let legacyCount = 0;
  let legacyPromptAt = 0;
  if (exists(paths.legacyCounterFile)) {
    try {
      const legacy = loadJson(paths.legacyCounterFile, {});
      legacyCount = Number.parseInt(legacy.count || 0, 10) || 0;
      legacyPromptAt = Number.parseInt(legacy.timestamp || 0, 10) || 0;
    } catch {
      legacyCount = 0;
      legacyPromptAt = 0;
    }
  }
  const state = {
    schema_version: SCHEMA_VERSION,
    counter: legacyCount,
    last_prompt_at: legacyPromptAt,
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
  const migrated = {
    schema_version: SCHEMA_VERSION,
    counter: Number.parseInt(state.counter ?? state.count ?? 0, 10) || 0,
    last_prompt_at: Number.parseInt(state.last_prompt_at ?? state.timestamp ?? 0, 10) || 0,
    last_capture_at: Number.parseInt(state.last_capture_at ?? 0, 10) || 0,
    last_compact_at: Number.parseInt(state.last_compact_at ?? 0, 10) || 0,
    last_reset_reason: String(state.last_reset_reason ?? ""),
    runtime_gene_count: Number.parseInt(state.runtime_gene_count ?? 0, 10) || 0,
    spark_record_count: Number.parseInt(state.spark_record_count ?? 0, 10) || 0,
  };
  writeJson(paths.stateFile, migrated);
  return migrated;
}

function ensureLayout(paths) {
  ensureDir(paths.evolveDir);
  if (!exists(paths.runtimeFile)) {
    const legacy = readText(paths.legacyGenesFile).trim();
    let content = defaultRuntimeContent();
    if (legacy && !legacy.includes("待初始化") && !legacy.includes("兼容视图")) {
      content = `# GENES Runtime\n\n_（从旧版 GENES.md 导入，建议后续按新结构整理。）_\n\n${legacy}\n`;
    }
    atomicWrite(paths.runtimeFile, content.endsWith("\n") ? content : `${content}\n`);
  }
  if (!exists(paths.archiveFile)) atomicWrite(paths.archiveFile, `${defaultArchiveContent()}\n`);
  if (!exists(paths.sparkFile)) atomicWrite(paths.sparkFile, "");
  if (!exists(paths.auditFile)) atomicWrite(paths.auditFile, "");
  if (!exists(paths.legacyGenesFile)) atomicWrite(paths.legacyGenesFile, `${defaultLegacyGenesContent()}\n`);
  if (!exists(paths.legacySparkFile)) atomicWrite(paths.legacySparkFile, `${defaultLegacySparkContent()}\n`);

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
  syncLegacyViews(paths);
  return state;
}

async function withLock(paths, fn) {
  ensureDir(paths.evolveDir);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      if (exists(paths.lockPath) && !fs.statSync(paths.lockPath).isDirectory()) {
        fs.unlinkSync(paths.lockPath);
      }
      fs.mkdirSync(paths.lockPath);
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
  return state && typeof state === "object" && !Array.isArray(state) ? state : initializeState(paths);
}

function writeState(paths, state) {
  writeJson(paths.stateFile, state);
  writeJson(paths.legacyCounterFile, {
    count: Number.parseInt(state.counter || 0, 10) || 0,
    timestamp: Number.parseInt(state.last_prompt_at || 0, 10) || 0,
  });
}

function countSparkRecords(paths) {
  if (!exists(paths.sparkFile)) return 0;
  return readText(paths.sparkFile).split(/\r?\n/).filter((line) => line.trim()).length;
}

function countJsonlRecords(file) {
  if (!exists(file)) return 0;
  let count = 0;
  for (const line of readText(file).split(/\r?\n/)) {
    if (!line.trim()) continue;
    JSON.parse(line);
    count += 1;
  }
  return count;
}

function loadSparkRecords(paths) {
  if (!exists(paths.sparkFile)) return [];
  const records = [];
  for (const line of readText(paths.sparkFile).split(/\r?\n/)) {
    if (!line.trim()) continue;
    records.push(JSON.parse(line));
  }
  return records;
}

function appendAuditEvent(paths, event) {
  appendLine(paths.auditFile, `${JSON.stringify(event)}\n`);
}

function extractGeneTitles(markdown) {
  const titles = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("## ")) continue;
    const title = line.slice(3).trim();
    if (["待初始化", "自进化机制（通用）"].includes(title)) continue;
    if (title) titles.add(title);
  }
  return titles;
}

function stripGeneratedSections(content) {
  return content.replace(/\n## 自进化机制（通用）\n[\s\S]*$/u, "").trimEnd();
}

function syncLegacyViews(paths) {
  const runtime = readText(paths.runtimeFile).trim();
  const archive = readText(paths.archiveFile).trim();
  const sparkRecords = loadSparkRecords(paths);
  const legacyGenes = [
    "# 🧠 GENES（兼容视图）",
    "",
    "_（请优先维护 `genes.runtime.md` 与 `genes.archive.md`。本文件由脚本同步生成，用于兼容旧项目习惯。）_",
    "",
    "## Runtime",
    "",
    stripGeneratedSections(runtime) || "_暂无内容_",
    "",
    "## Archive",
    "",
    stripGeneratedSections(archive) || "_暂无内容_",
    "",
  ];
  atomicWrite(paths.legacyGenesFile, `${legacyGenes.join("\n").trimEnd()}\n`);

  const sparkLines = [
    "# SPARK",
    "",
    "_（兼容视图。原始记录已迁移到 `spark.jsonl`，本文件仅做人类可读摘要。）_",
    "",
  ];
  if (sparkRecords.length > 0) {
    for (const record of sparkRecords.slice(-20)) {
      sparkLines.push(
        `## ${record.time || ""}: ${record.title || "未命名经验"}`,
        "",
        `- 类型：${record.type || "unknown"}`,
        `- 场景：${record.scenario || ""}`,
        `- 教训：${record.lesson || ""}`,
        `- 动作：${record.action || ""}`,
        `- 置信度：${record.confidence || "unknown"}`,
        "",
      );
    }
  } else {
    sparkLines.push("_暂无记录_");
  }
  atomicWrite(paths.legacySparkFile, `${sparkLines.join("\n").trimEnd()}\n`);
}

function renderProtocol(threshold) {
  return "回复末尾必须输出一个单独的 EVOLVE 结构化块。"
    + "格式为 `[EVOLVE]{...}[/EVOLVE]`，其中 `{...}` 必须是单行 JSON。"
    + "例如："
    + '[EVOLVE]{"record":"yes","title":"安装脚本不能覆盖现有 hooks","type":"engineering-rule","scenario":"目标项目已有 settings.local.json","lesson":"覆盖 UserPromptSubmit 会破坏原项目配置","action":"安装逻辑必须默认 merge 而不是 overwrite","confidence":"high"}[/EVOLVE]。'
    + `如果本轮没有可沉淀经验且 counter < ${threshold}，使用 `
    + '[EVOLVE]{"record":"no","reason":"routine turn"}[/EVOLVE]。'
    + `当 counter >= ${threshold} 时，不允许 \`record=no\`。`;
}

function truncateContext(text, limit = MAX_CONTEXT_CHARS) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[已截断：runtime 内容过长，请运行 evolve-compact 或精简 genes.runtime.md]`;
}

function buildAdditionalContext(paths, state, threshold) {
  const runtime = readText(paths.runtimeFile).trim();
  const sparkCount = countSparkRecords(paths);
  return truncateContext([
    "---",
    `[自进化状态] counter=${state.counter} / ${threshold} | spark=${sparkCount}`,
    renderProtocol(threshold),
    "",
    "🧠 Active GENES:",
    runtime || "_暂无 runtime 内容_",
  ].join("\n").trim());
}

async function updatePromptState(paths, threshold, counterWindow) {
  ensureLayout(paths);
  return withLock(paths, async () => {
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

function extractLastMessageFromTranscript(transcriptPath) {
  if (!transcriptPath || !exists(transcriptPath)) return "";
  let lastText = "";
  for (const line of readText(transcriptPath).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const payload = JSON.parse(line);
      if (payload.type !== "assistant") continue;
      const content = payload.message?.content || [];
      const parts = content.filter((item) => item.type === "text").map((item) => item.text || "");
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

function extractEvolveBlock(message) {
  if (!message) return null;
  const match = message.match(/\[EVOLVE\]\s*([\s\S]*?)\s*\[\/EVOLVE\]/u);
  if (!match) return null;
  return JSON.parse(match[1].trim());
}

function validateEvolvePayload(payload, thresholdReached) {
  const record = payload.record;
  if (!["yes", "no"].includes(record)) throw new ValidationError("record 必须为 yes 或 no");
  if (record === "no") {
    if (thresholdReached) throw new ValidationError("counter 达到阈值时不允许 record=no");
    if (!String(payload.reason || "").trim()) throw new ValidationError("record=no 时必须提供 reason");
    return;
  }
  for (const field of ["title", "type", "scenario", "lesson", "action", "confidence"]) {
    if (!String(payload[field] || "").trim()) throw new ValidationError(`缺少字段: ${field}`);
  }
  const confidence = String(payload.confidence || "").trim().toLowerCase();
  if (!(confidence in CONFIDENCE_SCORE)) throw new ValidationError("confidence 必须为 low、medium 或 high");
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
    source: {
      hook: "Stop",
      mode,
      session_id: hookInput.session_id || "",
    },
    status: "raw",
  };
}

function appendRecord(paths, record) {
  appendLine(paths.sparkFile, `${JSON.stringify(record)}\n`);
}

function renderRuntime(entries) {
  const lines = [
    "# GENES Runtime",
    "",
    "_（当前活跃基因。每轮自动注入，保持少而硬。）_",
    "",
  ];
  if (entries.length === 0) {
    lines.push("## 待初始化", "", "- 当前还没有沉淀出的活跃规则。", "- 请在真实项目会话中逐步积累并通过 compact 生成 runtime。");
    return `${lines.join("\n").trimEnd()}\n`;
  }
  for (const entry of entries) {
    lines.push(
      `## ${entry.title}`,
      "",
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
    "## 自进化机制（通用）",
    "",
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
      `## ${entry.title}`,
      "",
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

function summarizeRecords(records, runtimeLimit) {
  const grouped = new Map();
  for (const record of records) {
    const key = [record.type || "", record.title || "", record.action || ""].map((value) => String(value).trim().toLowerCase()).join("\u0000");
    if (!grouped.has(key)) {
      grouped.set(key, {
        title: record.title || "未命名经验",
        type: record.type || "unknown",
        scenario: record.scenario || "",
        lesson: record.lesson || "",
        action: record.action || "",
        confidence: record.confidence || "low",
        count: 0,
        last_seen: record.time || "",
      });
    }
    const entry = grouped.get(key);
    entry.count += 1;
    entry.last_seen = String(entry.last_seen) > String(record.time || "") ? entry.last_seen : record.time || "";
    if ((CONFIDENCE_SCORE[record.confidence || "low"] || 1) >= (CONFIDENCE_SCORE[entry.confidence] || 1)) {
      entry.confidence = record.confidence || "low";
      entry.scenario = record.scenario || entry.scenario;
      entry.lesson = record.lesson || entry.lesson;
      entry.action = record.action || entry.action;
    }
  }
  const entries = Array.from(grouped.values()).sort((a, b) => {
    const keysA = [a.count, CONFIDENCE_SCORE[a.confidence] || 1, a.last_seen, a.title];
    const keysB = [b.count, CONFIDENCE_SCORE[b.confidence] || 1, b.last_seen, b.title];
    for (let index = 0; index < keysA.length; index += 1) {
      if (keysA[index] > keysB[index]) return -1;
      if (keysA[index] < keysB[index]) return 1;
    }
    return 0;
  });
  return [entries.slice(0, runtimeLimit), entries.slice(runtimeLimit)];
}

function buildAuditEvents(beforeRuntimeTitles, beforeArchiveTitles, runtimeEntries, archiveEntries, sourceRecordCount) {
  const afterRuntimeTitles = new Set(runtimeEntries.map((entry) => entry.title));
  const afterArchiveTitles = new Set(archiveEntries.map((entry) => entry.title));
  const currentTime = timestamp();
  const promotedTitles = [...afterRuntimeTitles].filter((title) => !beforeRuntimeTitles.has(title)).sort();
  const archivedTitles = [...afterArchiveTitles].filter((title) => !beforeArchiveTitles.has(title)).sort();
  const droppedTitles = [...new Set([...beforeRuntimeTitles, ...beforeArchiveTitles])]
    .filter((title) => !afterRuntimeTitles.has(title) && !afterArchiveTitles.has(title))
    .sort();
  const events = [{
    time: currentTime,
    event: "compact_run",
    runtime_before: [...beforeRuntimeTitles].sort(),
    runtime_after: [...afterRuntimeTitles].sort(),
    archive_before: [...beforeArchiveTitles].sort(),
    archive_after: [...afterArchiveTitles].sort(),
    promoted_titles: promotedTitles,
    archived_titles: archivedTitles,
    dropped_titles: droppedTitles,
    reason: "recomputed_from_spark",
    source_record_count: sourceRecordCount,
  }];
  for (const title of promotedTitles) events.push({ time: currentTime, event: "promote_to_runtime", title, reason: "ranked_into_runtime", source_record_count: sourceRecordCount });
  for (const title of archivedTitles) events.push({ time: currentTime, event: "move_to_archive", title, reason: "not_selected_for_runtime", source_record_count: sourceRecordCount });
  for (const title of droppedTitles) events.push({ time: currentTime, event: "drop_gene", title, reason: "no_longer_present_in_compact_result", source_record_count: sourceRecordCount });
  return events;
}

async function commandCompact(paths, silent = false) {
  ensureLayout(paths);
  let result;
  await withLock(paths, async () => {
    const records = loadSparkRecords(paths);
    const runtimeLimit = envInt("EVOLVE_RUNTIME_LIMIT", DEFAULT_RUNTIME_LIMIT);
    const beforeRuntimeTitles = extractGeneTitles(readText(paths.runtimeFile));
    const beforeArchiveTitles = extractGeneTitles(readText(paths.archiveFile));
    const [runtimeEntries, archiveEntries] = summarizeRecords(records, runtimeLimit);
    atomicWrite(paths.runtimeFile, renderRuntime(runtimeEntries));
    atomicWrite(paths.archiveFile, renderArchive(archiveEntries));
    for (const event of buildAuditEvents(beforeRuntimeTitles, beforeArchiveTitles, runtimeEntries, archiveEntries, records.length)) {
      appendAuditEvent(paths, event);
    }
    const state = loadState(paths);
    state.last_compact_at = nowTs();
    state.runtime_gene_count = runtimeEntries.length;
    state.spark_record_count = records.length;
    writeState(paths, state);
    syncLegacyViews(paths);
    result = { runtime: runtimeEntries.length, archive: archiveEntries.length, spark: records.length };
  });
  if (!silent) {
    console.log(`[自进化] compact 完成：runtime=${result.runtime} 条，archive=${result.archive} 条，spark=${result.spark} 条`);
  }
  return 0;
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

async function maybeCompact(paths) {
  const threshold = envInt("EVOLVE_COMPACT_THRESHOLD", DEFAULT_COMPACT_THRESHOLD);
  if (countSparkRecords(paths) >= threshold) await commandCompact(paths, true);
}

async function commandCapture(paths) {
  ensureLayout(paths);
  const raw = await readStdin();
  if (!raw.trim()) {
    console.error("[自进化警告] Stop hook 未收到 JSON 输入");
    return 1;
  }
  const hookInput = JSON.parse(raw);
  const stopHookActive = Boolean(hookInput.stop_hook_active);
  let recordWritten = false;
  let validationError = null;
  await withLock(paths, async () => {
    const state = loadState(paths);
    const threshold = envInt("EVOLVE_THRESHOLD", DEFAULT_COUNTER_THRESHOLD);
    const count = Number.parseInt(state.counter || 0, 10) || 0;
    let lastMessage = String(hookInput.last_assistant_message || "").trim();
    if (!lastMessage) lastMessage = extractLastMessageFromTranscript(String(hookInput.transcript_path || "")).trim();
    let payload = null;
    try {
      payload = extractEvolveBlock(lastMessage);
      if (payload !== null) validateEvolvePayload(payload, count >= threshold);
    } catch (error) {
      payload = null;
      validationError = error.message;
    }
    if (payload === null && count >= threshold && !stopHookActive) {
      console.error("[自进化阻断] counter 已达阈值，但回复末尾没有合格的 EVOLVE 结构化块。请补充 `[EVOLVE]{...}[/EVOLVE]` 后再结束。");
      process.exitCode = 2;
      return;
    }
    if (payload === null && count >= threshold && stopHookActive) payload = fallbackRecord(hookInput);
    if (payload !== null && payload.record === "yes") {
      appendRecord(paths, buildRecord(payload, hookInput, validationError === null ? "assistant" : "forced-fallback"));
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
    syncLegacyViews(paths);
  });
  if (process.exitCode === 2) return 2;
  if (recordWritten) {
    await maybeCompact(paths);
    console.log("[自进化] 已写入 spark.jsonl 并重置 counter");
  } else if (validationError) {
    console.error(`[自进化警告] EVOLVE 结构无效：${validationError}`);
  }
  return 0;
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commandHealth(paths) {
  const issues = [];
  ensureLayout(paths);
  for (const required of [paths.stateFile, paths.sparkFile, paths.auditFile, paths.runtimeFile, paths.archiveFile]) {
    if (!exists(required)) issues.push(`缺少文件：${required}`);
  }
  for (const requiredExec of [
    path.join(paths.projectDir, ".claude", "evolve-hook.sh"),
    path.join(paths.projectDir, ".claude", "evolve-capture.sh"),
    path.join(paths.projectDir, ".claude", "evolve-compact.sh"),
    path.join(paths.projectDir, ".claude", "evolve-health.sh"),
    path.join(paths.projectDir, ".claude", "evolve.mjs"),
  ]) {
    if (!exists(requiredExec)) issues.push(`缺少脚本：${requiredExec}`);
    else if (!isExecutable(requiredExec)) issues.push(`脚本不可执行：${requiredExec}`);
  }
  try {
    const settings = loadJson(paths.settingsFile, {});
    const hooks = settings.hooks || {};
    const promptCommands = (hooks.UserPromptSubmit || []).flatMap((matcher) => matcher.hooks || []).map((hook) => hook.command);
    const stopCommands = (hooks.Stop || []).flatMap((matcher) => matcher.hooks || []).map((hook) => hook.command);
    if (!promptCommands.includes("$CLAUDE_PROJECT_DIR/.claude/evolve-hook.sh")) issues.push("UserPromptSubmit 未接入 evolve-hook.sh");
    if (!stopCommands.includes("$CLAUDE_PROJECT_DIR/.claude/evolve-capture.sh") && !stopCommands.includes("$CLAUDE_PROJECT_DIR/.claude/evolve-verify.sh")) {
      issues.push("Stop 未接入 evolve-capture.sh");
    }
  } catch (error) {
    issues.push(`settings.local.json 解析失败：${error.message}`);
  }
  try { loadJson(paths.stateFile, {}); } catch (error) { issues.push(`state.json 解析失败：${error.message}`); }
  let installedVersion = "unknown";
  try {
    installedVersion = loadJson(paths.installMetaFile, {}).installed_version || "unknown";
  } catch (error) {
    issues.push(`self-evolve.json 解析失败：${error.message}`);
  }
  try { loadSparkRecords(paths); } catch (error) { issues.push(`spark.jsonl 解析失败：${error.message}`); }
  try { countJsonlRecords(paths.auditFile); } catch (error) { issues.push(`audit.jsonl 解析失败：${error.message}`); }
  const summary = {
    schema_version: SCHEMA_VERSION,
    installed_version: installedVersion,
    runtime_gene_count: loadState(paths).runtime_gene_count || 0,
    spark_record_count: countSparkRecords(paths),
    audit_event_count: countJsonlRecords(paths.auditFile),
    issues,
  };
  console.log(JSON.stringify(summary, null, 2));
  return issues.length === 0 ? 0 : 1;
}

async function main() {
  const { command, projectDir } = parseArgs();
  const paths = buildPaths(projectDir);
  try {
    if (command === "hook") return await commandHook(paths);
    if (command === "capture") return await commandCapture(paths);
    if (command === "compact") return await commandCompact(paths);
    if (command === "health") return commandHealth(paths);
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`[自进化错误] JSON 解析失败：${error.message}`);
    } else {
      console.error(`[自进化错误] ${error.message}`);
    }
    return 1;
  }
  return 1;
}

process.exit(await main());
