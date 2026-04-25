import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / "install.sh"


class SelfEvolveWorkflowTest(unittest.TestCase):
    def run_cmd(self, cmd, *, cwd=None, env=None, stdin=None, check=True):
        merged_env = os.environ.copy()
        if env:
            merged_env.update(env)
        result = subprocess.run(
            cmd,
            cwd=cwd,
            env=merged_env,
            input=stdin,
            text=True,
            capture_output=True,
            check=False,
        )
        if check and result.returncode != 0:
            raise AssertionError(
                f"command failed: {' '.join(cmd)}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
            )
        return result

    def create_project(self, tmpdir: str) -> Path:
        project = Path(tmpdir) / "project"
        (project / ".claude").mkdir(parents=True)
        (project / "CLAUDE.md").write_text("# Existing CLAUDE\n", encoding="utf-8")
        settings = {
            "hooks": {
                "UserPromptSubmit": [
                    {
                        "matcher": "",
                        "hooks": [
                            {
                                "type": "command",
                                "command": "$CLAUDE_PROJECT_DIR/.claude/existing-hook.sh",
                            }
                        ],
                    }
                ]
            }
        }
        (project / ".claude" / "settings.local.json").write_text(
            json.dumps(settings, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return project

    def install_project(self, project: Path) -> None:
        self.run_cmd(["bash", str(INSTALL), str(project)])

    def test_install_merges_hooks_and_health_passes(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            project = self.create_project(tmpdir)
            self.install_project(project)
            self.install_project(project)

            settings = json.loads((project / ".claude" / "settings.local.json").read_text(encoding="utf-8"))
            prompt_commands = [
                hook["command"]
                for matcher in settings["hooks"]["UserPromptSubmit"]
                for hook in matcher["hooks"]
            ]
            stop_commands = [
                hook["command"]
                for matcher in settings["hooks"]["Stop"]
                for hook in matcher["hooks"]
            ]

            self.assertIn("$CLAUDE_PROJECT_DIR/.claude/existing-hook.sh", prompt_commands)
            self.assertEqual(prompt_commands.count("$CLAUDE_PROJECT_DIR/.claude/evolve-hook.sh"), 1)
            self.assertEqual(stop_commands.count("$CLAUDE_PROJECT_DIR/.claude/evolve-capture.sh"), 1)

            health = self.run_cmd(
                [str(project / ".claude" / "evolve-health.sh")],
                env={"CLAUDE_PROJECT_DIR": str(project)},
            )
            summary = json.loads(health.stdout)
            self.assertEqual(summary["issues"], [])
            self.assertIn("audit_event_count", summary)

    def test_hook_output_is_valid_json_with_special_runtime_content(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            project = self.create_project(tmpdir)
            self.install_project(project)

            runtime = project / ".evolve" / "genes.runtime.md"
            runtime.write_text(
                '# Runtime\n\n## 特殊字符\n\n- 引号："merge"\n- emoji：🧠\n- 多行内容\n',
                encoding="utf-8",
            )

            result = self.run_cmd(
                [str(project / ".claude" / "evolve-hook.sh")],
                env={"CLAUDE_PROJECT_DIR": str(project)},
            )
            payload = json.loads(result.stdout)
            context = payload["hookSpecificOutput"]["additionalContext"]
            self.assertIn("特殊字符", context)
            self.assertIn("emoji：🧠", context)

    def test_capture_writes_spark_and_resets_counter(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            project = self.create_project(tmpdir)
            self.install_project(project)

            self.run_cmd(
                [str(project / ".claude" / "evolve-hook.sh")],
                env={"CLAUDE_PROJECT_DIR": str(project), "EVOLVE_THRESHOLD": "2"},
            )
            self.run_cmd(
                [str(project / ".claude" / "evolve-hook.sh")],
                env={"CLAUDE_PROJECT_DIR": str(project), "EVOLVE_THRESHOLD": "2"},
            )

            stop_input = {
                "session_id": "session-1",
                "stop_hook_active": False,
                "last_assistant_message": (
                    '分析完成。\n'
                    '[EVOLVE]{"record":"yes","title":"安装逻辑要保留原 hooks","type":"engineering-rule",'
                    '"scenario":"目标项目已有 settings.local.json","lesson":"直接覆盖会破坏现有流程",'
                    '"action":"安装脚本必须 merge hooks","confidence":"high"}[/EVOLVE]'
                ),
            }
            self.run_cmd(
                [str(project / ".claude" / "evolve-capture.sh")],
                env={"CLAUDE_PROJECT_DIR": str(project), "EVOLVE_THRESHOLD": "2"},
                stdin=json.dumps(stop_input),
            )

            state = json.loads((project / ".evolve" / "state.json").read_text(encoding="utf-8"))
            spark_lines = [line for line in (project / ".evolve" / "spark.jsonl").read_text(encoding="utf-8").splitlines() if line]
            self.assertEqual(state["counter"], 0)
            self.assertEqual(len(spark_lines), 1)
            record = json.loads(spark_lines[0])
            self.assertEqual(record["title"], "安装逻辑要保留原 hooks")

    def test_threshold_block_then_fallback_and_compact_writes_audit(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            project = self.create_project(tmpdir)
            self.install_project(project)

            self.run_cmd(
                [str(project / ".claude" / "evolve-hook.sh")],
                env={"CLAUDE_PROJECT_DIR": str(project), "EVOLVE_THRESHOLD": "1"},
            )

            block_input = {
                "session_id": "session-2",
                "stop_hook_active": False,
                "last_assistant_message": "这里只是普通回复，没有结构化块。",
            }
            blocked = self.run_cmd(
                [str(project / ".claude" / "evolve-capture.sh")],
                env={"CLAUDE_PROJECT_DIR": str(project), "EVOLVE_THRESHOLD": "1"},
                stdin=json.dumps(block_input),
                check=False,
            )
            self.assertEqual(blocked.returncode, 2)

            fallback_input = {
                "session_id": "session-2",
                "stop_hook_active": True,
                "last_assistant_message": "这里只是普通回复，没有结构化块。",
            }
            self.run_cmd(
                [str(project / ".claude" / "evolve-capture.sh")],
                env={
                    "CLAUDE_PROJECT_DIR": str(project),
                    "EVOLVE_THRESHOLD": "1",
                    "EVOLVE_COMPACT_THRESHOLD": "1",
                },
                stdin=json.dumps(fallback_input),
            )

            runtime = (project / ".evolve" / "genes.runtime.md").read_text(encoding="utf-8")
            audit_lines = [
                json.loads(line)
                for line in (project / ".evolve" / "audit.jsonl").read_text(encoding="utf-8").splitlines()
                if line
            ]
            self.assertIn("Forced checkpoint", runtime)
            self.assertTrue(any(event["event"] == "compact_run" for event in audit_lines))
            self.assertTrue(any(event["event"] == "promote_to_runtime" for event in audit_lines))


if __name__ == "__main__":
    unittest.main()
