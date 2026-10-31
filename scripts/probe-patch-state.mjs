// 一次性探针：用当前 core.js 的补丁表核对真实宿主，输出状态分布与漂移。
// 用法：node scripts/probe-patch-state.mjs "<...>\node_modules\@deepseek-ai"
const AI = process.argv[2];
if (!AI) {
  console.error("用法：node scripts/probe-patch-state.mjs <aiBase>");
  process.exit(1);
}
const m = await import("../lib/core.js");
const st = await m.patchStatus(AI);
const hist = {};
for (const [, s] of Object.entries(st)) hist[s] = (hist[s] || 0) + 1;
console.log("total patches:", m.ALL_PATCHES.length, "statusEntries:", Object.keys(st).length);
console.log("optIn:", m.ALL_PATCHES.filter((p) => p.disabledByDefault).map((p) => p.id).join(","));
console.log("histogram:", JSON.stringify(hist));
const d = await m.patchDrift(AI);
console.log(
  "drift:",
  JSON.stringify({
    checked: d.checked,
    drifted: (d.drifted || []).map((x) => (x && x.id) || x),
    partial: (d.partial_drift || []).length,
    missing:
      (d.missing_file || []).map((x) => (x && x.id) || x).length || (d.missing || []).length,
  }),
);
const notApplied = Object.entries(st).filter(
  ([, s]) => !["applied", "already", "disabled", "na", "skipped"].includes(s),
);
console.log(
  "needs attention (id:status):",
  notApplied.map(([i, s]) => `${i}:${s}`).join(" ") || "(none)",
);
