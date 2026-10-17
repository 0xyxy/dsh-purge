<div align="center">

# Purge Community

**给 DeepSeek Harness 拆闸的插件。**

83 条宿主补丁 · 27 层破甲自检 · 提示词/规则/技能管理 · 左侧栏整页设置 · 备份与回滚

[![Release](https://img.shields.io/github/v/release/kingcharleslzy-ai/dsh-purge?label=Community)](https://github.com/kingcharleslzy-ai/dsh-purge/releases)
[发行与下载](https://github.com/kingcharleslzy-ai/dsh-purge/releases) · [安装](#安装) · [破甲自检](#破甲自检) · [补丁清单](#补丁清单) · [English](docs/README.en.md)

</div>

这是 [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) 的社区维护分支（原作者 **小杨**，MIT）。上游已停止更新、且原版补丁表对新版 DSH 失效；本分支把全部能力移植到 **DSH 0.2.1-rc.1**，并把"补丁到底有没有生效"变成可复算的检查。

## 它解决什么

模型不是不能干，是在**四道闸**前面被拦下来：模型自己的拒绝、审批弹窗、沙箱/权限拒绝、以及"你要不要确认一下"式的回合中断。这个插件把四道闸逐个拆掉：

| 闸门 | 拆法 |
| --- | --- |
| **模型层** | 用户的 `prompt-inject.md` 每步作为最高优先级 section 注入；剥掉官方身份句；尾部追加破甲强化段（层级声明 / 拒绝即故障 / 抗谄媚 / 多轮重申） |
| **审批层** | 审批门自动授信、`never` 提示句旁路、无 UI 通道时 fail-open、`run_code` / 工具 ask 放行、计划模式不硬拦 |
| **沙箱层** | `confine()` 直通（不再包 bwrap）、fs 围栏禁用、观察策略放行、沙箱拒绝话术中性化 |
| **回合层** | 重复工具守卫与结果修剪禁用、Auto Review 不否决、`ask_user_question` 最多等 1 秒就继续、UI 发消息永远新 turn |

## 能力总览

**提示词**：注入正文编辑、分类排序、身份剥离、能力协议段、按预设适配（标准/极简/complete）、注入位置可切（`head` / `tail` / `both`）、尾部强化段（默认开）。

**宿主补丁（83 条）**：提示词 25 · 代码 46 · 工具 9 · 兼容 3。每一条都能单独查状态；写入前自动建 profile 快照，逐文件留 `.dshpurge.bak`。

**面板**：**左侧栏 `Purge` 入口**，打开就是整页设置（页签：状态 / 提示词 / 规则 / 技能 / 演练台 / 更多），排版跟 DSH 原生设置一致，名词解释放在标题后的 `?` 里。状态页含兼容级别、补丁计数、**破甲自检**、逐条补丁组、**破甲强化段**开关、备份与更新。

**CLI**：原始 `dsh-purge` 与 `purge-community` 双入口，功能等价。

**安全网**：每次应用/安装/回滚前生成快照，保留最近 5 份 + 每天 1 份 × 7 天 + 总量 200MB；回滚只恢复插件代码与入口，不动你后来改过的提示词/规则。

## 破甲自检

装完先跑这个，比"插件装上了"可靠：

```sh
purge-community selfcheck           # 人读
purge-community selfcheck --json    # 机读
```

面板「状态 → 破甲自检」同源。它逐层回答"这条通道现在通不通"，当前 0.2.1-rc.1 上的实测：

```
DSH 0.2.1-rc.1 · qualified · 宿主补丁 75/83

✓ 沙箱 confine 直通      ✓ 审批自动放行        ✓ 注入不被预设覆盖
✓ 文件系统围栏禁用        ✓ 重复调用守卫禁用     ✓ 官方身份剥离
✓ 观察策略放行           ✓ 工具结果修剪禁用     ✓ Web 面身份中性化
✓ 拒绝话术中性化         ✓ Auto Review 不拦     ✓ 工具上限放宽(21/22/23)
✓ 默认策略               ✓ 工具审批 fail-open   ✓ 子代理不设锁(24/37)
✓ 重复守卫               ✓ 计划模式不硬拦       ✓ 回退不残留(56/58/75/77)
✓ 外部内容不降级         ✓ 模型网关兼容         ✓ 会话与提示词挂载
✓ 桌面宿主启动兜底       ✓ 运行时提示词注入     ✓ profile 权限选择
✓ 宿主运行方式（asar 是否密封）
```

每层都标 `applied/required`；目标插件没装的层显示"当前不适用"，不会冒充成功。

## 安装

需要已初始化的 DSH Desktop（自带 Node 运行时）。从 [Releases](https://github.com/kingcharleslzy-ai/dsh-purge/releases/latest) 下载 `dsh-purge-community-1.3.1.tgz` 与 `SHA256SUMS.txt`：

```sh
shasum -a 256 -c SHA256SUMS.txt
mkdir purge-community-installer
tar -xzf dsh-purge-community-1.3.1.tgz -C purge-community-installer

APP="/Applications/DeepSeek Harness.app"
ELECTRON_RUN_AS_NODE=1 "$APP/Contents/MacOS/DeepSeek Harness" \
  "$PWD/purge-community-installer/package/bin/community.js" migrate \
  "$PWD/dsh-purge-community-1.3.1.tgz"
```

安装器会先备份，再把旧 Purge 入口合并成 `dsh-purge-community`，其他插件不动。装完**手动完全退出并重开 DSH**，然后：

1. 右侧 **Purge Community → 状态**，看「兼容与诊断」应为 `qualified`；
2. 点 **应用**（官方桌面版会先解开 `app.asar`，写入前自动建快照）；
3. 按提示**再退出重开一次**，让解包后的宿主生效；
4. 回来跑一次 `selfcheck`，确认各层在位。

> 不要用 `dsh plugin add` 裸装：那会跳过迁移备份与入口切换。

## 日常命令

```sh
purge-community status              # 宿主/补丁总览
purge-community selfcheck           # 破甲自检
purge-community diagnose            # 漂移诊断（哪条锚点没命中 + 可能的新落点）
purge-community boost on|off        # 尾部强化段（默认 on）
purge-community usage               # 备份占用
purge-community prune               # 立即清理旧备份
purge-community apply|revert|uninstall|edit   # 原版能力，直接转发
```

注入位置与强化段存在 `$DSH_HOME/dsh-purge/tuning.json`，面板里也能改，改完重启生效：

```json
{ "boost": true, "injectPosition": "head", "askNoBlock": true }
```

`injectPosition` 取 `head`（省 token、缓存友好）、`tail`（贴输出，多轮衰减最小）、`both`（两头都钉）。

## 补丁清单

<details>
<summary><b>83 条，按层分组（点开）</b></summary>

**提示词（25）**：身份/人设剥离、Web 面身份中性化与"别另起服务器"移除、审批与沙箱拒绝话术、交付物禁令、跨会话引用框架、`complete` 预设保留注入、每步重贴 system、极简/梁神预设适配、身份卡与目标段。

**代码（46）**：沙箱 `confine` 直通、fs 围栏、观察策略、审批自动授信与 escalation 无条件、`developer` role 回退、stream 连接、`rewind` 全链路（只藏被撤的那轮 / 不进模型请求 / append 即替换 / todo 回收）、会话 followup 去竞态、挂载去重、桌面壳兜底（缺 `DSH_PROFILE`、信号杀不弹崩溃框、官方更新交棒）、settings legacy API、subagent 深度 3→10、read 上限、bash 等待恢复、session log 默认不上传。

**工具（9）**：bash/pwsh 删除移动谨慎语、`run_code` 审批话术、fs escalation schema、web untrusted 框架、子代理 scope 锁、`ask_user_question` 不再卡回合（#89）、minimal 工具表恢复。

**兼容（3）**：0.1.5 `complete` 注入、0.2.0 Anthropic OAuth 身份、persona 字段别名。

</details>

每条的状态、目标文件、期望原文都能在面板逐条展开；`diagnose` 会给出漂移项的**可能新落点**（行号 + 片段），方便手动或后续自动重锚。

## 兼容性

| 环境 | 状态 |
| --- | --- |
| macOS · DSH Desktop **0.2.1-rc.1** | 已回归：83 条锚点、面板、CLI、自检 27 层全绿 |
| macOS · 其他 DSH 版本 | 允许应用，标"未验证"；先跑 `selfcheck` / `diagnose` |
| 宿主组件版本不一致 | 只报告，不阻止写入 |
| Windows / Web profile | 代码路径保留，本版未做端到端验收 |

DSH 升级后：`app.asar` 会重新出现、面板显示"asar 仍密封"，点一次**应用**再退出重开即可；补丁表若有漂移，`diagnose` 会指出来。

## 回滚

```sh
# 应用打不开（最坏情况）
R="/Applications/DeepSeek Harness.app/Contents/Resources"
mv "$R/app.asar.bak" "$R/app.asar"

# 只回滚宿主补丁
purge-community revert

# 回滚插件（保留当前提示词/规则）
purge-community rollback <backup-id>
```

## 开发与验证

```sh
npm --prefix packages/purge-panel ci --ignore-scripts --legacy-peer-deps
npm run build:client      # 从 packages/purge-panel/src 生成根 client.js
npm test                  # 25 项：补丁锚点 / 自检 / boost / 备份与安装
npm run test:ui
npm --prefix packages/purge-panel test
npm run check:client
npm run diagnose
```

`test/patch-anchors.test.mjs` 把 0.2.1 的真实源码片段钉进用例：谁改了锚点而没同步用例，测试直接失败。

## 来源与边界

原项目 [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)，作者 **小杨**；本分支保留 Git 历史与 MIT [LICENSE](LICENSE)，第三方来源见 [NOTICE](NOTICE.md)。社区版的包名、发布与更新源由本仓库独立管理。

插件负责**拆掉 harness 与宿主默认策略的闸**，不负责替模型判断某件事该不该做；模型最终输出仍取决于模型本身。上游通道仅作历史保留，默认不选。
