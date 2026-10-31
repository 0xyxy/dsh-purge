#!/usr/bin/env node
/**
 * 把仓库 `presets/` 同步到 `bootstrap/payload/presets/`（单向、幂等、会删多余副本）。
 *
 * 为什么要有：payload 里的预设是"安装时铺到 $DSH_HOME/.agent-presets 的副本"，一旦人工
 * 维护就会漂移——实际上已经漂移过一次（unrestricted 停在 includeDefaultRoots:false，
 * 上游改成 true 之后没人同步，装出来的是旧的）。
 *
 * 规则：
 *   - 仓库 presets/ 是唯一事实源；
 *   - `SHARED` 里的预设整目录覆盖到 payload，并删除 payload 里多余的副本文件；
 *   - `payloadOnly`（liangshen）只在 payload 里，同步时不删不覆盖。
 *
 * 用法：
 *   node bootstrap/sync-presets.mjs          # 写入
 *   node bootstrap/sync-presets.mjs --check  # 只比对，退出码 1 表示有漂移
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { presetSync } from "./lib/layers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const repoDir = path.join(root, "presets");
const payloadDir = path.join(here, "payload", "presets");

const SHARED = ["unrestricted", "redteam"];
const PAYLOAD_ONLY = ["liangshen/"];
const checkOnly = process.argv.includes("--check");

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
const manifestOf = (base, prefixes) => {
  const out = {};
  for (const prefix of prefixes) {
    for (const f of listFiles(path.join(base, prefix))) {
      const buf = fs.readFileSync(path.join(base, prefix, f));
      out[`${prefix}/${f}`] = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
    }
  }
  return out;
};

// 仓库副本必须完整：缺一个目录就停，别把"空集合"当成"没有漂移"（那会反过来删掉 payload 里的预设）。
const missingRepoDirs = SHARED.filter((n) => !fs.existsSync(path.join(repoDir, n)));
if (missingRepoDirs.length) {
  console.error(
    `✗ 仓库根缺少 presets/{${missingRepoDirs.join(",")}}（当前仓库根：${root}）\n` +
      "  如果你是在发行包里运行，请在解出的目录根执行（zip 内保留了 presets/）；不要让它自己删 payload。",
  );
  process.exit(2);
}
const repoPrefixes = SHARED.slice();
const payloadPrefixes = SHARED.concat(PAYLOAD_ONLY.map((p) => p.replace(/\/$/, ""))).filter((n) =>
  fs.existsSync(path.join(payloadDir, n)),
);
const repoManifest = manifestOf(repoDir, repoPrefixes);
const payloadManifest = manifestOf(payloadDir, payloadPrefixes);
const verdict = presetSync({ repoManifest, payloadManifest, payloadOnly: PAYLOAD_ONLY });

if (checkOnly) {
  if (verdict.state !== "PASS") {
    console.error(`✗ 预设副本已漂移：${verdict.detail}`);
    process.exit(1);
  }
  console.log(`✓ 预设副本一致（${Object.keys(repoManifest).length} 个文件）`);
  process.exit(0);
}

// 复制：仓库有的都覆盖过去
let copied = 0;
for (const [rel, hash] of Object.entries(repoManifest)) {
  const src = path.join(repoDir, rel);
  const dst = path.join(payloadDir, rel);
  const same = payloadManifest[rel] === hash;
  if (same) continue;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  copied += 1;
  console.log(`  → ${rel}`);
}

// 删除：payload 里在 SHARED 下、但仓库没有的副本（仓库副本完整时才会走到这里）
let removed = 0;
for (const rel of Object.keys(payloadManifest)) {
  if (!SHARED.some((n) => rel.startsWith(`${n}/`))) continue;
  if (rel in repoManifest) continue;
  fs.rmSync(path.join(payloadDir, rel), { force: true });
  removed += 1;
  console.log(`  ✗ 删除多余副本 ${rel}`);
}

const after = presetSync({
  repoManifest,
  payloadManifest: manifestOf(payloadDir, payloadPrefixes),
  payloadOnly: PAYLOAD_ONLY,
});
if (after.state !== "PASS") {
  console.error(`✗ 同步后仍不一致：${after.detail}`);
  process.exit(1);
}
console.log(
  copied || removed
    ? `✓ 已同步：复制 ${copied} 个、删除 ${removed} 个（仓库 presets/ → bootstrap/payload/presets/）`
    : "✓ 已是最新，无需同步",
);
for (const name of PAYLOAD_ONLY) console.log(`  · ${name} 由 bootstrap 自己维护，不参与同步`);
