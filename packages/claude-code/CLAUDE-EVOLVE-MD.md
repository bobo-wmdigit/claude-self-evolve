## 自进化机制（/.evolve/）

本项目接入了 `claude-self-evolve v2`。你不需要手工修改经验文件，只需要在回复末尾输出 `EVOLVE` 结构化块，由系统负责落盘、压缩和回读。

### 运行机制

1. `UserPromptSubmit` hook 会自动注入当前状态、`genes.runtime.md` 和 EVOLVE 协议。
2. `Stop` hook 会自动解析你输出的 EVOLVE 结构化块，并写入 `.evolve/spark.jsonl`。
3. 达到阈值后，系统会自动 compact，更新 `genes.runtime.md` 和 `genes.archive.md`。

### 你需要做的动作

每次回复末尾输出一个单独的 EVOLVE 结构化块。

#### 有价值的经验

```text
[EVOLVE]{"record":"yes","title":"安装脚本不能覆盖现有 hooks","type":"engineering-rule","scenario":"目标项目已有 settings.local.json","lesson":"覆盖 UserPromptSubmit 会破坏原项目配置","action":"安装逻辑必须默认 merge 而不是 overwrite","confidence":"high"}[/EVOLVE]
```

#### 无价值的普通轮次

```text
[EVOLVE]{"record":"no","reason":"routine turn"}[/EVOLVE]
```

### 规则

1. EVOLVE 块必须单独放在回复末尾。
2. EVOLVE 块中的 JSON 必须是单行合法 JSON。
3. `record=yes` 时必须包含 `title/type/scenario/lesson/action/confidence`。
4. `confidence` 只能是 `low`、`medium`、`high`。
5. 当 counter 达到阈值时，不允许输出 `record=no`。

详细初始化和使用说明见当前工具目录下的 `README.md`。
