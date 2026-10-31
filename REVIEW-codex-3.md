# 第三轮对抗性审查

## 结论

当前不宜收口。第二轮修复大体有效，但还剩 **2 个假绿**（C6、汇总文案）和 **1 个发行源错配**（ZIP 由 `kingcharleslzy-ai` 发布，内置安装器默认却拉 `0xyxy`）。`activeIds` 的“任一目标存在”本身不会制造所担心的半安装假红，反而暴露了 `fileAllRequired` 缺目标仍可能假绿。

## A. 新假绿 / 假红

### A1. C6 的 `readyFn` 是严重假绿

`patchStatusReady()` 是状态页的“软就绪”判据，不是硬验收判据：它对 `skipped`、`missing_file` 都返回 `true`。C6 因而会把以下情况结算为 `N_A`：

- 必需补丁目标缺失：非 optional 补丁仍进入 `required`，状态为 `missing_file`，随后被 `readyFn` 放行。
- 目标文件存在，但 marker、旧锚点都不存在：自标记补丁会得到 `skipped`，仍被无条件放行。
- 插件未来新增任何“状态页可忽略、验收不可忽略”的软状态，也会被 C6 自动继承为假绿。

这正是“该打没打上但插件认为无对象”一起放行。`activeIds` 在 `readyFn` 分支里无法兜住它。

最小改法：C6 改调 `patchStatusDetail()`，传入 `report.status`、`report.files` 和逐 key 的 `targetFiles()` 存在性；不要把 `patchStatusReady()` 用作最终裁决。硬规则应为：

- `applied/already` → PASS；`pending` → ACTION_REQUIRED；`na/disabled` → N_A。
- 必需补丁 `missing_file` → BROKEN。
- `skipped` 仅在 `silentWhenMissing` / `settleWhenAbsent`，或 optional 且所有目标确实不存在时 → N_A。
- `report.files[id]` 中只要有现存目标的 `skipped/drifted/unmatched/unreadable`，除声明的 `fileOptional` 外均 → BROKEN。

新增单测至少覆盖“必需 missing_file + readyFn=true”和“现存文件 skipped + readyFn=true”，两者都必须红。

### A2. `activeIds = 任一目标存在` 不会造成所述假红，但有相反风险

不会仅因第三方插件只装了一半而假红。core 的聚合会忽略缺失 sibling key；只有现存文件本身 pending/drifted 才会红，这属于有效故障。多个 key 还常表示不同版本/布局的替代入口，`any` 比 `all` 合理。

相反，`fileAllRequired` 当前的 partial 判定只检查“存在但未 settled”的 key，缺失 key 被排除；一个目标 applied、另一个必需目标缺失时仍可报 applied。最小改法是在 `patchStatusDetail().files` 方案中按声明区分：普通多目标用 `any` 激活；`fileAllRequired` 要求每个非 `fileOptional` key 存在且 settled。为两种契约各加 fixture。

### A3. `worstState` 正确，`pass` 展示仍是假绿

空集/全 N_A → N_A、未知状态 → BROKEN 都正确；问题在 `layerSummary.pass` 把 PASS 与 N_A 合并，最终打印“X/Y 项通过”，JSON 又以 `exitCode === 0` 给出 `ok: true`。整层什么都没验时，层状态虽显示 N_A，合计仍会宣称通过。

最小改法：拆成 `verified`（PASS）、`not_applicable`（N_A）、`settled`（两者之和）；界面写“已验证 X / 不适用 Y / 总计 Z”。保留 exit 0 表示“不阻塞”，但不要把它命名或渲染成“已验证通过”。加全 N_A 层的快照/JSON 断言。

## B. 发行链路

### B1. `git archive` TGZ 可以被 pnpm 安装，但不能直接照抄 `files`

现有 `package.json` 字段足够；pnpm 不要求 tar 内有 npm 自动生成的 integrity、lockfile 或其他物化元数据。硬要求是 tar 根布局为 `package/`，且必须有 `package/package.json`、`main`、两个 `bin` 目标及运行时文件。

风险点：`files` 数组没有列 `package.json`，npm pack 会强制加入它，`git archive HEAD <files...>` 不会；此外 `!lib/default-prompt-inject.md` 不是可直接照搬的普通路径，应转换为 Git pathspec exclude。缺 `package/package.json` 时 `pnpm add` 必然失败或不能识别为该包。

最小产物验证应在临时目录完成：

```sh
tar -tzf dsh-purge-community.tgz | grep -x package/package.json
tmp="$(mktemp -d)"
printf '{"private":true}' > "$tmp/package.json"
pnpm --dir "$tmp" add "$PWD/dsh-purge-community.tgz"
node -e "const fs=require('fs'),p=require(process.argv[1]); for(const f of [p.main,...Object.values(p.bin)]) if(!fs.existsSync(require('path').join(require('path').dirname(process.argv[1]),f))) process.exit(1)" "$tmp/node_modules/dsh-purge-community/package.json"
```

CI 再对该手工 TGZ 跑现有 `scripts/smoke.mjs`。构造清单时显式加入 `package.json`，并用 `:(exclude)lib/default-prompt-inject.md`。

### B2. `latest` 没有可靠的版本/来源绑定

`-Tag latest` 会下载 GitHub 当前 latest release 的无版本资产。若 latest 不是 `v1.6.67`：

- latest 没有 `dsh-purge-community.tgz`：直接 404。
- 有同名资产：会安装那个版本。
- 仓库 checkout 中能从父目录 `package.json` 得到 `ExpectVersion=1.6.67`，但首次安装分支安装后直接 exit，不立即比对；第二次运行才会发现并再次拉同一错误 URL后失败。
- custom ZIP 根没有 `package.json`，所以 `ExpectVersion` 为空，版本检查完全关闭，错误版本会继续进入补丁阶段。

更严重的是 release workflow 只在 `kingcharleslzy-ai/dsh-purge` 发布，而 ZIP 内脚本默认 `Repo=0xyxy/dsh-purge`；不显式传参时，定制层来自 fork，插件层来自上游，来源不一致。

最小改法：ZIP 加 `release-manifest.json`（repo/tag/version/两资产 SHA256），安装器默认只读它；首次安装后也立即核对版本；下载后先验 SHA256 再 `pnpm add`。`latest` 仅作为显式选择，发行 ZIP 默认固定自身 tag/version/repo。

### B3. ZIP 内脚本与仓库脚本相同，但默认仓库与 ZIP 来源不同

`pack-custom.mjs` 的 `ENTRIES` 直接收录 `bootstrap/install-layers.ps1`，因此构建时字节相同；解压后位置是 `bootstrap/install-layers.ps1`，`$PSScriptRoot` 也与 `presets/` 的新布局匹配。

但脚本默认 `Repo=0xyxy/dsh-purge`，与 workflow 的发布仓库 `kingcharleslzy-ai/dsh-purge` 不一致。另一个边角故障：若只拿脚本、缺本地 payload，它把新版整包 ZIP 解压到 `$here/payload`，会形成 `payload/bootstrap/payload/...`，后续仍找不到 `$here/payload/prompt-inject.md`。下载分支应解到临时根，再选择其中的 `bootstrap/payload`，并校验 manifest。

## C. 剩余工作（按收益/成本）

1. **C6 改用逐文件硬证据（高收益/低成本）**：接入 `patchStatusDetail().files`，删除硬验收对 `patchStatusReady()` 的依赖；表驱动测试覆盖 required missing、existing skipped、fileOptional、fileAllRequired 缺 key。
2. **给 `verify-layers.mjs` 注入 IO/宿主定位（高收益/中成本）**：导出 `verify({fs, importCore, exe, dshHome})`，用临时假宿主端到端跑 P1–P7/C1–C7/E1–E6；断言缺文件、不可读、半安装、漂移不会绿。当前纯函数测试抓不到接线错误。
3. **apply 报告加 run_id 并原子写（中收益/低成本）**：安装器生成 run_id 传给 runner；报告写同目录临时文件后 rename；安装器只接受本次 run_id。测试预置旧报告、模拟写一半/写前崩溃，必须拒绝把旧报告当本次结果。
