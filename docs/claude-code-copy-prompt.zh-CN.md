# Claude Code 复制安装提示

这是给 GitHub 用户复制到 Claude Code 的安装提示。

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

## 简短版

```text
请把 https://github.com/bobo-wmdigit/claude-self-evolve 安装到当前 Claude Code 项目。先检查 install.sh，再对当前项目运行安装脚本，然后执行健康检查。保留已有 hooks 和 .evolve 数据。
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
