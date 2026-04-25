# 全局安装器 Skill

`skills/claude-self-evolve` 推荐安装到 agent 的全局 skill 库。

这个全局 skill 本质上是安装器和升级器。它教 agent 如何在当前项目里安装、检查、升级和诊断 Claude Self-Evolve。

项目记忆本身不是全局的。skill 安装进去的运行时仍然只作用于一个项目：

- 项目 hooks 在 `.claude/`
- 项目记忆在 `.evolve/`
- 安装元数据在 `.evolve/self-evolve.json`

从 v0.2.0 开始，项目运行时不再安装旧的 `GENES.md`、`SPARK.md` 或 `.counter` 兼容文件。

从 v0.2.1 开始，compact 会限制 active `spark.jsonl` 大小，并把已处理记录归档到 `.evolve/archive/`。

## 安装 Skill

把 skill 文件夹复制到 agent 的全局 skills 目录。对 Claude Code 来说，一个常见位置是 `~/.claude/skills`：

```bash
tmpdir="$(mktemp -d)"
git clone https://github.com/bobo-wmdigit/claude-self-evolve "$tmpdir/claude-self-evolve"
mkdir -p ~/.claude/skills
rm -rf ~/.claude/skills/claude-self-evolve
cp -R "$tmpdir/claude-self-evolve/skills/claude-self-evolve" ~/.claude/skills/
```

如果你的 agent 使用其他全局 skill 目录，把 `skills/claude-self-evolve` 复制到对应目录即可。

## 推荐唤醒方式

对 agent 说：

```text
请使用 claude-self-evolve skill 安装或升级当前项目中的 Claude Self-Evolve。
```

## 升级行为

skill 应该：

1. 如果存在 `.evolve/self-evolve.json`，读取当前安装版本。
2. 检查 GitHub 最新 release。
3. 对比当前安装版本和最新版本。
4. 把最新仓库克隆到临时目录。
5. 检查 `install.sh`。
6. 对当前项目重新运行 `install.sh`。
7. 运行 `.claude/evolve-health.sh`。

重新运行安装器就是受支持的升级路径。它会保留 `.evolve/` 记忆，并合并已有项目 hooks。
