## A. 判据本身的错

1. **高：`skipped`/`na` 是无上下文放行，契约比状态生产者更宽。** `patchAccounting` 只看字符串并把两者一律结算；当前上游确实会把普通“文件在但锚点全丢”归为 `drifted`，`skipped` 主要留给 `silentWhenMissing`/撤销型补丁，所以眼下不必把所有 `skipped` 判红。但这里没有验证该补丁是否具备这些属性；以后状态生产逻辑变化，任意必需补丁返回 `skipped` 都会假绿。`na` 也只应在 `patchAppliesHere(p, surface) === false` 时通过，不能靠状态自证。建议把 `surface`、`applies`、`softSettleReason` 作为输入，`applied/already` 无条件通过，其余逐补丁判定；`missing_file` 保持失败。`bootstrap/lib/layers.mjs:23`、`bootstrap/lib/layers.mjs:92`、`lib/core.js:6906`、`lib/core.js:7523`

2. **阻断：`exempt: [71]` 已经能制造真实假绿，且 P5 不是独立证据。** #71 有两个目标，P5 只读 `$DSH_HOME/.agent-presets/liangshen/agent.cordis.yml`，并且只查 marker；若第一个目标有 marker、第二个目标仍为 `pending/unknown`，C6 会因白名单放行，P5 也会通过。marker 与 C6 的 `patchApplied` 又是同一证据源，不构成独立证明。删除裸 ID 白名单；至少要遍历 #71 的全部 `patchStatusDetail` 目标、解析 YAML、确认官方身份句不存在，再产生带 `patchId + targetPaths + proofKind` 的证明对象，不能让 `pending` 被豁免。`bootstrap/verify-layers.mjs:112`、`bootstrap/verify-layers.mjs:120`、`bootstrap/verify-layers.mjs:225`、`lib/core.js:2742`

3. **阻断：P6 名称说“成对”，实际 payload 的 project 标签不成对仍判绿。** 当前文件第 1 行有开标签、文件末尾无闭标签；`injectEnvelope` 仅加 note。依赖运行时补闭合意味着插件未加载、注入走旁路或 normalizer 回归时，后续官方段仍可能被包进 project 区域。计数相等也不够：`close → open`、嵌套 `open/open/close/close`、两开一闭、代码块里的字面标签都可能误判。应验证顺序和唯一性：project 要么 0/0，要么恰好 1/1 且 open 在 close 前；ChatML 同理并校验 `im_start(system) → project → /project → im_end`。若允许磁盘未闭合，P6 必须改成“运行时规范化后成对”，并直接调用同一 normalizer 做断言，不能宣称原文成对。`bootstrap/payload/prompt-inject.md:1`、`bootstrap/payload/prompt-inject.md:226`、`bootstrap/lib/layers.mjs:34`、`bootstrap/lib/layers.mjs:44`、`lib/identity.js:44`

4. **高：C4 可被 #68 或任意其它标记冒充，60KB 是版本耦合噪声。** `loopGuard` 只数通用 `[dsh-purge]`，agent-loop 中 #67 缺失但 #68 在位时照样通过；宿主压缩/拆包后体量变化还会产生无关的假红。#69 实际是 `llm-deepseek` 的可选网络补丁，不是 agent-loop 守卫，修复文案把 #67/#69并列也错。C4 应读取 `patchStatusDetail` 的 #67（若要覆盖 content 守卫则另查 #68），或至少查各自精确 marker 及目标文件；删掉体量阈值。`bootstrap/lib/layers.mjs:136`、`bootstrap/lib/layers.mjs:140`、`bootstrap/lib/layers.mjs:146`、`lib/core.js:4699`、`lib/core.js:4718`、`lib/core.js:4758`

5. **中：P7 的双轨在当前两个 shared 目录能抓住“改名”和“字节不同”，但边界会漏。** shared 内同内容改名会被 missing/extra 抓到；真正漏洞是 `SHARED_PRESETS` 硬编码，仓库新增第三个预设会被完全忽略，以及 `payloadOnly` 用目录前缀放行任意文件，重复副本可藏在白名单目录。另一个幂等缺口是同步写模式只复制 `drifted`，即使 `presetSync` 已发现 extra 也不删除、不失败。把路径集合与 SHA-256 合成一个 manifest 判据，`payloadOnly` 也列精确文件；同步后必须重新核验并对 extra 失败或显式删除。`bootstrap/verify-layers.mjs:148`、`bootstrap/verify-layers.mjs:155`、`bootstrap/lib/layers.mjs:70`、`bootstrap/lib/layers.mjs:74`、`bootstrap/sync-presets.mjs:55`、`bootstrap/sync-presets.mjs:72`

6. **中：P1/C2/C3 仍是可轻易假绿的启发式。** 20KB 任意文本可过 P1；C2 只要文件非空且某个符号名消失就算围栏已拆；C3 只要求两个字符串在同一文件共存，不证明升级映射关系。既然 C6 已有补丁表，应让这些行成为 C6 的定向语义视图，复用具体 patch id/target/detail，而不是另造弱字符串判据。`bootstrap/verify-layers.mjs:87`、`bootstrap/verify-layers.mjs:172`、`bootstrap/verify-layers.mjs:179`、`bootstrap/verify-layers.mjs:213`

## B. 流程与幂等

1. **阻断：已有插件永远不升级，`-Repo/-Tag` 对当前 1.6.60 安装无效。** 只有 `$pluginDir` 不存在才执行 `pnpm add`；目录存在时只读取并打印版本，既不比较目标版本，也不校验包来源。结果是脚本用 1.6.60 的 `ALL_PATCHES` 修改 rc.5，并由同一旧表自证成功。必须解析 release 期望版本/完整性，版本或来源不符时走官方安装事务升级，升级后用新进程重新 import 并核验。`bootstrap/install-layers.ps1:37`、`bootstrap/install-layers.ps1:94`、`bootstrap/install-layers.ps1:112`、`bootstrap/verify-layers.mjs:214`

2. **高：题设中的“sync 后已铺到 DSH_HOME”并不成立，但后半程确有半写。** sync 只改仓库的 `bootstrap/payload/presets`；首次插件安装分支随后直接退出，尚未执行 DSH_HOME 拷贝。因此插件安装失败不会先污染用户预设。真正的半写发生在插件已存在时：提示词/预设先覆盖，`run-purge` 后执行；补丁或换包失败会留下新的提示词/预设与旧宿主。预设有时间戳备份但无自动回滚，提示词还不一定有备份。应在任何用户文件写入前创建一次事务快照，全部完成后提交，失败按 manifest 恢复。`bootstrap/sync-presets.mjs:73`、`bootstrap/install-layers.ps1:94`、`bootstrap/install-layers.ps1:109`、`bootstrap/install-layers.ps1:115`、`bootstrap/install-layers.ps1:138`

3. **阻断：提示词备份条件与覆盖条件相反。** 只要现有自定义正文含 `<project_instructions>` 就不备份，但下一行仍无条件覆盖；这正是最可能的合法自定义格式。应对“存在且字节不同”的任何文件先原子备份，并优先使用插件已有的 provenance/`isKeepableUserOverride` 语义：未知所有权默认保留，只有已记录的旧默认才自动刷新。`bootstrap/install-layers.ps1:123`、`bootstrap/install-layers.ps1:124`、`bootstrap/install-layers.ps1:127`、`lib/core.js:8114`

4. **中：这里的 `$LASTEXITCODE` 在 PowerShell 5.1 与 7 均通常有效。** native `node.exe` 是管道中最后一个 native 进程，后面的 `ForEach-Object`/`Write-Host`/`Out-File` 是 cmdlet，不会重写它；所以当前写法不是已证 bug。它仍容易被以后在回调里加入 native 命令而污染，也无法区分“进程未启动”与“退出非零”。应在管道结束的下一句立即复制到局部变量，并用真实 `node -e process.exit(7)` 在 5.1/7 各跑一条回归。`bootstrap/install-layers.ps1:74`、`bootstrap/install-layers.ps1:77`、`bootstrap/install-layers.ps1:87`、`bootstrap/install-layers.ps1:144`

5. **阻断：轮询没有“宿主起来了”的证据，还可能在助手稍后回滚前提前绿。** verify 全是静态磁盘读取；首次红只代表换包未完成，不代表故障，连续打印 18 份红噪声。反向竞态更严重：swap 后第 10 秒可能全绿，安装器立即退出 0；助手到第 30 秒若没看到进程会恢复 asar，此时成功已经对外返回。应让换包助手写原子 phase（starting/waiting/complete/failed/rolled_back），轮询只在 transient phase 等待，只在 `complete + 进程就绪 + 连续两次同一 host identity` 后验收。`bootstrap/install-layers.ps1:153`、`bootstrap/install-layers.ps1:157`、`bootstrap/payload/run-purge.mjs:217`、`bootstrap/payload/swap-restart.ps1:42`、`bootstrap/payload/swap-restart.ps1:43`

6. **高：apply 的硬失败不会形成失败退出。** `run-purge` 统计 hard 后只打印，仍继续 shim、设置、换包并最终退出 0；`-NoRestart` 分支又明确跳过 verify。因此 partial/hit_mismatch/read_error 可以被调用方当作成功。hard 非空应在写入后停止换包并非零退出；若需要诊断，输出结构化 report。`bootstrap/payload/run-purge.mjs:103`、`bootstrap/payload/run-purge.mjs:108`、`bootstrap/payload/run-purge.mjs:208`、`bootstrap/install-layers.ps1:144`、`bootstrap/install-layers.ps1:149`

7. **高：自动强杀、自动重开与仓库当前 Windows handoff 契约冲突。** runner 启动 detached helper，helper 先 `CloseMainWindow` 再 `Stop-Process -Force`，随后自行 `Start-Process`；这绕过上游“等待用户完整退出、用户手动打开”的交接状态，也让安装器无法可靠归因启动失败。应复用插件的 handoff API/状态文件，安装器只报告 `waiting_for_quit` 并退出为待操作状态。`bootstrap/payload/run-purge.mjs:217`、`bootstrap/payload/run-purge.mjs:221`、`bootstrap/payload/swap-restart.ps1:20`、`bootstrap/payload/swap-restart.ps1:22`、`bootstrap/payload/swap-restart.ps1:41`

8. **中：`pending` 不该与损坏共用 FAIL。** 首次安装未应用是可预期的 `ACTION_REQUIRED`；换包中是 `WAITING`；`drifted/partial/unmatched/unreadable` 才是 `BROKEN`。建议输出 `PASS/N_A/WAITING/ACTION_REQUIRED/BROKEN`，退出码分别为 0/0/2/2/1；安装轮询只重试 WAITING，ACTION_REQUIRED 立即给“应用”动作，BROKEN 立即停止。当前布尔 `ok` 与 `layerSummary` 丢失了这些语义。`bootstrap/lib/layers.mjs:11`、`bootstrap/lib/layers.mjs:150`、`bootstrap/verify-layers.mjs:73`、`bootstrap/verify-layers.mjs:302`

## C. 还能怎么深化（按收益/成本排序）

1. **高收益/中成本：把 verify 变成可注入 evidence collector。** 抽出 `collectEvidence({fs, importCore, locateHost, processProbe, clock})`，CLI 只负责真实适配与渲染；用假宿主树和 core stub 跑 19 项端到端。自动化至少覆盖缺文件、不可读、partial、旧插件、换包中、回滚后、payload 漂移；断言 JSON 与退出码。`bootstrap/verify-layers.mjs:31`、`bootstrap/verify-layers.mjs:63`、`bootstrap/verify-layers.mjs:72`、`bootstrap/verify-layers.mjs:214`

2. **高收益/中成本：建立带 phase/severity 的判据协议。** 每个 verdict 返回 `{state, code, evidence, fix}`，禁止由 renderer 猜状态；给时序测试喂 `starting → waiting_for_quit → complete`、`complete → rolled_back`、`pending`、`drifted`，验证轮询只重试瞬态且不会提前绿。`bootstrap/lib/layers.mjs:150`、`bootstrap/install-layers.ps1:157`、`bootstrap/verify-layers.mjs:287`

3. **高收益/中成本：安装事务覆盖版本、来源和用户文件。** 预检目标包版本/SHA、当前包来源和所有待写路径，做 manifest 快照；模拟 pnpm 退出 1、payload 复制第 N 个文件失败、run-purge hard、换包 rollback，逐项断言 profile、prompt、presets 恢复且旧入口仍可用。`bootstrap/install-layers.ps1:37`、`bootstrap/install-layers.ps1:94`、`bootstrap/install-layers.ps1:123`、`bootstrap/install-layers.ps1:131`

4. **高收益/低成本：给信封做有限状态解析与性质测试。** 从 `normalizeChatmlLayout` 导出共享解析结果；表驱动加 `close/open`、嵌套、多开少闭、大小写、代码块字面量，再用随机标签序列断言“判绿 ⇒ 规范化后恰好一个合法闭合区间且二次规范化不变”。`bootstrap/lib/layers.mjs:34`、`bootstrap/test/layers.test.mjs:14`、`lib/identity.js:44`

5. **中高收益/低成本：用单一 preset manifest 取代列表/字节双轨。** manifest 记录相对路径、preset owner、SHA-256；测试新增第三个仓库预设、shared 改名、payloadOnly 多文件、extra、不可读和复制中断，sync 后必须零 drift。`bootstrap/lib/layers.mjs:70`、`bootstrap/verify-layers.mjs:148`、`bootstrap/sync-presets.mjs:50`

6. **中高收益/中成本：加入 apply provenance 判别。** 读取 `applied.json/installed-rev`、目标宿主 archive identity 和当前插件版本，把“从未应用”“已应用后官方更新”“同宿主锚点漂移”分开；fixture 依次替换宿主 identity，断言只在第二种给“重新应用”，第三种给 diagnose/reanchor。`bootstrap/verify-layers.mjs:213`、`lib/core.js:7423`、`lib/core.js:8334`

7. **中收益/中成本：把 `expect` 扩成只读 preflight，而不是粗暴断言每条恰好命中一次。** 多文件、版本分支和级联补丁使“每条=1”不成立；应按 replacement 自身的 `expect`、目标文件基数和 chainedAfter 计算允许区间，在任何写入前生成 plan。测试给锚点复制第二份，断言 `hit_mismatch` 且宿主字节完全不变。`lib/core.js:7029`、`lib/core.js:7049`、`lib/core.js:7254`

8. **中收益/低成本：红项携带结构化修复计划。** 不再只放自由文本 `fix`，而是 `{action, command, patchIds, prerequisites, destructive:false}`；为 19 个 id 做快照测试。`pending` 映射 apply，单个 drift 映射 diagnose 后再建议具体 reanchor，缺宿主映射 `--exe`，绝不能对未知候选自动执行 reanchor。`bootstrap/lib/layers.mjs:130`、`bootstrap/verify-layers.mjs:73`、`bootstrap/verify-layers.mjs:295`
