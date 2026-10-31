# bootstrap — 三层破甲安装器

本目录是**自包含**的：不联网也能装（除了首次拉插件 tgz）。

| 文件 | 作用 |
|---|---|
| `install-layers.ps1` | 主入口：同步预设 → 装/升级插件到期望版本 → 铺提示词与预设 → 解包打补丁 → shim → 关自动更新 → 重启 → 轮询复验 |
| `verify-layers.mjs` | 三层验证器（20 项硬指标），退出码 0 / 2 / 1 |
| `lib/layers.mjs` | 判据本体（纯函数，可单测、可变异测试） |
| `test/layers.test.mjs` | 判据正反样本（27 条）；**改判据必跑** |
| `test/mutation-check.mjs` | 变异测试：对判据做定点突变，9/9 必须被抓到（防"判据恒真"） |
| `sync-presets.mjs` | 仓库 `presets/` → `payload/presets/` 单向同步（sha256，会删多余副本） |
| `pack-custom.mjs` | 打 release 资产 `dsh-unleashed-custom.zip`（内置 zip writer，字节可复现） |
| `THREE-LAYERS.md` | 三层定义、补丁映射、20 项指标、状态语义、陷阱、与上游同步表、已知偏差 |
| `payload/prompt-inject.md` | 提示词层本体（21 KB / 227 行，信封自闭合） |
| `payload/presets/*` | 三个模式（unrestricted / redteam / liangshen） |
| `payload/run-purge.mjs` | 引擎层 + 代码层：解包、打补丁、shim、关更新、换包重启；**硬失败退出码 2 且不换包** |
| `payload/swap-restart.ps1` | 换目录重启，启动失败自动回滚 |

## 用法

```powershell
# 1) 全流程（默认装 0xyxy/dsh-purge 的 latest）
.\install-layers.ps1

# 1b) 锁版本 / 换源（已装旧版本会真的升级，然后要求重启一次）
.\install-layers.ps1 -Tag v1.6.67 -Repo 0xyxy/dsh-purge

# 2) 只验证
node verify-layers.mjs            # 0 通过 / 2 待动作或等待 / 1 坏了
node verify-layers.mjs --json

# 3) 只做文件层，不重启
.\install-layers.ps1 -NoRestart
```

## 四条维护纪律

1. **仓库 `presets/` 是唯一事实源**。payload 里的 unrestricted/redteam 是它的副本，改预设只改仓库那份，然后 `node sync-presets.mjs`；P7 按 sha256 抓漂移。
2. **改判据必须同时加正反样本**，并跑 `mutation-check.mjs`。历史教训：C4 曾只判 `length > 0`，任何存在的文件都算通过。
3. **计数不许手抄**。补丁条数与状态分布由 C6 现场统计；文档只描述形态。
4. **判定要分状态**。`pending` 是 `ACTION_REQUIRED`（可等），`drifted` 才是 `BROKEN`（要停）；把两者混成"红"会让首次安装变成一片红噪声。

## 顺序为什么是引擎 → 代码 → 提示词

- 引擎层（解包 + 挪走 asar）决定**改的文件是否被加载**；不做这步，代码补丁写在磁盘上等于没写。
- 代码层（审批/沙箱/围栏判定）决定**放行与否**。
- 提示词层（话术与 persona）决定**模型读到的语境**，不做的话代码放开了、模型仍按旧话术缩回去。

详见 [THREE-LAYERS.md](THREE-LAYERS.md)。
