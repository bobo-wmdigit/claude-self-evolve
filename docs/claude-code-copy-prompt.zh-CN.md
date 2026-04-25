# Claude Code 复制安装提示

这是给 GitHub 用户复制到 Claude Code 的安装或升级提示。

推荐流程：先把 `skills/claude-self-evolve` 安装到全局 skill 库，然后在每个目标项目里唤醒它。

```text
请使用 claude-self-evolve skill 安装或升级当前项目中的 Claude Self-Evolve。

请检查 GitHub 最新 release；如果当前项目已经安装，请对比当前安装版本；只对当前项目运行安装器；然后运行健康检查。
```

## 简短版

```text
请使用 claude-self-evolve skill 安装或升级当前项目。保留已有 hooks 和 .evolve 数据。除了已经安装好的全局 skill，不要修改全局 Claude Code 设置。
```

## Claude Code 预期动作

Claude Code 应该执行类似命令：

```bash
tmpdir="$(mktemp -d)"
git clone https://github.com/bobo-wmdigit/claude-self-evolve "$tmpdir/claude-self-evolve"
cd "$tmpdir/claude-self-evolve"
./install.sh /path/to/current/project
CLAUDE_PROJECT_DIR=/path/to/current/project /path/to/current/project/.claude/evolve-health.sh
```

不建议把 `curl | bash` 作为主要安装方式。复制提示能让 Claude Code 先检查安装脚本，再报告实际修改了什么。
