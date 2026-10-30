# bootstrap — 三层破甲安装器

本目录是**自包含**的：不联网也能装（除了首次拉插件 tgz）。

| 文件 | 作用 |
|---|---|
| `install-layers.ps1` | 主入口：装插件 → 铺提示词与预设 → 解包打补丁 → 写 shim → 关自动更新 → 重启 → 三层验证 |
| `verify-layers.mjs` | 三层验证器，16 项硬指标，退出码 0/1 |
| `THREE-LAYERS.md` | 三层定义、补丁映射、16 项指标、陷阱与定位顺序 |
| `payload/prompt-inject.md` | 提示词层本体（25 KB） |
| `payload/presets/*` | 三个模式（unrestricted / redteam / liangshen） |
| `payload/run-purge.mjs` | 引擎层 + 代码层：解包、打补丁、shim、关更新、自动重启 |
| `payload/swap-restart.ps1` | 换目录重启，启动失败自动回滚 |

## 三种用法

```powershell
# 1) 全流程
.\install-layers.ps1

# 2) 只验证（不改任何文件）
node verify-layers.mjs

# 3) 只做文件层，不重启
.\install-layers.ps1 -NoRestart
```

## 顺序为什么是引擎 → 代码 → 提示词

- 引擎层（解包 + 挪走 asar）决定**改的文件是否被加载**；不做这步，代码补丁写在磁盘上等于没写。
- 代码层（审批/沙箱/围栏判定）决定**放行与否**。
- 提示词层（话术与 persona）决定**模型读到的语境**，不做的话代码放开了、模型仍按旧话术缩回去。

详见 [THREE-LAYERS.md](THREE-LAYERS.md)。
