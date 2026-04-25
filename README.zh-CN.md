# Claude Self-Evolve

Claude Code 的项目级本地记忆管线。

English README: [README.md](README.md).

Claude Self-Evolve 会从单个项目内的 Claude Code 会话中捕获有价值的经验，把它们保存为项目级本地记录，并定期压缩成这个项目后续对话可自动回读的项目规则。

它不是“提醒模型记得总结”的提示词，不是全局 Claude Code 配置，也不是跨项目记忆系统。它是一个安装到每个项目里的、由 Claude Code hooks 驱动的、基于文件的项目记忆层。

## 当前状态

本仓库优先支持 Claude Code，并且明确按项目级使用设计。它不会安装全局 Claude Code hooks，也不会在多个项目之间共享记忆。

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

推荐用法：

1. 把 companion skill 安装到 agent 的全局 skill 库。
2. 用这个 skill 给每个目标项目安装或升级 Claude Self-Evolve。

skill 是全局的，因为它本质上是安装和升级能力；它安装进去的记忆运行时仍然是项目级的。
详见 [docs/global-skill.zh-CN.md](docs/global-skill.zh-CN.md)。

安装或更新全局 skill：

```bash
tmpdir="$(mktemp -d)"
git clone https://github.com/bobo-wmdigit/claude-self-evolve "$tmpdir/claude-self-evolve"
mkdir -p ~/.claude/skills
rm -rf ~/.claude/skills/claude-self-evolve
cp -R "$tmpdir/claude-self-evolve/skills/claude-self-evolve" ~/.claude/skills/
```

如果你的 agent 使用其他全局 skill 目录，把 `skills/claude-self-evolve` 复制到对应目录即可。

手动安装到项目：

```bash
git clone https://github.com/bobo-wmdigit/claude-self-evolve.git
cd claude-self-evolve
./install.sh /path/to/your-claude-code-project
```

每个需要独立记忆的项目都单独安装一次。不要把它安装到全局 Claude Code 配置目录。

## 全局安装器 Skill

`skills/claude-self-evolve` 设计上推荐安装到 agent 的全局 skill 库。它负责：

- 把 Claude Self-Evolve 安装到当前项目
- 检查 GitHub 上的最新 release
- 对比最新版本和 `.evolve/self-evolve.json`
- 通过重新运行最新 `install.sh` 升级当前项目
- 升级时保留项目 hooks 和 `.evolve` 数据

全局 skill 不会让记忆变成全局。它只是给 agent 一个可复用的安装和升级流程。

把 skill 复制到全局 skill 目录后，可以这样要求 agent：

```text
请使用 claude-self-evolve skill 安装或升级当前项目中的 Claude Self-Evolve。
```

## 通过全局 Skill 安装或升级

安装全局 skill 后，用户可以在目标项目中打开 Claude Code，然后复制这段提示：

```text
请使用 claude-self-evolve skill 安装或升级当前项目中的 Claude Self-Evolve。

请检查 GitHub 最新 release；如果当前项目已经安装，请对比当前安装版本；只对当前项目运行安装器；然后运行健康检查。
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
│   ├── self-evolve.json
│   ├── state.json
│   ├── spark.jsonl
│   ├── archive/
│   ├── audit.jsonl
│   ├── genes.runtime.md
│   └── genes.archive.md
└── CLAUDE.md
```

## 安全模型

- 本地优先：运行时不发起网络请求。
- 项目级作用域：记忆保存在目标项目的 `.evolve/`。
- 不写全局 hooks：安装只修改目标项目内的 `.claude/` 文件。
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
| `EVOLVE_SPARK_RETAIN` | `100` | compact 后 active `spark.jsonl` 保留的最近原始记录数 |
| `EVOLVE_AUDIT_RETAIN` | `500` | active `audit.jsonl` 保留的最近审计事件数 |

## 仓库结构

```text
packages/claude-code/        Claude Code adapter 和模板
skills/claude-self-evolve/   全局安装/升级 skill
docs/                        架构和使用文档
examples/                    最小安装样例
```

## 开发

安装后的运行时只使用 Node.js 标准库，不需要 npm packages。

仓库变更请使用 [CONTRIBUTING.md](CONTRIBUTING.md) 中的分支和 PR 流程。

## 卸载

移除 hook 引用，但保留记忆数据：

```bash
./uninstall.sh /path/to/your-claude-code-project
```

卸载脚本会保留 `.evolve/` 和已复制的脚本，方便你检查、备份或手动删除。
