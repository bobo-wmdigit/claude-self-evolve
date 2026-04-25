#!/usr/bin/env python3
"""Claude Self-Evolve runtime helper."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 2
DEFAULT_COUNTER_THRESHOLD = 5
DEFAULT_COUNTER_WINDOW = 1800
DEFAULT_COMPACT_THRESHOLD = 10
DEFAULT_RUNTIME_LIMIT = 12
MAX_CONTEXT_CHARS = 8000
CONFIDENCE_SCORE = {"low": 1, "medium": 2, "high": 3}


@dataclass(frozen=True)
class Paths:
    project_dir: Path
    evolve_dir: Path
    state_file: Path
    spark_file: Path
    audit_file: Path
    runtime_file: Path
    archive_file: Path
    legacy_genes_file: Path
    legacy_spark_file: Path
    legacy_counter_file: Path
    lock_file: Path
    settings_file: Path


class ValidationError(Exception):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Claude Self-Evolve helper")
    parser.add_argument("command", choices=["hook", "capture", "compact", "health"])
    parser.add_argument("--project-dir", required=True)
    return parser.parse_args()


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def build_paths(project_dir: str) -> Paths:
    root = Path(project_dir).resolve()
    evolve_dir = root / ".evolve"
    return Paths(
        project_dir=root,
        evolve_dir=evolve_dir,
        state_file=evolve_dir / "state.json",
        spark_file=evolve_dir / "spark.jsonl",
        audit_file=evolve_dir / "audit.jsonl",
        runtime_file=evolve_dir / "genes.runtime.md",
        archive_file=evolve_dir / "genes.archive.md",
        legacy_genes_file=evolve_dir / "GENES.md",
        legacy_spark_file=evolve_dir / "SPARK.md",
        legacy_counter_file=evolve_dir / ".counter",
        lock_file=evolve_dir / "lock",
        settings_file=root / ".claude" / "settings.local.json",
    )


def now_ts() -> int:
    return int(time.time())


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", delete=False, dir=str(path.parent), encoding="utf-8") as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)
    tmp_path.replace(path)


def append_line_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(content)


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def read_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def write_json(path: Path, payload: Any) -> None:
    atomic_write(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def default_runtime_content() -> str:
    return """# GENES Runtime

_（当前活跃基因。每轮自动注入，保持少而硬。）_

## 待初始化

- 首次进入项目时，先读 README、关键配置和目录结构，再补充本文件。
- 这里只保留当前高频有效、值得每轮提醒的规则。
- 每条规则要说明适用场景、经验教训和建议动作。
"""


def default_archive_content() -> str:
    return """# GENES Archive

_（历史归档基因。保留但不默认注入。）_
"""


def default_legacy_genes_content() -> str:
    return """# 🧠 GENES（兼容视图）

_（请优先维护 `genes.runtime.md` 与 `genes.archive.md`。本文件由脚本同步生成，用于兼容旧项目习惯。）_
"""


def default_legacy_spark_content() -> str:
    return """# SPARK

_（兼容视图。原始记录已迁移到 `spark.jsonl`，本文件仅做人类可读摘要。）_
"""


def initialize_state(paths: Paths) -> dict[str, Any]:
    legacy_count = 0
    legacy_prompt_at = 0
    if paths.legacy_counter_file.exists():
        try:
            legacy_payload = load_json(paths.legacy_counter_file, {})
            legacy_count = int(legacy_payload.get("count", 0))
            legacy_prompt_at = int(legacy_payload.get("timestamp", 0))
        except Exception:
            legacy_count = 0
            legacy_prompt_at = 0

    state = {
        "schema_version": SCHEMA_VERSION,
        "counter": legacy_count,
        "last_prompt_at": legacy_prompt_at,
        "last_capture_at": 0,
        "last_compact_at": 0,
        "last_reset_reason": "",
        "runtime_gene_count": 0,
        "spark_record_count": 0,
    }
    write_json(paths.state_file, state)
    return state


def ensure_layout(paths: Paths) -> dict[str, Any]:
    paths.evolve_dir.mkdir(parents=True, exist_ok=True)
    if not paths.runtime_file.exists():
        legacy = read_text(paths.legacy_genes_file).strip()
        content = default_runtime_content()
        if legacy and "待初始化" not in legacy and "兼容视图" not in legacy:
            content = "# GENES Runtime\n\n_（从旧版 GENES.md 导入，建议后续按新结构整理。）_\n\n" + legacy + "\n"
        atomic_write(paths.runtime_file, content if content.endswith("\n") else content + "\n")
    if not paths.archive_file.exists():
        atomic_write(paths.archive_file, default_archive_content() + "\n")
    if not paths.spark_file.exists():
        atomic_write(paths.spark_file, "")
    if not paths.audit_file.exists():
        atomic_write(paths.audit_file, "")
    if not paths.legacy_genes_file.exists():
        atomic_write(paths.legacy_genes_file, default_legacy_genes_content() + "\n")
    if not paths.legacy_spark_file.exists():
        atomic_write(paths.legacy_spark_file, default_legacy_spark_content() + "\n")
    if not paths.state_file.exists():
        state = initialize_state(paths)
    else:
        state = load_json(paths.state_file, {})
        if not isinstance(state, dict):
            state = initialize_state(paths)
        elif int(state.get("schema_version", 0)) != SCHEMA_VERSION:
            state = migrate_state(paths, state)
    sync_legacy_views(paths)
    return state


def migrate_state(paths: Paths, state: dict[str, Any]) -> dict[str, Any]:
    migrated = {
        "schema_version": SCHEMA_VERSION,
        "counter": int(state.get("counter", state.get("count", 0)) or 0),
        "last_prompt_at": int(state.get("last_prompt_at", state.get("timestamp", 0)) or 0),
        "last_capture_at": int(state.get("last_capture_at", 0) or 0),
        "last_compact_at": int(state.get("last_compact_at", 0) or 0),
        "last_reset_reason": str(state.get("last_reset_reason", "")),
        "runtime_gene_count": int(state.get("runtime_gene_count", 0) or 0),
        "spark_record_count": int(state.get("spark_record_count", 0) or 0),
    }
    write_json(paths.state_file, migrated)
    return migrated


def lock_file(path: Path):
    handle = path.open("a+", encoding="utf-8")
    fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
    return handle


def load_state(paths: Paths) -> dict[str, Any]:
    if not paths.state_file.exists():
        return initialize_state(paths)
    state = load_json(paths.state_file, {})
    if not isinstance(state, dict):
        return initialize_state(paths)
    return state


def write_state(paths: Paths, state: dict[str, Any]) -> None:
    write_json(paths.state_file, state)
    legacy_counter = {
        "count": int(state.get("counter", 0)),
        "timestamp": int(state.get("last_prompt_at", 0)),
    }
    write_json(paths.legacy_counter_file, legacy_counter)


def count_spark_records(paths: Paths) -> int:
    if not paths.spark_file.exists():
        return 0
    count = 0
    with paths.spark_file.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                count += 1
    return count


def count_jsonl_records(path: Path) -> int:
    if not path.exists():
        return 0
    count = 0
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            json.loads(line)
            count += 1
    return count


def load_spark_records(paths: Paths) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    if not paths.spark_file.exists():
        return records
    with paths.spark_file.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))
    return records


def append_audit_event(paths: Paths, event: dict[str, Any]) -> None:
    append_line_atomic(paths.audit_file, json.dumps(event, ensure_ascii=False) + "\n")


def extract_gene_titles(markdown: str) -> set[str]:
    titles: set[str] = set()
    for line in markdown.splitlines():
        if not line.startswith("## "):
            continue
        title = line[3:].strip()
        if title in {"待初始化", "自进化机制（通用）"}:
            continue
        if title:
            titles.add(title)
    return titles


def strip_generated_sections(content: str) -> str:
    content = re.sub(
        r"\n## 自进化机制（通用）\n.*\Z",
        "",
        content,
        flags=re.S,
    ).rstrip()
    return content


def sync_legacy_views(paths: Paths) -> None:
    runtime = read_text(paths.runtime_file).strip()
    archive = read_text(paths.archive_file).strip()
    spark_records = load_spark_records(paths)

    legacy_genes = [
        "# 🧠 GENES（兼容视图）",
        "",
        "_（请优先维护 `genes.runtime.md` 与 `genes.archive.md`。本文件由脚本同步生成，用于兼容旧项目习惯。）_",
        "",
        "## Runtime",
        "",
        strip_generated_sections(runtime) or "_暂无内容_",
        "",
        "## Archive",
        "",
        strip_generated_sections(archive) or "_暂无内容_",
        "",
    ]
    atomic_write(paths.legacy_genes_file, "\n".join(legacy_genes).rstrip() + "\n")

    spark_lines = [
        "# SPARK",
        "",
        "_（兼容视图。原始记录已迁移到 `spark.jsonl`，本文件仅做人类可读摘要。）_",
        "",
    ]
    if spark_records:
        for record in spark_records[-20:]:
            spark_lines.extend(
                [
                    f"## {record.get('time', '')}: {record.get('title', '未命名经验')}",
                    "",
                    f"- 类型：{record.get('type', 'unknown')}",
                    f"- 场景：{record.get('scenario', '')}",
                    f"- 教训：{record.get('lesson', '')}",
                    f"- 动作：{record.get('action', '')}",
                    f"- 置信度：{record.get('confidence', 'unknown')}",
                    "",
                ]
            )
    else:
        spark_lines.append("_暂无记录_")
    atomic_write(paths.legacy_spark_file, "\n".join(spark_lines).rstrip() + "\n")


def compact_markdown(text: str) -> str:
    text = text.strip()
    if not text:
        return "_暂无内容_"
    return text


def render_protocol(threshold: int) -> str:
    return (
        "回复末尾必须输出一个单独的 EVOLVE 结构化块。"
        "格式为 `[EVOLVE]{...}[/EVOLVE]`，其中 `{...}` 必须是单行 JSON。"
        "例如："
        '[EVOLVE]{"record":"yes","title":"安装脚本不能覆盖现有 hooks","type":"engineering-rule","scenario":"目标项目已有 settings.local.json","lesson":"覆盖 UserPromptSubmit 会破坏原项目配置","action":"安装逻辑必须默认 merge 而不是 overwrite","confidence":"high"}[/EVOLVE]。'
        f"如果本轮没有可沉淀经验且 counter < {threshold}，使用 "
        '[EVOLVE]{"record":"no","reason":"routine turn"}[/EVOLVE]。'
        f"当 counter >= {threshold} 时，不允许 `record=no`。"
    )


def truncate_context(text: str, limit: int = MAX_CONTEXT_CHARS) -> str:
    if len(text) <= limit:
        return text
    head = text[:limit]
    return head + "\n\n[已截断：runtime 内容过长，请运行 evolve-compact 或精简 genes.runtime.md]"


def build_additional_context(paths: Paths, state: dict[str, Any], threshold: int) -> str:
    runtime = read_text(paths.runtime_file).strip()
    spark_count = count_spark_records(paths)
    message = [
        "---",
        f"[自进化状态] counter={state['counter']} / {threshold} | spark={spark_count}",
        render_protocol(threshold),
        "",
        "🧠 Active GENES:",
        runtime or "_暂无 runtime 内容_",
    ]
    return truncate_context("\n".join(message).strip())


def update_prompt_state(paths: Paths, threshold: int, counter_window: int) -> dict[str, Any]:
    ensure_layout(paths)
    with lock_file(paths.lock_file):
        state = load_state(paths)
        current = now_ts()
        last_prompt_at = int(state.get("last_prompt_at", 0) or 0)
        counter = int(state.get("counter", 0) or 0)
        if last_prompt_at and current - last_prompt_at > counter_window:
            counter = 0
        counter += 1
        state["counter"] = counter
        state["last_prompt_at"] = current
        state["spark_record_count"] = count_spark_records(paths)
        write_state(paths, state)
    return state


def emit_json(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


def command_hook(paths: Paths) -> int:
    threshold = env_int("EVOLVE_THRESHOLD", DEFAULT_COUNTER_THRESHOLD)
    counter_window = env_int("EVOLVE_COUNTER_WINDOW", DEFAULT_COUNTER_WINDOW)
    state = update_prompt_state(paths, threshold, counter_window)
    additional_context = build_additional_context(paths, state, threshold)
    emit_json(
        {
            "hookSpecificOutput": {
                "hookEventName": "UserPromptSubmit",
                "additionalContext": additional_context,
            }
        }
    )
    return 0


def extract_last_message_from_transcript(transcript_path: str) -> str:
    if not transcript_path:
        return ""
    path = Path(transcript_path)
    if not path.exists():
        return ""
    last_text = ""
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if payload.get("type") != "assistant":
                continue
            message = payload.get("message", {})
            content = message.get("content", [])
            text_parts: list[str] = []
            for item in content:
                if item.get("type") == "text":
                    text_parts.append(item.get("text", ""))
            last_text = "\n".join(part for part in text_parts if part)
    return last_text


def read_hook_input() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return json.loads(raw)


def extract_evolve_block(message: str) -> dict[str, Any] | None:
    if not message:
        return None
    match = re.search(r"\[EVOLVE\]\s*(.*?)\s*\[/EVOLVE\]", message, flags=re.S)
    if not match:
        return None
    payload = match.group(1).strip()
    return json.loads(payload)


def validate_evolve_payload(payload: dict[str, Any], threshold_reached: bool) -> None:
    record = payload.get("record")
    if record not in {"yes", "no"}:
        raise ValidationError("record 必须为 yes 或 no")
    if record == "no":
        if threshold_reached:
            raise ValidationError("counter 达到阈值时不允许 record=no")
        if not str(payload.get("reason", "")).strip():
            raise ValidationError("record=no 时必须提供 reason")
        return
    required = ["title", "type", "scenario", "lesson", "action", "confidence"]
    for field in required:
        if not str(payload.get(field, "")).strip():
            raise ValidationError(f"缺少字段: {field}")
    confidence = str(payload.get("confidence", "")).strip().lower()
    if confidence not in CONFIDENCE_SCORE:
        raise ValidationError("confidence 必须为 low、medium 或 high")


def build_record(payload: dict[str, Any], hook_input: dict[str, Any], mode: str) -> dict[str, Any]:
    current = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
    excerpt = str(hook_input.get("last_assistant_message", "")).strip()[:240]
    return {
        "id": str(uuid.uuid4()),
        "time": current,
        "title": payload.get("title", "Forced checkpoint"),
        "type": payload.get("type", "forced-checkpoint"),
        "scenario": payload.get("scenario", "达到阈值但未形成合格的结构化经验块"),
        "lesson": payload.get("lesson", excerpt or "本轮缺少可解析经验，系统生成保底记录。"),
        "action": payload.get("action", "回看最近一轮任务，总结为可复用规则后再优化 runtime。"),
        "confidence": payload.get("confidence", "low"),
        "source": {
            "hook": "Stop",
            "mode": mode,
            "session_id": hook_input.get("session_id", ""),
        },
        "status": "raw",
    }


def append_record(paths: Paths, record: dict[str, Any]) -> None:
    append_line_atomic(paths.spark_file, json.dumps(record, ensure_ascii=False) + "\n")


def render_runtime(entries: list[dict[str, Any]]) -> str:
    lines = [
        "# GENES Runtime",
        "",
        "_（当前活跃基因。每轮自动注入，保持少而硬。）_",
        "",
    ]
    if not entries:
        lines.extend(
            [
                "## 待初始化",
                "",
                "- 当前还没有沉淀出的活跃规则。",
                "- 请在真实项目会话中逐步积累并通过 compact 生成 runtime。",
            ]
        )
        return "\n".join(lines).rstrip() + "\n"

    for entry in entries:
        lines.extend(
            [
                f"## {entry['title']}",
                "",
                f"- 类型：{entry['type']}",
                f"- 适用场景：{entry['scenario']}",
                f"- 经验教训：{entry['lesson']}",
                f"- 建议动作：{entry['action']}",
                f"- 验证强度：{entry['confidence']}",
                f"- 出现频次：{entry['count']}",
                f"- 最后验证：{entry['last_seen']}",
                "",
            ]
        )

    lines.extend(
        [
            "## 自进化机制（通用）",
            "",
            "- 每轮只注入 runtime，不注入 archive。",
            "- 原始火花统一写入 `spark.jsonl`。",
            "- 通过 `evolve-compact.sh` 合并重复经验并更新 runtime。",
        ]
    )
    return "\n".join(lines).rstrip() + "\n"


def render_archive(entries: list[dict[str, Any]]) -> str:
    lines = [
        "# GENES Archive",
        "",
        "_（历史归档基因。保留但不默认注入。）_",
        "",
    ]
    if not entries:
        lines.append("_暂无归档内容_")
        return "\n".join(lines).rstrip() + "\n"

    for entry in entries:
        lines.extend(
            [
                f"## {entry['title']}",
                "",
                f"- 类型：{entry['type']}",
                f"- 适用场景：{entry['scenario']}",
                f"- 经验教训：{entry['lesson']}",
                f"- 建议动作：{entry['action']}",
                f"- 验证强度：{entry['confidence']}",
                f"- 出现频次：{entry['count']}",
                f"- 最后验证：{entry['last_seen']}",
                "",
            ]
        )
    return "\n".join(lines).rstrip() + "\n"


def summarize_records(records: list[dict[str, Any]], runtime_limit: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    grouped: dict[tuple[str, str, str], dict[str, Any]] = {}
    for record in records:
        key = (
            str(record.get("type", "")).strip().lower(),
            str(record.get("title", "")).strip().lower(),
            str(record.get("action", "")).strip().lower(),
        )
        if key not in grouped:
            grouped[key] = {
                "title": record.get("title", "未命名经验"),
                "type": record.get("type", "unknown"),
                "scenario": record.get("scenario", ""),
                "lesson": record.get("lesson", ""),
                "action": record.get("action", ""),
                "confidence": record.get("confidence", "low"),
                "count": 0,
                "last_seen": record.get("time", ""),
            }
        grouped_entry = grouped[key]
        grouped_entry["count"] += 1
        grouped_entry["last_seen"] = max(grouped_entry["last_seen"], record.get("time", ""))
        if CONFIDENCE_SCORE.get(record.get("confidence", "low"), 1) >= CONFIDENCE_SCORE.get(grouped_entry["confidence"], 1):
            grouped_entry["confidence"] = record.get("confidence", "low")
            grouped_entry["scenario"] = record.get("scenario", grouped_entry["scenario"])
            grouped_entry["lesson"] = record.get("lesson", grouped_entry["lesson"])
            grouped_entry["action"] = record.get("action", grouped_entry["action"])

    entries = list(grouped.values())
    entries.sort(
        key=lambda item: (
            item["count"],
            CONFIDENCE_SCORE.get(item["confidence"], 1),
            item["last_seen"],
            item["title"],
        ),
        reverse=True,
    )
    runtime_entries = entries[:runtime_limit]
    archive_entries = entries[runtime_limit:]
    return runtime_entries, archive_entries


def build_audit_events(
    before_runtime_titles: set[str],
    before_archive_titles: set[str],
    runtime_entries: list[dict[str, Any]],
    archive_entries: list[dict[str, Any]],
    source_record_count: int,
) -> list[dict[str, Any]]:
    after_runtime_titles = {entry["title"] for entry in runtime_entries}
    after_archive_titles = {entry["title"] for entry in archive_entries}
    current_time = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())

    promoted_titles = sorted(after_runtime_titles - before_runtime_titles)
    archived_titles = sorted(after_archive_titles - before_archive_titles)
    dropped_titles = sorted((before_runtime_titles | before_archive_titles) - (after_runtime_titles | after_archive_titles))

    events: list[dict[str, Any]] = [
        {
            "time": current_time,
            "event": "compact_run",
            "runtime_before": sorted(before_runtime_titles),
            "runtime_after": sorted(after_runtime_titles),
            "archive_before": sorted(before_archive_titles),
            "archive_after": sorted(after_archive_titles),
            "promoted_titles": promoted_titles,
            "archived_titles": archived_titles,
            "dropped_titles": dropped_titles,
            "reason": "recomputed_from_spark",
            "source_record_count": source_record_count,
        }
    ]

    for title in promoted_titles:
        events.append(
            {
                "time": current_time,
                "event": "promote_to_runtime",
                "title": title,
                "reason": "ranked_into_runtime",
                "source_record_count": source_record_count,
            }
        )
    for title in archived_titles:
        events.append(
            {
                "time": current_time,
                "event": "move_to_archive",
                "title": title,
                "reason": "not_selected_for_runtime",
                "source_record_count": source_record_count,
            }
        )
    for title in dropped_titles:
        events.append(
            {
                "time": current_time,
                "event": "drop_gene",
                "title": title,
                "reason": "no_longer_present_in_compact_result",
                "source_record_count": source_record_count,
            }
        )
    return events


def command_compact(paths: Paths, silent: bool = False) -> int:
    ensure_layout(paths)
    with lock_file(paths.lock_file):
        records = load_spark_records(paths)
        runtime_limit = env_int("EVOLVE_RUNTIME_LIMIT", DEFAULT_RUNTIME_LIMIT)
        before_runtime_titles = extract_gene_titles(read_text(paths.runtime_file))
        before_archive_titles = extract_gene_titles(read_text(paths.archive_file))
        runtime_entries, archive_entries = summarize_records(records, runtime_limit)
        atomic_write(paths.runtime_file, render_runtime(runtime_entries))
        atomic_write(paths.archive_file, render_archive(archive_entries))
        audit_events = build_audit_events(
            before_runtime_titles,
            before_archive_titles,
            runtime_entries,
            archive_entries,
            len(records),
        )
        for event in audit_events:
            append_audit_event(paths, event)
        state = load_state(paths)
        state["last_compact_at"] = now_ts()
        state["runtime_gene_count"] = len(runtime_entries)
        state["spark_record_count"] = len(records)
        write_state(paths, state)
        sync_legacy_views(paths)
    if not silent:
        print(
            f"[自进化] compact 完成：runtime={len(runtime_entries)} 条，archive={len(archive_entries)} 条，spark={len(records)} 条"
        )
    return 0


def fallback_record(hook_input: dict[str, Any]) -> dict[str, Any]:
    excerpt = str(hook_input.get("last_assistant_message", "")).strip()[:240]
    return {
        "record": "yes",
        "title": "Forced checkpoint",
        "type": "forced-checkpoint",
        "scenario": "counter 达到阈值但回复未提供可解析的 EVOLVE 记录",
        "lesson": excerpt or "系统未读到合格的 EVOLVE 结构化块，因此写入一条保底记录。",
        "action": "回看最近一轮任务，把隐含规则补充为明确的工程经验。",
        "confidence": "low",
    }


def maybe_compact(paths: Paths) -> None:
    threshold = env_int("EVOLVE_COMPACT_THRESHOLD", DEFAULT_COMPACT_THRESHOLD)
    if count_spark_records(paths) >= threshold:
        command_compact(paths, silent=True)


def command_capture(paths: Paths) -> int:
    ensure_layout(paths)
    hook_input = read_hook_input()
    if not hook_input:
        print("[自进化警告] Stop hook 未收到 JSON 输入", file=sys.stderr)
        return 1

    stop_hook_active = bool(hook_input.get("stop_hook_active", False))
    with lock_file(paths.lock_file):
        state = load_state(paths)
        threshold = env_int("EVOLVE_THRESHOLD", DEFAULT_COUNTER_THRESHOLD)
        count = int(state.get("counter", 0) or 0)
        last_message = str(hook_input.get("last_assistant_message", "")).strip()
        if not last_message:
            last_message = extract_last_message_from_transcript(str(hook_input.get("transcript_path", ""))).strip()

        payload: dict[str, Any] | None
        validation_error: str | None = None
        try:
            payload = extract_evolve_block(last_message)
            if payload is not None:
                validate_evolve_payload(payload, threshold_reached=count >= threshold)
        except (json.JSONDecodeError, ValidationError) as exc:
            payload = None
            validation_error = str(exc)

        if payload is None and count >= threshold and not stop_hook_active:
            print(
                "[自进化阻断] counter 已达阈值，但回复末尾没有合格的 EVOLVE 结构化块。请补充 `[EVOLVE]{...}[/EVOLVE]` 后再结束。",
                file=sys.stderr,
            )
            return 2

        record_written = False
        if payload is None and count >= threshold and stop_hook_active:
            payload = fallback_record(hook_input)
        if payload is not None and payload.get("record") == "yes":
            record = build_record(payload, hook_input, "assistant" if validation_error is None else "forced-fallback")
            append_record(paths, record)
            record_written = True
            state["counter"] = 0
            state["last_reset_reason"] = "record_written"
        elif payload is not None and payload.get("record") == "no":
            state["last_reset_reason"] = "skipped"
        elif validation_error:
            state["last_reset_reason"] = f"invalid_evolve:{validation_error}"

        state["last_capture_at"] = now_ts()
        state["spark_record_count"] = count_spark_records(paths)
        write_state(paths, state)
        sync_legacy_views(paths)

    if record_written:
        maybe_compact(paths)
        print("[自进化] 已写入 spark.jsonl 并重置 counter")
    elif validation_error:
        print(f"[自进化警告] EVOLVE 结构无效：{validation_error}", file=sys.stderr)
    return 0


def command_health(paths: Paths) -> int:
    issues: list[str] = []
    ensure_layout(paths)

    for required in [paths.state_file, paths.spark_file, paths.audit_file, paths.runtime_file, paths.archive_file]:
        if not required.exists():
            issues.append(f"缺少文件：{required}")

    for required_exec in [
        paths.project_dir / ".claude" / "evolve-hook.sh",
        paths.project_dir / ".claude" / "evolve-capture.sh",
        paths.project_dir / ".claude" / "evolve-compact.sh",
        paths.project_dir / ".claude" / "evolve-health.sh",
    ]:
        if not required_exec.exists():
            issues.append(f"缺少脚本：{required_exec}")
        elif not os.access(required_exec, os.X_OK):
            issues.append(f"脚本不可执行：{required_exec}")

    try:
        settings = load_json(paths.settings_file, {})
        hooks = settings.get("hooks", {})
        prompt_commands = [
            hook.get("command")
            for matcher in hooks.get("UserPromptSubmit", [])
            for hook in matcher.get("hooks", [])
        ]
        stop_commands = [
            hook.get("command")
            for matcher in hooks.get("Stop", [])
            for hook in matcher.get("hooks", [])
        ]
        if "$CLAUDE_PROJECT_DIR/.claude/evolve-hook.sh" not in prompt_commands:
            issues.append("UserPromptSubmit 未接入 evolve-hook.sh")
        if "$CLAUDE_PROJECT_DIR/.claude/evolve-capture.sh" not in stop_commands and "$CLAUDE_PROJECT_DIR/.claude/evolve-verify.sh" not in stop_commands:
            issues.append("Stop 未接入 evolve-capture.sh")
    except Exception as exc:
        issues.append(f"settings.local.json 解析失败：{exc}")

    try:
        load_json(paths.state_file, {})
    except Exception as exc:
        issues.append(f"state.json 解析失败：{exc}")

    try:
        load_spark_records(paths)
    except Exception as exc:
        issues.append(f"spark.jsonl 解析失败：{exc}")

    try:
        count_jsonl_records(paths.audit_file)
    except Exception as exc:
        issues.append(f"audit.jsonl 解析失败：{exc}")

    summary = {
        "schema_version": SCHEMA_VERSION,
        "runtime_gene_count": load_state(paths).get("runtime_gene_count", 0),
        "spark_record_count": count_spark_records(paths),
        "audit_event_count": count_jsonl_records(paths.audit_file),
        "issues": issues,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if not issues else 1


def main() -> int:
    args = parse_args()
    paths = build_paths(args.project_dir)
    try:
        if args.command == "hook":
            return command_hook(paths)
        if args.command == "capture":
            return command_capture(paths)
        if args.command == "compact":
            return command_compact(paths)
        if args.command == "health":
            return command_health(paths)
    except json.JSONDecodeError as exc:
        print(f"[自进化错误] JSON 解析失败：{exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # pragma: no cover - last resort
        print(f"[自进化错误] {exc}", file=sys.stderr)
        return 1
    return 1


if __name__ == "__main__":
    sys.exit(main())
