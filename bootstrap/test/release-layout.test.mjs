// 发行包布局的产物级测试（对抗性审查第二轮的第一条：zip 平铺 + sync 找不到仓库 presets/
// 会把 payload 里的预设当"多余副本"删掉，还自证为绿）。
//
// 覆盖：
//   1. 打包后的 zip 里同时有 bootstrap/ 与 presets/；
//   2. 解包后在 bootstrap/ 里跑 sync-presets --check 通过，且没有删掉任何 payload 预设；
//   3. 模拟旧版平铺布局（缺仓库 presets/）时，sync-presets 必须拒绝执行（退出码 2），
//      并且 payload 原样保留。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bootstrapDir = path.dirname(here);
const repoRoot = path.dirname(bootstrapDir);
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "purge-zip-"));

/** 最小解包器：读 EOCD → 中央目录 → 各本地条目，stored/deflate 都支持。 */
function unzipTo(buffer, dest) {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, "zip 里没有 EOCD");
  const count = buffer.readUInt16LE(eocd + 10);
  let at = buffer.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i += 1) {
    assert.equal(buffer.readUInt32LE(at), 0x02014b50, "中央目录签名");
    const csize = buffer.readUInt32LE(at + 20);
    const nlen = buffer.readUInt16LE(at + 28);
    const elen = buffer.readUInt16LE(at + 30);
    const clen = buffer.readUInt16LE(at + 32);
    const localOffset = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nlen).toString("utf8");
    at += 46 + nlen + elen + clen;

    const localNlen = buffer.readUInt16LE(localOffset + 26);
    const localElen = buffer.readUInt16LE(localOffset + 28);
    const method = buffer.readUInt16LE(localOffset + 8);
    const dataAt = localOffset + 30 + localNlen + localElen;
    const raw = buffer.subarray(dataAt, dataAt + csize);
    const body = method === 8 ? zlib.inflateRawSync(raw) : raw;
    const target = path.join(dest, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
    names.push(name);
  }
  return names;
}

const zipPath = path.join(tmpRoot, "custom.zip");
execFileSync(process.execPath, [path.join(bootstrapDir, "pack-custom.mjs"), "--out", zipPath], {
  cwd: repoRoot,
  stdio: "ignore",
});
const names = unzipTo(fs.readFileSync(zipPath), path.join(tmpRoot, "unpacked"));

test("发行包同时保留 bootstrap/ 与 presets/（不平铺）", () => {
  assert.ok(names.includes("bootstrap/install-layers.ps1"), "缺 bootstrap/install-layers.ps1");
  assert.ok(names.includes("bootstrap/sync-presets.mjs"), "缺 bootstrap/sync-presets.mjs");
  assert.ok(names.includes("presets/unrestricted/agent.cordis.yml"), "缺仓库 presets/unrestricted");
  assert.ok(names.includes("presets/redteam/agent.cordis.yml"), "缺仓库 presets/redteam");
  assert.ok(!names.some((n) => n.startsWith("install-layers.ps1")), "不该再平铺到根");
});

test("解包后跑 sync-presets --check 通过，且不删 payload 预设", () => {
  const unpacked = path.join(tmpRoot, "unpacked");
  const bs = path.join(unpacked, "bootstrap");
  const before = fs
    .readdirSync(path.join(bs, "payload", "presets"))
    .sort()
    .join(",");
  const out = execFileSync(process.execPath, [path.join(bs, "sync-presets.mjs"), "--check"], {
    cwd: bs,
    encoding: "utf8",
  });
  assert.match(out, /预设副本一致/);
  const after = fs
    .readdirSync(path.join(bs, "payload", "presets"))
    .sort()
    .join(",");
  assert.equal(after, before, "sync --check 不应改动 payload");
  for (const name of ["unrestricted", "redteam", "liangshen"]) {
    assert.ok(fs.existsSync(path.join(bs, "payload", "presets", name)), `payload 预设 ${name} 被删了`);
  }
});

test("退回平铺布局（缺仓库 presets/）时 sync-presets 拒绝执行，payload 原样", () => {
  const flat = path.join(tmpRoot, "flat");
  const unpacked = path.join(tmpRoot, "unpacked");
  fs.cpSync(path.join(unpacked, "bootstrap"), flat, { recursive: true });
  const presetsInFlatPayload = fs
    .readdirSync(path.join(flat, "payload", "presets"))
    .sort()
    .join(",");
  let code = 0;
  let stderr = "";
  try {
    execFileSync(process.execPath, [path.join(flat, "sync-presets.mjs")], { cwd: flat, encoding: "utf8" });
  } catch (e) {
    code = e.status ?? 1;
    stderr = String(e.stderr || "");
  }
  assert.equal(code, 2, `应为退出码 2（拒绝），实际 ${code}`);
  assert.match(stderr, /缺少 presets/);
  assert.equal(
    fs.readdirSync(path.join(flat, "payload", "presets")).sort().join(","),
    presetsInFlatPayload,
    "拒绝执行时 payload 必须原样",
  );
});
