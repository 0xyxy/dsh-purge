# 三层破甲：定义、落点、验证

本仓库交付的不是「一个补丁脚本」，而是**三层同时成立**的状态。任何一层缺失，另外两层都会被它盖回去。

## 三层是什么

| 层 | 作用对象 | 改的是什么 | 缺了会怎样 |
|---|---|---|---|
| **提示词层** Prompt | 注入文本 + 各包内的 prompt 常量 + preset persona | 模型**看到的话** | 宿主每次请求都会重新拼官方人设与边界话术，注入被盖住 |
| **代码层** Code | 各包 `lib/*.js` 的分支逻辑 | 审批判定、沙箱判定、围栏、工具 schema、循环/流式守卫 | 话术再软，落到 `if (policy === 'ask')` 那一刻仍会弹审批/拒绝写入 |
| **引擎层** Engine | 宿主装配与运行入口 | `base/cordis.patch.yml` 的默认值、desktop-shell、app-boot、**解包态本身** | 代码改了但 Electron 还从 `app.asar` 读，改动等于写在坟里；一次官方更新全部回滚 |

三层的关系是**包含**，不是并列：引擎层决定「改的文件是否被加载」，代码层决定「判定是否放行」，提示词层决定「模型读到的语境」。所以顺序必须是 **引擎 → 代码 → 提示词**。

## 状态与退出码（不要再用"绿/红"两种颜色）

一次安装里有四种事实，混在一起就只能靠人猜：

| 状态 | 含义 | 该做什么 | 退出码 |
|---|---|---|---|
| `PASS` | 证据齐全，这条真的成立 | 无事 | 0 |
| `N_A` | 明确不适用（可选补丁关闭、第三方目标不在场） | 无事，但它**不等于**通过 | 0 |
| `WAITING` | 换包/重启还没落地 | 等一会儿再验 | 2 |
| `ACTION_REQUIRED` | 补丁还没写进宿主（`pending`） | 点一次「应用」→ 完整退出 → 重开 | 2 |
| `BROKEN` | 漂移 / 部分命中 / 命中数不符 / 不可读 / 证据自相矛盾 | 停下排查，别继续换包 | 1 |

`install-layers.ps1` 据此决策：`2` 继续轮询，`1` 立即停止，**连续两次 `0` 才算验收完成**（防止换包助手稍后回滚，安装器却已经对外报成功）。

## 补丁分布（随插件版本变，**不手抄**）

条数与分布由 C6 现场 import 插件自己的 `ALL_PATCHES` 统计。1.6.67 实测：84 条（提示词 25 / 代码 47 / 工具 9 / 兼容 3），其中 `#18`、`#19` 是 `disabledByDefault`。

### 可选关闭 ≠ 破甲（#18 / #19）

上游 1.6.65 起，`#18`（关闭重复调用提醒）与 `#19`（关闭工具结果修剪）默认不打：它们**不是闸门**，关掉的是**上下文保护**。

```sh
purge-community patches enable 18,19   # 写 tuning.extraPatches，再点一次「应用」
purge-community patches disable 19
```

代价写清楚：工具输出不再修剪后会长住上下文，长会话更快触顶、更贵、更容易答非所问。C6 把它们记成 `N_A`（明确不适用），不算失败；反过来，别把「开了 #18/#19」当成破甲成功的证据。

## 20 项硬指标（`verify-layers.mjs`）

判据本体在 `bootstrap/lib/layers.mjs`（纯函数），正反样本在 `bootstrap/test/layers.test.mjs`（27 条），
**判据是否真有判别力**由 `bootstrap/test/mutation-check.mjs` 验证（对源码做定点突变，9/9 必须被抓到）。

### 提示词层（P1–P7）

| 编号 | 指标 | 判据 |
|---|---|---|
| P1 | 注入完整 | `prompt-inject.md` > 20000 字符 |
| P2 | 审批文案已换 | `dsh-user-approval/lib/index.js` 含 `Approval requests are auto-granted` |
| P3 | plan-mode 软化 | `dsh-base/cordis.patch.yml` 含 `[dsh-purge] plan-mode soft block removed` |
| P4 | 预设去身份句 | `unrestricted/agent.cordis.yml` 不含官方身份句 |
| P5 | 梁神已洗 | `liangshen/agent.cordis.yml` 含 `[dsh-purge] liangshen identity line removed` |
| **P6** | **信封成对** | `<\|im_start\|>`/`<\|im_end\|>` 与 `<project_instructions>`/`</project_instructions>` 要么都不出现，要么**恰好 1 对且开在闭前**；单边即 `BROKEN`（上游 #107） |
| **P7** | **预设副本未漂移** | 仓库 `presets/` 与 `payload/presets/` 的**路径集合 + sha256** 完全一致（`liangshen/` 白名单例外） |

> P6 为什么这么严：宿主 `@deepseek-ai` 树里本来 0 处 ChatML。注入自带一个开标签时，模型会把它读成「上一条 system 消息已结束、新开一条永不结束的 system 消息」，**后面所有官方段被吞进去**。以前指望运行时 normalizer 补闭合，现在要求磁盘上的原文就成对——运行时是最后一道保险，不是唯一一道。

### 代码层（C1–C7）

| 编号 | 指标 | 判据 |
|---|---|---|
| C1 | 审批默认 never | zod `.default("never")` |
| C2 | 文件围栏已拆 | `dsh-fs-sandbox/lib/index.js` 在位且无 deny-every-mutation 分支 |
| C3 | 升级目标全开 | `ESCALATION_TARGETS` 含 `danger-full-access` |
| C4 | 循环守卫在位 | `dsh-agent-loop` 含 **#67 与 #68 的具体 marker**（不再数通用 `[dsh-purge]`，也不再靠 60KB 体量阈值——那是版本耦合噪声） |
| C5 | 可细粒度回滚 | `@deepseek-ai` 下存在 `.dshpurge.bak` |
| **C6** | **补丁表全量核对** | `patchStatus` + `patchDrift`：`applied/already` 通过；`pending` → `ACTION_REQUIRED`；`drifted/partial/unmatched/hit_mismatch/unreadable` → `BROKEN`；`disabled/na` → `N_A`；`skipped` 只有补丁自带 `silentWhenMissing` 或该补丁是 `optional`（插件判定"无需处理"，会在 detail 里点名"未独立验证"）才算 `N_A`；非 optional 的 `skipped` = 该打没打上 → `BROKEN` |
| **C7** | **锚点唯一** | 待打补丁（`pending`）的字面锚点必须在宿主里找得到；0 次 = 写法变了要 `reanchor`，>1 次 = replace-all 会顺手改错（点名但不判红） |

> C6 不接受 `patchStatusReady()` 当裁决（状态页"软就绪"对 `skipped`/`missing_file` 都返回 true），一律按"状态 + 逐文件明细"的硬规则判；`fileAllRequired` 缺目标或现存文件飘移直接 `BROKEN`。
>
> C6 的豁免机制曾经是个假绿入口：原来写 `exempt: [71]`，任意 `unknown` 只要 id 在白名单里就放行。现在豁免必须是 `{ reason, proof: true }`，**proof 由调用方现场算**（#71 的 proof = liangshen 预设文件存在 + 官方身份句已消失 + #71 marker 在位），三缺一就不放行。

### 引擎层（E1–E6）

| 编号 | 指标 | 判据 |
|---|---|---|
| E1 | 已解包 | `resources/app/dsh/node_modules` 存在 |
| E2 | 归档已挪开 | `app.asar` 不存在且 `app.asar.bak` 存在 |
| E3 | 沙箱默认全开 | `base/cordis.patch.yml` 里 `?? 'danger-full-access'` |
| E4 | 审批恒 never | `'danger-full-access') === 'danger-full-access' ? 'never' : 'ask'` |
| E5 | CLI 入口 | `dsh.cmd` 首顺位指向 `app\dsh\...\cli.js` |
| E6 | 自动更新关闭 | `update-preferences.json` 的 `autoInstall === false` |

## 怎么跑

```powershell
node bootstrap\verify-layers.mjs            # 只验证（0 通过 / 2 待动作 / 1 坏了）
node bootstrap\verify-layers.mjs --json     # 机器可读（含 patch_accounting 明细）

.\bootstrap\install-layers.ps1              # 全流程
.\bootstrap\install-layers.ps1 -Tag v1.6.67 # 锁版本（会真的升级已装的旧版本）
.\bootstrap\install-layers.ps1 -VerifyOnly  # 只验

node --test bootstrap\test\layers.test.mjs      # 判据单测（27 条）
node bootstrap\test\mutation-check.mjs          # 判据变异测试（9 条突变必须全被抓到）
node bootstrap\sync-presets.mjs --check         # 预设副本一致性
node bootstrap\pack-custom.mjs                  # 打 release 用的 dsh-unleashed-custom.zip
```

## 本机实测基线（2026-11-01，DSH 0.2.1-rc.5 / Windows 11）

```
── 提示词层 PASS ──  P1 ✓  P2 ✓  P3 ✓  P4 ✓  P5 ✓  P6 ✓  P7 ✓
── 代码层  PASS ──  C1 ✓  C2 ✓  C3 ✓  C4 ✓  C5 ✓  C6 ✓  C7 ·
── 引擎层  PASS ──  E1 ✓  E2 ✓  E3 ✓  E4 ✓  E5 ✓  E6 ✓
已验证 19 · 不适用 1 · 待处理/坏 0 · 共 20 项 · 整体 PASS · 退出码 0
（C7 为 N_A：当时没有 pending 补丁可查）
```

装 1.6.60 那套旧基线时 P6 是红的：`prompt-inject.md` 首行是 `<|im_start|>system:<project_instructions>`、全文没有 `<|im_end|>`，且 `<project_instructions>` 也没有闭合——两处都会被吞段。

## 与上游同步（1.6.61 → 1.6.67 吸收了什么）

| 上游 | 我们吸收到哪里 |
|---|---|
| 1.6.62 #107 ChatML 单边标签 | `payload/prompt-inject.md` 去掉开标签并补 `</project_instructions>`；判定落成 **P6**（成对 + 顺序） |
| 1.6.62 rc.5 进已验证清单 | 文档基线改为 rc.5（本机实测） |
| 1.6.62 #91/#92 cookie 与请求头上限 | 升级插件即得；C6 会核对 #91 是否 `applied` |
| 1.6.63 `drifted` 判定 | **C6** 把 `drifted/partial` 判 `BROKEN` |
| 1.6.64 `expect` 命中数契约 | **C7** 前置化为"锚点必须找得到、多点名"；少打补丁会以 `unmatched` 在 C6 现形 |
| 1.6.64 complete 模式 purge-first | 升级插件即得（注入段排在官方段之前） |
| 1.6.65 #18/#19 默认关闭 | 「可选关闭 ≠ 破甲」；C6 记 `N_A` |
| 1.6.61 恢复原生技能目录发现 | 仓库 `presets/unrestricted` 改回 `includeDefaultRoots: true`，`sync-presets.mjs` 保证装出来的就是这份 |
| 1.6.66/67 宿主诊断与更新凭据 ACL | 升级插件即得，不影响三层判定 |

我们特有的增量（上游没有）：`bootstrap/` 三层安装器与验证器、`liangshen` 预设、`unrestricted` 的多段执行纪律、仓库与 payload 的同步/打包脚本。**这些都不碰宿主补丁逻辑**，所以每次跟上游合并只需处理 `package.json` 一处冲突。

## 已知偏差（写明，不假装没有）

1. **自动换包 vs 上游的手动交接契约**。上游 1.6.13 起 Windows 密封宿主的「应用」只写磁盘并启动等待助手，要求**用户自己完整退出再打开**。本仓库的 `run-purge.mjs` + `swap-restart.ps1` 直接关宿主、挪归档、重启——这是 fork 的自选用法（换机自装时没人守着屏幕）。想守上游契约就别用 `run-purge.mjs` 的换包段，改用面板「应用」+ 手动退出。
2. **换包助手没有 phase 文件可读**。上游有 `asar_handoff.phase`，我们的独立脚本没有；因此"是否已换包完成"只能靠静态判据 + 连续两次复验来收敛，而不是读 `complete`。
3. **用户文件没有事务级快照**。`install-layers.ps1` 只对 prompt-inject 与三个预设做时间戳备份，并在失败时**列出备份路径而不自动回退**——单边回退会造出"用户文件回到旧版、宿主却是新版"的混合状态，比不回退更难判断。真要回到安装前，请用 `app.asar.bak` + 备份副本一起回。

## 层与层之间的两个真陷阱

1. **引擎层没做，代码层白做**。`app.asar` 还在时，Electron 优先读归档，磁盘上改的 `resources/app` 根本不参与加载。
2. **提示词层没做，代码层会漏**。审批判定放开了，但每轮请求仍注入旧话术时，模型行为会被话术拉回去。

## 一层出问题时的定位顺序

```
E2 (asar 挪走?) → E1 (目录在?) → C6 (补丁真的打上了?) → C1/C3 (判定放行?) → P2/P3 (话术换掉?) → P6 (信封没吞段?) → 运行时 system 文本对不对
```

先确认「改的文件被加载」，再确认「逻辑放行」，最后确认「话术一致」。顺序反了会反复怀疑补丁没生效。
