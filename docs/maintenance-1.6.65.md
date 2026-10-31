# 1.6.65 维护记录：#18/#19 开关

## 为什么不默认开

两条补丁都取消上下文保护而非门禁：

| 补丁 | 作用 | 收益 | 代价 |
|---|---|---|---|
| #18 REPEAT_TOOL_REMINDER_DISABLED | 关掉重复调用提醒 | 工具循环提示词更干净 | 模型可能在同处反复试错 |
| #19 TOOL_RESULT_PRUNER_DISABLED | 关掉 8192 字符工具结果修剪 | 模型能看到完整输出 | 工具输出长期占上下文，更快触顶/更贵 |

## 状态语义

- `disabled`：未在 `tuning.extraPatches` 中列出；`patchStatusReady("disabled") === true`（这是选择，不是故障）。
- 自检 `tallyPatchStatus.disabled` 计入 `not_applicable`，不进入必需分母。
- `patchDrift` 跳过 disabled，不报漂移。

## 验收

- `test/opt-in-patches.test.mjs`：默认拒绝写入、显式开启后写入并翻转状态、tuning 去重过滤。
- 真机流程：`patches enable 19` → 对隔离 rc.5 树应用 → 状态 applied；`patches disable 19` → 状态 disabled。
