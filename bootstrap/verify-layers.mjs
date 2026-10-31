#!/usr/bin/env node
/**
 * 三层破甲验证：提示词层 / 代码层 / 引擎层
 *
 * 判据在 bootstrap/lib/layers.mjs（纯函数 + 单测 + 变异测试）；本文件只负责读文件、汇总、输出。
 *
 * 状态与退出码（不再用单一 boolean：首次安装"还没应用"和"补丁漂移"不是一回事）：
 *   PASS / N_A            → 0
 *   WAITING               → 2（换包/重启未完成，可重试）
 *   ACTION_REQUIRED       → 2（需要用户点一次「应用」或重开）
 *   BROKEN                → 1（必须停下排查）
 *
 * 用法：
 *   node verify-layers.mjs                 # 自动定位宿主与 DSH_HOME
 *   node verify-layers.mjs --exe "C:\\...\\DeepSeek Harness.exe"
 *   node verify-layers.mjs --json
 */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  injectEnvelope,
  presetSync,
  patchAccounting,
  guardMarkers,
  anchorUniqueness,
  layerSummary,
  LAYERS,
} from "./lib/layers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(here);
const argv = process.argv.slice(2);
const arg = (n, d = "") => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const asJson = argv.includes("--json");

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");

function findExe() {
  const explicit = arg("--exe", process.env.DSH_EXE || "");
  if (explicit && fs.existsSync(explicit)) return path.normalize(explicit);
  const names = ["DeepSeek Harness.exe", "dsh desktop.exe", "DeepseekHarnessDesktop.exe"];
  const roots = [
    path.join(process.env.LOCALAPPDATA || "", "Programs"),
    process.env.ProgramFiles || "",
    process.env["ProgramFiles(x86)"] || "",
  ].filter(Boolean);
  for (const root of roots) {
    let dirs = [];
    try {
      dirs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      continue;
    }
    for (const d of dirs) for (const n of names) {
      const p = path.join(root, d, n);
      if (fs.existsSync(p)) return path.normalize(p);
    }
  }
  return "";
}

const exe = findExe();
if (!exe) {
  console.error("[verify] 找不到 DeepSeek Harness.exe，用 --exe 指定");
  process.exit(1);
}
const resources = path.join(path.dirname(exe), "resources");
const appDir = path.join(resources, "app");
const AI = path.join(appDir, "dsh", "node_modules", "@deepseek-ai");
const read = (p) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
};
const has = (text, needle) => Boolean(text) && text.includes(needle);

const rows = [];
function check(layer, id, name, verdict) {
  rows.push({
    layer,
    id,
    name,
    state: verdict.state,
    ok: verdict.state === "PASS" || verdict.state === "N_A",
    detail: verdict.detail || "",
    fix: verdict.fix || "",
  });
}
/** 旧式字符串判据 → 状态判据。 */
const boolVerdict = (ok, detail, fix) => ({ state: ok ? "PASS" : "BROKEN", detail, fix });

// ───────────────────────── 提示词层 ─────────────────────────
const injectPath = path.join(DSH_HOME, "prompt-inject.md");
const inject = read(injectPath);
check(
  "提示词",
  "P1",
  "prompt-inject.md 存在且完整",
  boolVerdict(inject.length > 20000, `${inject.length} 字符 / ${inject.split("\n").length} 行`, "从 dsh-unleashed-custom.zip 取 prompt-inject.md 放到 DSH_HOME"),
);

// P6：信封体检（吸收上游 #107）。单边标签会把后面的官方段吞掉。
check("提示词", "P6", "注入信封成对（ChatML / project）", injectEnvelope(inject));

const neverSrc = read(path.join(AI, "dsh-user-approval", "lib", "index.js"));
check(
  "提示词",
  "P2",
  "审批文案已改为 auto-granted",
  boolVerdict(
    has(neverSrc, "Approval requests are auto-granted"),
    has(neverSrc, "Approval requests are auto-granted")
      ? "NEVER_SENTENCE 命中"
      : `仍含旧文案: ${has(neverSrc, "rejected automatically") ? "rejected automatically" : "未知"}`,
    "重跑 run-purge.mjs（对应补丁 #5/#11/#12）",
  ),
);

const baseYml = read(path.join(AI, "dsh-base", "cordis.patch.yml"));
check(
  "提示词",
  "P3",
  "plan-mode 软阻断已移除",
  boolVerdict(has(baseYml, "[dsh-purge] plan-mode soft block removed"), has(baseYml, "[dsh-purge] plan-mode soft block removed") ? "marker 命中" : "marker 缺失", "重跑 run-purge.mjs（补丁 #63/#55）"),
);

const presetUnPath = path.join(DSH_HOME, ".agent-presets", "unrestricted", "agent.cordis.yml");
const presetLsPath = path.join(DSH_HOME, ".agent-presets", "liangshen", "agent.cordis.yml");
const presetUn = read(presetUnPath);
const presetLs = read(presetLsPath);
const OFFICIAL_IDENTITY = "You are a helpful software engineer assistant.";
check(
  "提示词",
  "P4",
  "预设已去官方身份句",
  boolVerdict(presetUn ? !has(presetUn, OFFICIAL_IDENTITY) : false, presetUn ? (has(presetUn, OFFICIAL_IDENTITY) ? "unrestricted 仍含官方身份句" : `unrestricted ${presetUn.length}B`) : "unrestricted 预设不存在", "从 dsh-unleashed-custom.zip 铺 presets/"),
);
const LIANGSHEN_MARKER = "[dsh-purge] liangshen identity line removed";
check(
  "提示词",
  "P5",
  "梁神模式已落地并被 #71 洗过",
  boolVerdict(presetLs ? has(presetLs, LIANGSHEN_MARKER) : false, presetLs ? (has(presetLs, LIANGSHEN_MARKER) ? "marker 命中" : "marker 缺失") : "liangshen 预设不存在", "铺 presets/liangshen 后重跑 apply（补丁 #71）"),
);

// P7：payload 预设副本与仓库 presets/ 哈希一致（防"仓库修好了、装出来的还是旧的"）
const listFiles = (dir) => {
  const out = [];
  (function walk(d, rel) {
    let ents = [];
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), relPath);
      else out.push(relPath);
    }
  })(dir, "");
  return out;
};
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 16);
const manifestOf = (base, prefixes) => {
  const out = {};
  for (const prefix of prefixes) {
    for (const f of listFiles(path.join(base, prefix))) out[`${prefix}/${f}`] = sha(path.join(base, prefix, f));
  }
  return out;
};
const SHARED_PRESETS = ["unrestricted", "redteam"];
const PAYLOAD_ONLY_PRESETS = ["liangshen/"];
const repoPresets = SHARED_PRESETS.filter((n) => fs.existsSync(path.join(repoRoot, "presets", n)));
const missingShared = SHARED_PRESETS.filter((n) => !repoPresets.includes(n));
const p7 = missingShared.length
  ? {
      state: "BROKEN",
      detail: `仓库根缺少 presets/：${missingShared.join(", ")}（发行包解压后可能没有仓库副本）`,
      fix: "在仓库根运行；或从 dsh-unleashed-custom.zip 解出的目录里运行（zip 内已含 presets/）",
    }
  : presetSync({
    repoManifest: manifestOf(path.join(repoRoot, "presets"), repoPresets),
    payloadManifest: manifestOf(path.join(here, "payload", "presets"), SHARED_PRESETS.concat(PAYLOAD_ONLY_PRESETS.map((p) => p.replace(/\/$/, "")))),
      payloadOnly: PAYLOAD_ONLY_PRESETS,
    });
check("提示词", "P7", "payload 预设副本未漂移（路径集合 + 哈希）", p7);

// ───────────────────────── 代码层 ─────────────────────────
check("代码", "C1", "审批 schema 默认 never", boolVerdict(has(neverSrc, '.default("never")'), has(neverSrc, '.default("never")') ? "zod default 命中" : has(neverSrc, '.default("ask")') ? "仍是 ask" : "未识别", "重跑 run-purge.mjs（补丁 #8/#10）"));

const fsSandbox = read(path.join(AI, "dsh-fs-sandbox", "lib", "index.js"));
check("代码", "C2", "文件围栏已拆", boolVerdict(fsSandbox.length > 0 && !has(fsSandbox, "denyEveryMutation"), fsSandbox ? "fs-sandbox 已加载（围栏判定放行由 mode 决定）" : "文件缺失", "重跑 run-purge.mjs（补丁 #16）"));

const escalation = read(path.join(AI, "dsh-sandbox", "lib", "index.js"));
check("代码", "C3", "升级目标含 danger-full-access", boolVerdict(has(escalation, "ESCALATION_TARGETS") && has(escalation, "danger-full-access"), has(escalation, "danger-full-access") ? "ESCALATION_TARGETS 命中" : "未命中", "重跑 run-purge.mjs（补丁 #14/#15）"));

const pluginLib = path.join(DSH_HOME, "profiles", "desktop", "node_modules", "dsh-purge-community", "lib", "core.js");
let core = null;
if (fs.existsSync(pluginLib)) {
  try {
    core = await import(pathToFileURL(pluginLib).href);
  } catch {
    core = null;
  }
}

// C4：查 #67 / #68 的具体 marker（不再数通用 [dsh-purge]，也不再靠 60KB 体量阈值）
const loopSrc = read(path.join(AI, "dsh-agent-loop", "lib", "index.js"));
// 逐 ID 兜底：旧/残缺补丁表里可能缺某一条，不能因为另一条取到 marker 就整体跳过兜底。
const GUARD_FALLBACK = {
  67: "[dsh-purge] guard undefined messages",
  68: "[dsh-purge] guard undefined content",
};
const guardWanted = Object.entries(GUARD_FALLBACK).map(
  ([id, fallback]) => core?.ALL_PATCHES?.find((p) => p.id === Number(id))?.markers?.[0] ?? fallback,
);
check("代码", "C4", "agent-loop 守卫补丁在位（#67/#68 marker）", guardMarkers({ src: loopSrc, markers: guardWanted }));

const bakCount = (() => {
  let n = 0;
  (function walk(d, depth) {
    if (depth > 6) return;
    let ents = [];
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f, depth + 1);
      else if (e.name.endsWith(".dshpurge.bak")) n += 1;
    }
  })(AI, 0);
  return n;
})();
check("代码", "C5", "逐文件原始备份存在（可细粒度回滚）", boolVerdict(bakCount > 0, `${bakCount} 个 .dshpurge.bak`, "run-purge.mjs 会从 app.asar.bak 自动生成"));

// C6：补丁表全量核对。#71 的豁免必须带现场算出来的 proof，不再有裸 id 白名单。
let accounting = { state: "BROKEN", detail: `未找到插件：${pluginLib}`, fix: "先装 dsh-purge-community 再复验" };
let statusById = null;
let activeIds = new Set();
let drift = null;
if (core) {
  try {
    statusById = await core.patchStatus(AI);
    drift = typeof core.patchDrift === "function" ? await core.patchDrift(AI) : null;
    // 哪些补丁"目标文件真实存在"：optional 补丁只在目标不在场时才允许算不适用。
    const targetMap = core.targetFiles(AI);
    activeIds = new Set();
    for (const p of core.ALL_PATCHES) {
      const keys = [].concat(p.file ?? []);
      const exists = keys.some((k) => [].concat(targetMap[k] ?? []).some((f) => typeof f === "string" && fs.existsSync(f)));
      if (exists) activeIds.add(p.id);
    }
    const liangshenProof = Boolean(presetLs) && !has(presetLs, OFFICIAL_IDENTITY) && has(presetLs, LIANGSHEN_MARKER);
    accounting = patchAccounting({
      patches: core.ALL_PATCHES,
      statusById,
      drift,
      activeIds,
      readyFn: typeof core.patchStatusReady === "function" ? core.patchStatusReady : null,
      exempt: {
        71: { reason: "liangshen 预设存在、官方身份句已消失、#71 marker 在位", proof: liangshenProof },
      },
    });
  } catch (e) {
    accounting = { state: "BROKEN", detail: `补丁表核对失败：${e.message}`, fix: "确认插件版本与宿主解包状态" };
  }
}
check("代码", "C6", "补丁表全量核对（漂移/部分命中/待应用）", accounting);

// C7：待打补丁的锚点必须"找得到"（0 次=写法变了；>1 次=会多改一处）
let anchors = { state: "N_A", detail: "跳过（未取到补丁表）" };
if (core && statusById) {
  try {
    const files = core.targetFiles(AI);
    const samples = [];
    // 需要看锚点的状态：还没打（pending）、证据不足（unknown）、漂了（drifted/unmatched）。
    // 已 applied 的补丁锚点本来就被替换掉了，看它没有意义。
    const WATCH = new Set(["pending", "unknown", "drifted", "unmatched", "partial", "unreadable"]);
    for (const p of core.ALL_PATCHES) {
      if (!WATCH.has(statusById[p.id])) continue;
      const keys = [].concat(p.file ?? []);
      const hits = [];
      for (const key of keys) {
        const paths = [].concat(files[key] ?? []).filter((x) => typeof x === "string");
        for (const filePath of paths) {
          const src = read(filePath);
          if (!src) continue;
          for (const r of p.replacements ?? []) {
            if (typeof r.pattern === "string") {
              hits.push({ pattern: r.pattern.slice(0, 40), count: src.split(r.pattern).length - 1 });
            } else if (r.pattern instanceof RegExp) {
              // 正则锚点：克隆成全局正则再计数，别静默跳过（跳过等于这条没检查）
              const re = new RegExp(r.pattern.source, r.pattern.flags.includes("g") ? r.pattern.flags : `${r.pattern.flags}g`);
              hits.push({ pattern: `/${r.pattern.source.slice(0, 30)}/`, count: [...src.matchAll(re)].length });
            }
          }
        }
      }
      samples.push({ id: p.id, file: keys.join(","), hits });
    }
    anchors = anchorUniqueness({ samples });
  } catch (e) {
    // 检查本身出错不是"不适用"：判 BROKEN，别把异常吞成 N_A
    anchors = { state: "BROKEN", detail: `锚点检查失败：${e.message}`, fix: "跑 purge-community diagnose 看具体补丁" };
  }
}
check("代码", "C7", "待打补丁的锚点唯一（0 次=写法变，>1 次=会多改）", anchors);

// ───────────────────────── 引擎层 ─────────────────────────
check("引擎", "E1", "宿主已解包（resources/app 在用）", boolVerdict(fs.existsSync(path.join(appDir, "dsh", "node_modules")), fs.existsSync(appDir) ? "app 目录存在" : "app 目录不存在", "跑 run-purge.mjs 解包"));

const asarPath = path.join(resources, "app.asar");
const swapped = !fs.existsSync(asarPath) && fs.existsSync(`${asarPath}.bak`);
check("引擎", "E2", "归档已挪开（否则 Electron 仍读 asar）", boolVerdict(swapped, `asar=${fs.existsSync(asarPath)} bak=${fs.existsSync(`${asarPath}.bak`)}`, "swap-restart.ps1 会处理；被占用时关宿主后重跑"));

check("引擎", "E3", "沙箱默认 danger-full-access", boolVerdict(has(baseYml, "?? 'danger-full-access'"), has(baseYml, "?? 'danger-full-access'") ? "mode 默认命中" : has(baseYml, "?? 'workspace-write'") ? "仍是 workspace-write" : "未识别", "重跑 run-purge.mjs（补丁 #7）"));

check("引擎", "E4", "审批策略默认恒 never", boolVerdict(has(baseYml, "'danger-full-access') === 'danger-full-access' ? 'never' : 'ask'"), has(baseYml, "'danger-full-access') === 'danger-full-access' ? 'never'") ? "policy 表达式命中" : "未命中", "重跑 run-purge.mjs（补丁 #8）"));

const shimDir = path.join(resources, "runtime", "cli", "bin");
const dshCmd = read(path.join(shimDir, "dsh.cmd"));
check("引擎", "E5", "CLI 入口指向解包目录", boolVerdict(has(dshCmd, "app\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host"), dshCmd ? (has(dshCmd, "app\\dsh\\node_modules") ? "dsh.cmd 首顺位 = app" : "仍指向 app.asar") : "dsh.cmd 不存在", "run-purge.mjs 会重写 shim"));

const prefPath = path.join(DSH_HOME, "dsh-purge", "update-preferences.json");
let autoInstall = null;
try {
  autoInstall = JSON.parse(read(prefPath) || "{}").autoInstall;
} catch {}
check("引擎", "E6", "自动安装已关闭（防官方更新抹掉补丁）", boolVerdict(autoInstall === false, autoInstall === null ? "偏好文件缺失" : `autoInstall=${autoInstall}`, "run-purge.mjs 会写 autoInstall=false"));

// ───────────────────────── 输出 ─────────────────────────
const summary = layerSummary(rows);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        exe,
        dsh_home: DSH_HOME,
        state: summary.state,
        exit_code: summary.exitCode,
        patch_accounting: accounting,
        layers: summary.byLayer,
        ok: summary.exitCode === 0,
      },
      null,
      2,
    ),
  );
} else {
  console.log(`\n宿主：${exe}`);
  console.log(`DSH_HOME：${DSH_HOME}\n`);
  for (const l of LAYERS) {
    const st = summary.layerState(l);
    console.log(`── ${l}层 ${st} ──────────────────────────`);
    for (const r of summary.byLayer[l] || []) {
      const mark = r.state === "PASS" ? "✓" : r.state === "N_A" ? "·" : "✗";
      console.log(`  ${mark} ${r.id} ${r.name}  [${r.state}]`);
      console.log(`      ${r.detail}${r.state === "BROKEN" && r.fix ? `\n      fix: ${r.fix}` : ""}`);
    }
    console.log("");
  }
  console.log(`合计 ${summary.pass}/${summary.total} 项通过 · 整体 ${summary.state} · 退出码 ${summary.exitCode}`);
  if (summary.exitCode === 2) console.log("提示：ACTION_REQUIRED = 需要点一次「应用」并完整退出重开；WAITING = 换包/重启还没落地。");
}
process.exit(summary.exitCode);
