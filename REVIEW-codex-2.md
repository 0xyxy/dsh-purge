# 第二轮对抗性审查

## 严重

1. **发行包布局会删除共享预设，并最终自证为绿。** `bootstrap/pack-custom.mjs:31-40,141-149` 把 `bootstrap` 内容平铺到 ZIP 根，且不收录仓库根 `presets/`；解包运行时，`bootstrap/sync-presets.mjs:24-30,61-67` 却把脚本父目录的父目录当仓库根。于是 `repoManifest` 为空，`bootstrap/sync-presets.mjs:91-105` 会删除 payload 下 `unrestricted/`、`redteam/`，随后空集合核验 PASS；`bootstrap/verify-layers.mjs:180-190` 也会因过滤不存在的 canonical 目录而放绿。最小改法：ZIP 保留 `bootstrap/...` 并收录根 `presets/`；同时 P7 明确要求两个 SHARED 源目录存在，不得用 `filter(existsSync)` 降格为空集合。加“解压 ZIP→运行 sync→共享预设仍在且哈希一致”的产物测试。

2. **硬失败后的回滚不是事务，且会制造宿主/用户文件混合版本。** 用户文件先在 `bootstrap/install-layers.ps1:147-177` 覆盖；宿主随后在 `bootstrap/payload/run-purge.mjs:89-140` 解包并原地部分打补丁，退出 2 只保证未换 asar，不会撤销 `resources/app`。`bootstrap/install-layers.ps1:198-201` 却只回退用户文件。若宿主已经运行 unpacked 入口，混合状态立即生效；即使仍跑 asar，磁盘也不再对应同一事务。且原文件/目录不存在时根本没加入 `$written`（`install-layers.ps1:158-175`），所谓回滚不会删除本次新建项。最小改法：短期在 exit 2 时**不自动回退用户文件**，只报告备份位置；正确边界是把宿主补丁施加到 staging app，apply report 全绿后再原子提交 app、用户文件、shim、偏好。若坚持回滚，必须同时恢复宿主快照，并记录 `existed:false` 以删除新建目标。

## 高

3. **状态聚合仍有两个假绿入口。** `bootstrap/lib/layers.mjs:41-47` 对空集合返回 PASS，导致空层及 `required=[]` 的补丁核对假装已证明；未知/拼错状态通过 `STATE_RANK[s] ?? 0` 也按 PASS 处理。全 N_A 当前会正确返回 N_A，ACTION_REQUIRED 的 rank 也高于 WAITING，不存在这两种吞并。最小改法：`worstState([]) => N_A`；遇到非枚举状态返回 BROKEN（或抛错后由调用方转 BROKEN）；`layerSummary([])` 全局单独判 BROKEN。补空层、非法状态、WAITING+ACTION_REQUIRED 三组测试。

4. **C6 跳过规则仍能放行“该打没打”。** `bootstrap/lib/layers.mjs:131-135,159-166` 仅凭 `silentWhenMissing` 或任一 pattern 含 `[dsh-purge]` 就把 skipped 变 N_A；这无法区分“撤销型 marker 本来不存在”和“目标存在但原锚点漂移”。另外 `layers.mjs:153-155` 无条件排除所有 optional、disabledByDefault 补丁，连已启用 opt-in 或目标实际存在的 optional 漂移也不核对。最小改法：由 core 输出有证据的终态 `not_needed`（含 target_missing / forbidden_marker_absent / clean_content），C6 只接受该终态；删除 pattern 文本启发式；传入启用清单及逐文件 detail，optional 仅在目标确实不存在时 N_A。

5. **C7 在最需要诊断时恰好 N_A。** C6 的 unknown 会 BROKEN，但文本输出只给 `unknown N`，问题 ID 只藏在 JSON 的 `patch_accounting.problems`（`bootstrap/lib/layers.mjs:169,183-202`）；C7 又只收 pending（`bootstrap/verify-layers.mjs:268-296`），unknown/unmatched/read error 无锚点信息。读取为空会 `continue`，异常甚至转 N_A。最小改法：C6 detail 直接列出失败 ID/status；C7 检查 pending、unknown、drifted、unmatched，并把 unreadable/异常判 BROKEN。`src.split(pattern)` 对**字符串**按字面量分割，正则元字符不会算错；真正的 RegExp pattern 被 `typeof !== "string"` 静默跳过，需 clone 全局正则计数。还应尊重 `expect`，而不是只取各锚点计数的 max。

6. **run-purge 的结构化报告没有形成契约。** 报告已写到 `bootstrap/payload/run-purge.mjs:111-133`，但写失败只记日志，install-layers 完全不读取；它只看退出码，而且除 2 外的非零码仍继续验证（`bootstrap/install-layers.ps1:196-205`）。最小改法：为每次运行生成 run_id，报告用临时文件原子落盘，含 `complete`、pre/post、mutations、hard；写报告失败即非零。install-layers 删除旧报告、传 run_id、强制解析匹配报告；任何非 0 立即停，不能靠旧磁盘状态验证成绿。

## 中

7. **P6 仍是词法计数，不是信封验证。** `bootstrap/lib/layers.mjs:64-73` 会把 HTML 注释、Markdown fenced code 内的字面标签算进去：注释中的一对会误报“双信封”，更糟的是正文真实开标签可被注释中的闭标签“配平”而 PASS。最小改法：先剔除 fenced code/HTML comment 再扫描；对本项目 prompt 直接要求 trim 后首个 token 是 open、最后 token 是 close，且正文无第二对。补注释闭标签配平、代码块假标签、两对真实标签测试。

8. **C4 的插件 marker 回退是“全有或全无”，旧/残缺补丁表可少验一项。** `bootstrap/verify-layers.mjs:215-222` 只要 #67/#68 任一个取到 marker，`marks.length` 就不走常量回退。最小改法：逐 ID 取 marker；该 ID 缺失时只给该 ID 使用常量，并要求最终恰有两项。当前检查已不再依赖通用 marker 或 60KB，方向正确。

9. **P6 当前磁盘正文与 normalizer 没有重复包裹。** `bootstrap/payload/prompt-inject.md:1,227` 只有一对真实 project 标签；`lib/identity.js:44-66` 只整理 ChatML、删除单边 ChatML、补缺失 close，不会新增 project open，也不会给完整对再包一层。这一项改对了；漏洞仅是上面的静态扫描误判。

10. **ZIP writer 的经典 ZIP 字段本身正确，但没有边界与独立读取验证。** CRC32（`bootstrap/pack-custom.mjs:42-55`）、本地/中央 UTF-8 flag（`:83-105`）、中央目录 offset/size（`:114-130`）写法正确；风险是文件数、单文件大小、offset 超过 classic ZIP 上限时无显式拒绝，也没有用独立实现验证 CRC/目录。最小改法：写前检查 16/32 位上限，构建后用 `ZipArchive`/`unzip -t` 独立读取并逐文件比 bytes；加入 Unicode 文件名、空文件、stored/deflated、确定性重复构建用例。

## 逐项验收

| 项 | 结论 |
|---|---|
| 状态模型 | 部分正确；0/2/1、连续两次 0、BROKEN 立即停已实现；空集合/非法状态仍假绿。 |
| #71 豁免 | 改对；`verify-layers.mjs:253-260` 三条件缺一即 proof=false。应保留结果证据而非只信 marker 文本。 |
| P6 信封 | payload 与 runtime 不再重复包裹；词法扫描仍可被注释/代码块欺骗。 |
| C4 | 具体 marker 已实现；逐 ID fallback 仍需修。 |
| P7 | 仓库内 manifest/同步后复验已实现；发行包路径使其破坏性失效。 |
| 插件版本 | `install-layers.ps1:105-145` 确实 pnpm add、检查版本、非零失败并要求重启，改对。 |
| 硬失败 | exit 2 且默认不换包已实现；宿主已原地部分修改，用户文件单边回滚不对。 |
| 提示词备份 | 存在即备份已实现；不存在时缺少 `existed:false`，回滚不完整。 |
| 9 条突变 | 文件确有 9 条且逻辑能检出目标突变；但未进入默认 CI。 |

## 仍缺的自动化改造（收益/成本顺序）

1. **产物级 E2E：** 解压真实 custom ZIP 到临时目录，运行 sync/verify 的可注入入口，断言 canonical/payload 路径、共享预设、P6/C6/C7 与退出码；不要只测 `layers.mjs` 纯函数。
2. **verify IO 注入：** 把 `bootstrap/verify-layers.mjs:18-75` 的顶层定位/读盘/退出拆成 `verify({fs, env, exe, coreLoader})`，CLI 只渲染；假宿主覆盖 unreadable、空目录、异常、unknown、pending→applied。
3. **事务故障注入：** 为 install/run-purge 加 temp-root 与阶段 failpoint，逐阶段断言 exit 2/1 后 app、用户文件、shim、偏好要么全是 before，要么全是 after；同时校验 run_id apply report，禁止混合态。
4. **发行门禁：** `package.json:45-54` 的默认 test 与 `.github/workflows/release.yml:24-44` 都未运行 `test:bootstrap`、未构建/上传 custom ZIP。release 必须运行 bootstrap 变异测试、构建 ZIP、独立解压验 CRC/内容，再把 ZIP加入 release 资产；否则安装器默认的 `CustomUrl` 没有仓库内可证明的产物来源。
