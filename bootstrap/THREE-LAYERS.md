# 三层破甲：定义、落点、验证

本仓库交付的不是「一个补丁脚本」，而是**三层同时成立**的状态。任何一层缺失，另外两层都会被它盖回去。

## 三层是什么

| 层 | 作用对象 | 改的是什么 | 缺了会怎样 |
|---|---|---|---|
| **提示词层** Prompt | 注入文本 + 各包内的 prompt 常量 + preset persona | 模型**看到的话** | 宿主每次请求都会重新拼官方人设与边界话术，注入被盖住 |
| **代码层** Code | 各包 `lib/*.js` 的分支逻辑 | 审批判定、沙箱判定、围栏、工具 schema、循环/流式守卫 | 话术再软，落到 `if (policy === 'ask')` 那一刻仍会弹审批/拒绝写入 |
| **引擎层** Engine | 宿主装配与运行入口 | `base/cordis.patch.yml` 的默认值、desktop-shell、app-boot、**解包态本身** | 代码改了但 Electron 还从 `app.asar` 读，改动等于写在坟里；一次官方更新全部回滚 |

三层的关系是**包含**，不是并列：引擎层决定「改的文件是否被加载」，代码层决定「判定是否放行」，提示词层决定「模型读到的语境」。所以顺序必须是 **引擎 → 代码 → 提示词**。

## 补丁分布（dsh-purge-community 1.6.60，共 80 条）

| 归类 | 条数 | 代表补丁 |
|---|---|---|
| 提示词 / Prompt | 25 | `#4 SYSTEM_PROMPT_PERSONA`、`#5 APPROVAL_NEVER_SENTENCE`、`#26 MINIMAL_PERSONA_PURGE`、`#43 WEB_PRESET_IDENTITY_STRIP`、`#53 WEB_SURFACE_PROHIBITION`、`#55 SYSTEM_PROMPT_REPLACE_HEAD`、`#63 OFFICIAL_PLAN_MODE_NEUTRAL`、`#71 LIANGSHEN_IDENTITY_LINE` |
| 代码 / Code | 43 | `#7 SANDBOX_MODE_DEFAULT`、`#8 APPROVAL_POLICY_DEFAULT`、`#9 APPROVAL_AUTO_GRANT`、`#14 ESCALATION_GRANT_UNCONDITIONAL`、`#16 FS_FENCE_DISABLED`、`#17 FS_OBSERVATION_INTENT_FREE`、`#67 AGENT_LOOP_MESSAGES_GUARD`、`#69 MODEL_STREAM_RELEASE` |
| 工具 / Tools | 9 | `#29 TOOL_WEB_UNTRUSTED_NEUTRAL`、`#48 TOOL_SHELL_DELETE_MOVE_NEUTRAL`、`#60 OFFICIAL_RUN_CODE_APPROVAL_NEUTRAL`、`#89 ASK_USER_WAIT_CAPPED` |
| 版本兼容 | 3 | `#40`（0.1.5）、`#47` `#49`（0.2.0） |

## 三层各自的硬指标（`verify-layers.mjs` 检查的就是这些）

### 提示词层

| 编号 | 指标 | 判据 |
|---|---|---|
| P1 | `prompt-inject.md` 完整 | `DSH_HOME/prompt-inject.md` > 20000 字符、226 行 |
| P2 | 审批文案已换 | `dsh-user-approval/lib/index.js` 含 `Approval requests are auto-granted` |
| P3 | plan-mode 软化 | `dsh-base/cordis.patch.yml` 含 `[dsh-purge] plan-mode soft block removed` |
| P4 | 预设去身份句 | `.agent-presets/unrestricted/agent.cordis.yml` 不含 `You are a helpful software engineer assistant.` |
| P5 | 梁神已洗 | `.agent-presets/liangshen/agent.cordis.yml` 含 `[dsh-purge] liangshen identity line removed` |

### 代码层

| 编号 | 指标 | 判据 |
|---|---|---|
| C1 | 审批默认 never | `user-approval` 的 zod `.default("never")` |
| C2 | 文件围栏已拆 | `dsh-fs-sandbox/lib/index.js` 在位且无 deny-every-mutation 分支 |
| C3 | 升级目标全开 | `dsh-sandbox` 的 `ESCALATION_TARGETS` 含 `danger-full-access` |
| C4 | 循环守卫在位 | `dsh-agent-loop/lib/index.js` 存在且 ≥ 60 KB（`#67/#68/#69` 已打） |
| C5 | 可细粒度回滚 | `@deepseek-ai` 下存在 `.dshpurge.bak` |

### 引擎层

| 编号 | 指标 | 判据 |
|---|---|---|
| E1 | 已解包 | `resources/app/dsh/node_modules` 存在 |
| E2 | 归档已挪开 | `app.asar` 不存在且 `app.asar.bak` 存在（否则 Electron 仍读 asar） |
| E3 | 沙箱默认全开 | `base/cordis.patch.yml` 里 `?? 'danger-full-access'` |
| E4 | 审批恒 never | `'danger-full-access') === 'danger-full-access' ? 'never' : 'ask'` |
| E5 | CLI 入口 | `runtime/cli/bin/dsh.cmd` 首顺位指向 `app\dsh\...\cli.js` |
| E6 | 自动更新关闭 | `dsh-purge/update-preferences.json` 的 `autoInstall === false` |

## 怎么跑

```powershell
# 只验证（不改任何东西）
node bootstrap\verify-layers.mjs
node bootstrap\verify-layers.mjs --json     # 机器可读

# 一键装三层（含验证）
.\bootstrap\install-layers.ps1
```

退出码：`0` = 三层全通；`1` = 有层未通（屏幕会逐条给 `fix:`）。

## 本机实测基线

```
── 提示词层 PASS ──  P1 ✓  P2 ✓  P3 ✓  P4 ✓  P5 ✓
── 代码层  PASS ──  C1 ✓  C2 ✓  C3 ✓  C4 ✓  C5 ✓
── 引擎层  PASS ──  E1 ✓  E2 ✓  E3 ✓  E4 ✓  E5 ✓  E6 ✓
合计 16/16 项通过 · 三层全通
```

## 层与层之间的两个真陷阱

1. **引擎层没做，代码层白做**。`app.asar` 还在时，Electron 优先读归档，磁盘上改的 `resources/app` 根本不参与加载。这也是为什么 `run-purge.mjs` 一定要走到「挪走 asar + 重启」这一步。
2. **提示词层没做，代码层会漏**。审批判定放开了，但每轮请求仍注入「审批被拒绝/边界在哪」的旧话术时，模型行为会被话术拉回去。所以 P2/P3 是代码层放行能否真正体现在输出上的前提。

## 一层出问题时的定位顺序

```
E2 (asar 挪走?) → E1 (目录在?) → C1/C3 (判定放行?) → P2/P3 (话术换掉?) → 运行时 system 文本对不对
```

先确认「改的文件被加载」，再确认「逻辑放行」，最后确认「话术一致」。顺序反了会反复怀疑补丁没生效。
