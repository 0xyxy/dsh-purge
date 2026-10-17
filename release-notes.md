# 1.3.1

> 1.3.1 = 1.3.0 + 破甲自检 + 备份保留策略。

**恢复原版全部能力，把宿主补丁扩到 83 条并逐条适配 DSH 0.2.1-rc.1。**

## 相对 1.2.0 的关键变化

### 1. 拆掉"一律禁写"的总开关

1.2.0 为了避开旧补丁风险，把 `patchWritesAllowed` 硬编码成 `false`，连带禁用了还原、卸载、Hooks、逐条状态区、自动应用/自动更新和重启入口。1.3.0 把这些入口按原版逐一恢复：

| 能力 | 1.2.0 | 1.3.0 |
| --- | --- | --- |
| 应用 / 重新应用宿主补丁（界面、`/purge apply`、`purge_apply` 工具、HTTP） | 全部阻止 | 全部恢复 |
| 还原 / 卸载（界面、命令、工具、HTTP） | 全部阻止 | 全部恢复，卸载与还原仍拆开处理 |
| 启动自愈、升级后恢复、`autoApplyOnStart` / `autoUpdateOnStart` | 强制关闭 | 跟随配置 |
| Hooks 开关、逐条补丁/shim/备份状态 | 隐藏或拒绝保存 | 恢复显示与保存 |
| 应用后自动重启（含密封 asar 重启） | 改为提示手动 | 恢复原调度，仍受用户手动重启规则约束 |
| 原始 CLI `dsh-purge --status/--apply/--revert/--uninstall/--edit` | 未打进包 | 重新导出；`purge-community apply|revert|uninstall|edit` 直接转发 |

兼容性不再当写入门禁：`compatibility()` 只产出报告（`qualified` / `unverified` / `mixed` / `no-host`），仍只有"完全定位不到宿主"和"组件版本不一致"会阻止写入。

### 2. 82 条补丁逐条适配 0.2.1-rc.1

在**未打补丁的 0.2.1 原始宿主副本**上整表应用的结果：63 条写入、6 条已是目标状态、0 条失败。重写锚点的 6 条：

| # | 补丁 | 0.2.1 的变化 | 处理 |
| --- | --- | --- | --- |
| 32 | `WEB_SURFACE_IDENTITY_NEUTRAL` | Web 面身份句从 `dsh-web-app` 搬到 `dsh-harness-dev-context` 的 `WEB_SURFACE_PROMPT` | 新增目标文件键与原句锚点，旧锚点保留 |
| 53 | `WEB_SURFACE_PROHIBITION` | 同上；同文件里还有一份参与的 LEGACY 文案 | 新句锚点 + 只删活跃模板里的"别另起服务器"，LEGACY 原文保留 |
| 40 | `COMPLETE_PROMPT_KEEP_INJECT` | assemble 后多出 `requiredContexts` 过滤 | 新增 0.2.1 专用正则与产物，complete 预设继续带上注入 |
| 77 | `REWIND_DROP_SENT_ON_APPEND` | `append()` 里 `revised` 改成按需清空 | 重新锚定，回退标记到达即替换窗口 |
| 80 | `MINIMAL_OFFICIAL_TOOLSET` | 撤销型补丁，原始宿主本来就没有插件加过的工具 | 标记 `settleWhenAbsent`，不再误报漂移 |
| 88 | `HUNG_PROMPT_STRICT_NEEDLE` | 锚点是 #87 的产物 | 标记 `chainedAfter: 87`，前置未落地时不报漂移 |

### 3. 新增：锚点诊断

- 面板「状态 → 兼容与诊断」，`GET /dsh-purge/diagnose`，`npm run diagnose` / `purge-community diagnose`。
- 输出分桶：`drifted`（必做补丁锚点全灭）、`optionalDrift`、`chained`、`missing`，每条带文件路径与期望原文片段。
- 用途：DSH 再升级时先看诊断，再决定应用；不再需要靠"禁写"来兜底。

### 4. 面板：原版界面全部接回

- 恢复原版状态区（应用/总数、待处理/没对上/跳过、shim、备份、逐条补丁组）与 Hooks 开关，社区维护区叠在它上面而不是替换它。
- 恢复会话输入区**回退按钮**与回退后草稿回填（`conversation.input.right`、`dsh-purge-rewind`、order 20），sessionStorage 键沿用旧前缀。
- 恢复**首次欢迎说明**与**演练模式发送前环境适配引导**。
- `__COMMUNITY__` 只剩品牌/文案/仓库地址差异。

### 5. 更新器：通道与来源都回来了

- 默认通道仍是本 fork 的正式发行包（下载 tgz + SHA256 + 包名/版本/仓库校验）。
- 恢复原版的正式/测试通道、GitHub 分支与历史 tag 选择、branch pin、版本历史、自动更新守卫、多安装位置更新规划。
- 选上游来源时默认不选中，并在结果里带 `warning`：上游已停维护，且与新版 DSH 不兼容。

### 6. 工程

- `engines.node` 回到 `>=18`；`files`/`bin` 重新包含原始 CLI 与脚本。
- 新增 `test/patch-anchors.test.mjs`：把 0.2.1 真实源码片段钉进用例，锚点漂移会直接测试失败。
- 兼容性断言改为"报告而非禁用"，并新增"找不到宿主才阻止写入"的用例。

## 1.3.1 新增

- **破甲强化段默认开启**：系统提示词尾部追加层级声明 / 拒绝即故障 / 抗谄媚 / 多轮重申；`purge-community boost off` 或面板一键关闭。
- **注入位置可切**：`head`（默认，省 token）/ `tail`（贴输出，多轮衰减最小）/ `both`，存 `$DSH_HOME/dsh-purge/tuning.json`。
- **#89 `ask_user_question` 不再卡回合**：等待上限压到 1 秒，超时直接继续（用户仍可在界面补答）。
- **漂移诊断给出可能的新落点**：`diagnose` 在锚点未命中时返回行号 + 片段，方便重锚。
- **破甲自检**：`purge-community selfcheck [--json]`、`GET /dsh-purge/selfcheck`、面板「状态 → 破甲自检」。21 层逐层给证据（宿主补丁 / 运行时注入 / profile 权限 / asar 是否密封），目标插件未安装的层标"不适用"而不是失败。
- **备份保留策略**：默认 keep_last=5、keep_daily=7、总量 200MB，`backup/install/rollback` 后自动淘汰；`purge-community usage` 看占用，`prune` 立即清理。此前一天可堆到 65MB 且无上限。

## 已知边界

- 本轮验证在**原始 0.2.1 宿主副本**上完成（整表应用 + 41 个被改文件逐个 `node --check` + 补丁后宿主 `--dump-config` 正常）。真实客户端里点「应用」后的运行期效果，需要重启后由使用者确认。
- Windows / Web profile 未做端到端验收。
- 上游 `YuJunZhiXue/dsh-purge` 已停止维护；本 fork 的问题请提交到本仓库。
