#!/usr/bin/env node
/**
 * 变异测试：证明判据的单测不是"空跑"。
 *
 * 做法：把 lib/layers.mjs 的源码做定点突变，用 data: URL 重新 import，检查判据的结论
 * **确实变了**。若某条突变后判据仍给同样答案，说明那个突变没被任何判据覆盖到——
 * 这正是历史上 C4 只判 `length > 0` 却一直显示通过的原因（判据恒真 = 单测抓不到）。
 *
 * 用法：node bootstrap/test/mutation-check.mjs     # 退出码 0 = 每条突变都被抓到
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "lib", "layers.mjs"), "utf8");

/** 判据"可接受"的定义：PASS 或 N_A。 */
const acceptable = (v) => v.state === "PASS" || v.state === "N_A";

const MUTATIONS = [
  {
    name: "C4 忽略缺失的 marker（回到数通用痕迹）",
    from: "const missing = markers.filter((m) => !text.includes(m));",
    to: "const missing = [];",
    run: async (m) => acceptable(m.guardMarkers({ src: "[dsh-purge] 别的补丁\n", markers: ["[dsh-purge] guard undefined messages"] })),
    correct: false,
    mutated: true,
  },
  {
    name: "C6 把 pending 当通过（回到软成功）",
    from: '      case "pending":\n        return "ACTION_REQUIRED";',
    to: '      case "pending":\n        return "PASS";',
    run: async (m) =>
      acceptable(m.patchAccounting({ patches: [{ id: 1, layer: "代码" }], statusById: { 1: "pending" } })),
    correct: false,
    mutated: true,
  },
  {
    name: "C6 完全不看漂移（两条上报路径一起掐掉）",
    from: "const driftIds = (drift?.drifted || []).map((x) => (x && (x.id ?? x.patch_id)) ?? x);",
    to: "const driftIds = [];",
    from2: "const partialIds = (drift?.partial_drift || []).map((x) => (x && (x.id ?? x.patch_id)) ?? x);",
    to2: "const partialIds = [];",
    run: async (m) =>
      acceptable(
        m.patchAccounting({ patches: [{ id: 1, layer: "代码" }], statusById: { 1: "applied" }, drift: { drifted: [1] } }),
      ),
    correct: false,
    mutated: true,
  },
  {
    name: "C6 豁免不需要 proof（裸 id 白名单）",
    from: 'if (state === "BROKEN" && exempt[p.id]?.proof === true) {',
    to: 'if (state === "BROKEN" && p.id in exempt) {',
    run: async (m) =>
      acceptable(
        m.patchAccounting({ patches: [{ id: 71, layer: "代码" }], statusById: { 71: "unknown" }, exempt: { 71: { reason: "x", proof: false } } }),
      ),
    correct: false,
    mutated: true,
  },
  {
    name: "P6 不再检查标签成对（#107 回潮）",
    from: "if (opens.length !== closes.length) {",
    to: "if (false) {",
    run: async (m) => acceptable(m.injectEnvelope("<|im_start|>system:\n<project_instructions>\n正文\n</project_instructions>")),
    correct: false,
    mutated: true,
  },
  {
    name: "P6 不再要求标签包裹整个正文（中间夹一对也放过）",
    from: "if (!project.absent && chatml.absent && !wrapped) {",
    to: "if (false) {",
    run: async (m) => acceptable(m.injectEnvelope("正文开头\n<project_instructions>x</project_instructions>\n官方段")),
    correct: false,
    mutated: true,
  },
  {
    name: "P7 不比内容哈希（只看文件名）",
    from: "const changed = repoFiles.filter((f) => f in payloadManifest && repoManifest[f] !== payloadManifest[f]);",
    to: "const changed = [];",
    run: async (m) => acceptable(m.presetSync({ repoManifest: { "u/a.yml": "h1" }, payloadManifest: { "u/a.yml": "h2" } })),
    correct: false,
    mutated: true,
  },
  {
    name: "P7 放过 payload 多出的副本",
    from: "const extra = payloadFiles.filter((f) => !(f in repoManifest) && !allow(f));",
    to: "const extra = [];",
    run: async (m) => acceptable(m.presetSync({ repoManifest: {}, payloadManifest: { "stray/x.yml": "h" } })),
    correct: false,
    mutated: true,
  },
  {
    name: "状态聚合恒真（渲染层永远绿）",
    from: 'if (worst === "BROKEN") return 1;',
    to: "return 0;",
    run: async (m) => m.exitCodeFor(["BROKEN"]) === 0,
    correct: false,
    mutated: true,
  },
];

let caught = 0;
for (const mut of MUTATIONS) {
  if (!source.includes(mut.from)) {
    console.error(`✗ 突变锚点失效（源码已改）：${mut.name}`);
    process.exit(1);
  }
  let mutated = source.replace(mut.from, mut.to);
  if (mut.from2) mutated = mutated.replace(mut.from2, mut.to2);
  const mod = await import(`data:text/javascript;base64,${Buffer.from(mutated).toString("base64")}`);
  const got = (await mut.run(mod)) === true;
  const flipped = got === mut.mutated && mut.mutated !== mut.correct;
  if (flipped) caught += 1;
  console.log(`${flipped ? "✓" : "✗"} ${mut.name} → 突变后给 ${got}（真实应为 ${mut.correct}）`);
}

console.log(`\n${caught}/${MUTATIONS.length} 条突变被抓到`);
process.exit(caught === MUTATIONS.length ? 0 : 1);
