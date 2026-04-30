## 自进化机制（/.evolve/）

本项目接入了 `claude-self-evolve v2`。每次回复末尾必须输出 `EVOLVE` 结构化块，evolve 时经验会自动同步到本文件，后续轮次可直接参考。

### 运行机制

1. **Stop hook** 自动解析你输出的 EVOLVE 结构化块，写入 `.evolve/spark.jsonl`。
2. **Evolve** 达到阈值后自动执行，提炼经验并同步到本文件下方 `<!-- EVOLVE-RUNTIME-BEGIN -->` 标记区内。

### 你需要做的动作

每次回复末尾输出一个单独的 EVOLVE 结构化块。

#### 有价值的经验

```text
[EVOLVE]{"record":"yes","title":"Short title","type":"engineering-rule","scenario":"When it applies","lesson":"What was learned","action":"What to do next time","confidence":"high"}[/EVOLVE]
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
6. 输出 EVOLVE 前，先回顾 Active GENES —— 如果本轮经验与已有规则矛盾或需要修正，在 EVOLVE 块中注明对应规则标题，系统会在 evolve 时合并/替换。

<!-- EVOLVE-RUNTIME-BEGIN -->
# GENES Runtime

_（当前活跃基因。evolve 时自动同步，保持少而硬。）_
<!-- EVOLVE-RUNTIME-END -->
