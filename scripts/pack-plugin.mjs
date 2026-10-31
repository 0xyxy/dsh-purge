#!/usr/bin/env node
/**
 * 用 git 对象库打包 npm 兼容的 tgz（替代 `npm pack` / `pnpm pack`）。
 *
 * 为什么需要：工作树里可能有个别文件被系统安全软件隔离/占用（本机实测
 * `skills/redteam/unauth-exploit.md` 被 Defender 删掉，`get-Item` 不存在但
 * `git cat-file` 还能读出 8298 字节）。此时 `pnpm pack` 直接 ENOENT 失败。
 * `git archive` 从对象库取内容，既绕开被隔离的工作树文件，又保证产物只由提交决定。
 *
 * 产物布局与 npm pack 一致：`package/**` + `package/package.json`，gzip 头固定（可复现）。
 *
 * 用法：
 *   node scripts/pack-plugin.mjs                 # → dist/dsh-purge-community-<version>.tgz
 *   node scripts/pack-plugin.mjs --out x.tgz
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const argv = process.argv.slice(2);
const outArg = argv.indexOf("--out");

/** 找 git：PATH 里没有时（本机 DSH 运行时就没有）退到常见安装位置。 */
function resolveGit() {
  const cands = [
    process.env.PURGE_GIT,
    "C:/Program Files/Git/cmd/git.exe",
    "C:/Program Files (x86)/Git/cmd/git.exe",
    "C:/Program Files/Git/bin/git.exe",
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  try {
    const out = execFileSync(process.platform === "win32" ? "where.exe" : "which", ["git"], { encoding: "utf8" });
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && fs.existsSync(first)) return first;
  } catch {}
  return "git";
}
const GIT = resolveGit();

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const out = outArg >= 0 && argv[outArg + 1] ? path.resolve(argv[outArg + 1]) : path.join(root, "dist", `${pkg.name}-${version}.tgz`);

// `files` 里带 "!..." 的排除项（如 !lib/default-prompt-inject.md）在 git archive 里不适用：
// 该文件本来就没被提交（.gitignore 里有），所以只要把正向条目交给 git 即可。
const entries = (pkg.files || []).filter((f) => !f.startsWith("!"));
// npm pack 总会带上这些
for (const always of ["package.json", "README.md", "LICENSE"]) {
  if (!entries.includes(always) && fs.existsSync(path.join(root, always))) entries.push(always);
}
const missing = entries.filter((e) => !fs.existsSync(path.join(root, e)) && !existsInGit(e));
function existsInGit(entry) {
  // 工作树缺文件（例如被安全软件隔离）时，只要 git 里有就算数
  try {
    execFileSync(GIT, ["-C", root, "cat-file", "-e", `HEAD:${entry}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const reallyMissing = missing.filter((e) => !existsInGit(e));
if (reallyMissing.length) {
  console.error(`[pack-plugin] 这些路径既不在工作树也不在 HEAD：${reallyMissing.join(", ")}`);
  process.exit(1);
}

const tarPath = path.join(path.dirname(out), `_pack-${Date.now()}.tar`);
fs.mkdirSync(path.dirname(out), { recursive: true });
const trackedArgs = ["archive", "--format=tar", "--prefix=package/", "-o", tarPath, "HEAD", ...entries];
const stderr = [];
try {
  execFileSync(GIT, ["-C", root, ...trackedArgs], { stdio: ["ignore", "ignore", "pipe"] });
} catch (e) {
  console.error(`[pack-plugin] git archive 失败：${String(e.stderr || e.message).trim()}`);
  process.exit(1);
}

const tar = fs.readFileSync(tarPath);
fs.rmSync(tarPath, { force: true });
// 固定 mtime，做到同内容 → 同字节（CI 里能对比哈希）
const gz = zlib.gzipSync(tar, { level: 9 });
const patched = Buffer.from(gz);
patched.writeUInt32LE(0, 4); // gzip MTIME = 0（deterministic）
fs.writeFileSync(out, patched);

const size = fs.statSync(out).size;
console.log(`✓ ${out}（${(size / 1024).toFixed(1)} KB，来自 HEAD ${headShort()}）`);

function headShort() {
  try {
    return execFileSync(GIT, ["-C", root, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "?";
  }
}
