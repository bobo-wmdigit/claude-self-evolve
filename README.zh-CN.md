# Claude Self-Evolve

Claude Code 的本地记忆管线。

English README: [README.md](README.md).

Claude Self-Evolve 会从 Claude Code 会话中捕获有价值的经验，把它们保存为结构化本地记录，并定期压缩成后续对话可自动回读的项目规则。

它不是“提醒模型记得总结”的提示词，而是一个由 Claude Code hooks 驱动的、基于文件的项目记忆层。

## 当前状态

本仓库优先支持 Claude Code。核心运行时保持本地化、脚本化，后续可以在不重写记忆模型的前提下适配其他 agentic coding 工具。

## 解决什么问题

项目中的高价值经验经常在一次会话后丢失，例如：

- 已有 hooks 不能被覆盖
- 某些命令在项目中安全或不安全
- 本地测试约定
- 反复出现的失败路径
- 用户偏好和验收标准

Claude Self-Evolve 会把这些经验变成结构化记录，并定期压缩为少量活跃规则。

## 工作机制

```text
用户输入
  -> UserPromptSubmit hook 注入当前活跃规则
  -> Claude 回复并在末尾输出 EVOLVE 块
  -> Stop hook 解析 EVOLVE 块
  -> spark.jsonl 保存原始记录
  -> compact 更新 genes.runtime.md 和 genes.archive.md
```

## 快速开始

依赖：

- Claude Code
- Bash
- Node.js

克隆仓库并安装到 Claude Code 项目：

```bash
git clone https://github.com/bobo-wmdigit/claude-self-evolve.git
cd claude-self-evolve
./install.sh /path/to/your-claude-code-project
```

## 在 Claude Code 中自动安装

发布到 GitHub 后，用户可以在目标项目中打开 Claude Code，然后复制这段提示：

```text
请把 Claude Self-Evolve 安装到当前项目。

仓库地址：https://github.com/bobo-wmdigit/claude-self-evolve

请执行：
1. 把仓库克隆到临时目录。
2. 先检查 install.sh 的内容，再运行它。
3. 对当前项目目录执行 ./install.sh。
4. 设置 CLAUDE_PROJECT_DIR 为当前项目，并运行 .claude/evolve-health.sh。
5. 告诉我安装了哪些文件，以及健康检查是否通过。

不要覆盖已有 Claude Code hooks。保留已有 .evolve 数据。
```

## 健康检查

```bash
CLAUDE_PROJECT_DIR=/path/to/your-claude-code-project \
  /path/to/your-claude-code-project/.claude/evolve-health.sh
```

## 手动 compact

```bash
CLAUDE_PROJECT_DIR=/path/to/your-claude-code-project \
  /path/to/your-claude-code-project/.claude/evolve-compact.sh
```

## EVOLVE 协议

Claude 每次回复末尾都应该输出一个独立的 EVOLVE 块。

有价值的经验：

```text
[EVOLVE]{"record":"yes","title":"安装器必须合并已有 hooks","type":"engineering-rule","scenario":"目标项目已有 .claude/settings.local.json","lesson":"覆盖 UserPromptSubmit 会破坏已有项目自动化","action":"安装时幂等合并 hook 命令，不替换 settings","confidence":"high"}[/EVOLVE]
```

普通轮次：

```text
[EVOLVE]{"record":"no","reason":"routine turn"}[/EVOLVE]
```

当 counter 达到阈值时，`record=no` 会被拒绝，Stop hook 会要求 Claude 输出一条有价值的记录。

## 安装后的文件

```text
target-project/
├── .claude/
│   ├── evolve.mjs
│   ├── evolve-hook.sh
│   ├── evolve-capture.sh
│   ├── evolve-compact.sh
│   ├── evolve-health.sh
│   └── settings.local.json
├── .evolve/
│   ├── state.json
│   ├── spark.jsonl
│   ├── audit.jsonl
│   ├── genes.runtime.md
│   ├── genes.archive.md
│   ├── GENES.md
│   └── SPARK.md
└── CLAUDE.md
```

## 安全模型

- 本地优先：运行时不发起网络请求。
- 文件透明：项目记忆保存在 `.evolve/`。
- 只合并不覆盖：安装时保留已有 Claude Code hooks。
- 保留数据：重复安装会更新脚本，但不会覆盖已有 `.evolve` 数据。
- 可审计：compact 事件写入 `.evolve/audit.jsonl`。

## 配置项

| 变量 | 默认值 | 说明 |
| --- | ---: | --- |
| `EVOLVE_THRESHOLD` | `5` | 连续多少轮后强制要求有价值记录 |
| `EVOLVE_COUNTER_WINDOW` | `1800` | 超过多少秒未继续对话则重置 counter |
| `EVOLVE_COMPACT_THRESHOLD` | `10` | spark 记录达到多少条后自动 compact |
| `EVOLVE_RUNTIME_LIMIT` | `12` | runtime 最多保留多少条活跃规则 |

## 仓库结构

```text
packages/claude-code/        Claude Code adapter 和模板
skills/claude-self-evolve/   操作本系统的 companion skill
docs/                        架构和使用文档
tests/                       工作流测试
examples/                    最小安装样例
```

## 开发

运行测试：

```bash
python3 -m unittest discover -s tests
```

安装后的运行时只使用 Node.js 标准库。Python 只用于本仓库的开发测试。

## 卸载

移除 hook 引用，但保留记忆数据：

```bash
./uninstall.sh /path/to/your-claude-code-project
```

卸载脚本会保留 `.evolve/` 和已复制的脚本，方便你检查、备份或手动删除。
