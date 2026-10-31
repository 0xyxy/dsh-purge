#!/usr/bin/env node
/**
 * 打出 release 资产 `dsh-unleashed-custom.zip`（可复现，不手工 zip、不依赖外部命令）。
 *
 * 内容 = 换机自装所需的一切：
 *   install-layers.ps1 / verify-layers.mjs / sync-presets.mjs / pack-custom.mjs
 *   lib/ / payload/ / THREE-LAYERS.md / README.md
 *
 * 用法：
 *   node bootstrap/pack-custom.mjs                 # → dist/dsh-unleashed-custom.zip
 *   node bootstrap/pack-custom.mjs --out x.zip
 *
 * 为什么不用 Compress-Archive：在受限宿主里起子进程会失败（CreateProcess 拒绝访问），
 * 而打包本身只需要 CRC32 + deflate，Node 自带 zlib 就够，顺便做到字节可复现。
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const argv = process.argv.slice(2);
const outArg = argv.indexOf("--out");
const out =
  outArg >= 0 && argv[outArg + 1]
    ? path.resolve(argv[outArg + 1])
    : path.join(root, "dist", "dsh-unleashed-custom.zip");

// zip 内必须保留两条路径：bootstrap/（脚本本体）与 presets/（仓库副本）。
// 平铺到根会让解包后的 sync-presets 找不到仓库 presets/，进而把 payload 里的预设当"多余副本"删掉。
const ENTRIES = [
  { from: ".", to: "bootstrap", names: ["install-layers.ps1", "verify-layers.mjs", "sync-presets.mjs", "pack-custom.mjs", "THREE-LAYERS.md", "README.md", "lib", "payload"] },
  { from: "..", to: "presets", names: ["presets/unrestricted", "presets/redteam"] },
];

// ── CRC32 ───────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();
function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

// ── 收集文件 ─────────────────────────────────────────────────────────────────
function collect(src, rel, acc) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    for (const e of fs.readdirSync(src, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      collect(path.join(src, e.name), `${rel}/${e.name}`, acc);
    }
  } else {
    acc.push({ name: rel, data: fs.readFileSync(src) });
  }
}

// ── 打包 ─────────────────────────────────────────────────────────────────────
function buildZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const compressed = zlib.deflateRawSync(f.data, { level: 9 });
    const useDeflate = compressed.length < f.data.length;
    const body = useDeflate ? compressed : f.data;
    const crc = crc32(f.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 flag
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date（固定，保证可复现）
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4); // version made by
    dir.writeUInt16LE(20, 6); // version needed
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(useDeflate ? 8 : 0, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(f.data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30); // extra
    dir.writeUInt16LE(0, 32); // comment
    dir.writeUInt16LE(0, 34); // disk
    dir.writeUInt16LE(0, 36); // internal attrs
    dir.writeUInt32LE(0, 38); // external attrs
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, end]);
}

// 先同步预设：确保 zip 里的 payload 就是仓库 presets/ 这份
try {
  execFileSync(process.execPath, [path.join(here, "sync-presets.mjs")], { stdio: "inherit" });
} catch {
  console.error("[pack] 预设同步失败，停止打包");
  process.exit(1);
}

const files = [];
for (const group of ENTRIES) {
  for (const name of group.names) {
    const src = path.join(here, group.from, name);
    if (!fs.existsSync(src)) {
      console.error(`[pack] 缺少 ${name}（在 ${path.join(here, group.from)} 下）`);
      process.exit(1);
    }
    const base = path.basename(name);
    collect(src, `${group.to}/${base}`, files);
  }
}
// 经典 ZIP 的上限：文件数 < 65535，单文件/偏移 < 4GiB。超了就明确拒绝，别产出坏包。
if (files.length >= 0xffff) {
  console.error(`[pack] 文件数 ${files.length} 超过经典 ZIP 上限`);
  process.exit(1);
}
let running = 0;
for (const f of files) {
  if (f.data.length > 0xffffffff) {
    console.error(`[pack] ${f.name} 超过 4GiB`);
    process.exit(1);
  }
  running += f.data.length + f.name.length + 76;
}
if (running > 0xffffffff) {
  console.error("[pack] 总体积超过经典 ZIP 上限");
  process.exit(1);
}

/**
 * 独立回读校验：用与 writer 不同的一段代码解析 EOCD + 中央目录，
 * 逐条比对名字、CRC、压缩前后大小。自己写自己读，至少能挡住"写完就是坏包"。
 */
function verifyZip(buffer) {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return { ok: false, reason: "找不到 EOCD" };
  const count = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (cdOffset + cdSize > buffer.length) return { ok: false, reason: "中央目录越界" };
  const entries = [];
  let at = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) return { ok: false, reason: `第 ${i} 条中央目录签名错` };
    const crc = buffer.readUInt32LE(at + 16);
    const csize = buffer.readUInt32LE(at + 20);
    const usize = buffer.readUInt32LE(at + 24);
    const nlen = buffer.readUInt16LE(at + 28);
    const elen = buffer.readUInt16LE(at + 30);
    const clen = buffer.readUInt16LE(at + 32);
    const name = buffer.subarray(at + 46, at + 46 + nlen).toString("utf8");
    const localOffset = buffer.readUInt32LE(at + 42);
    entries.push({ name, crc, csize, usize, localOffset });
    at += 46 + nlen + elen + clen;
  }
  for (const e of entries) {
    if (buffer.readUInt32LE(e.localOffset) !== 0x04034b50) return { ok: false, reason: `${e.name} 本地头签名错` };
    const nlen = buffer.readUInt16LE(e.localOffset + 26);
    const dataAt = e.localOffset + 30 + nlen + buffer.readUInt16LE(e.localOffset + 28);
    const raw = buffer.subarray(dataAt, dataAt + e.csize);
    const body = buffer.readUInt16LE(e.localOffset + 8) === 8 ? zlib.inflateRawSync(raw) : raw;
    if (body.length !== e.usize) return { ok: false, reason: `${e.name} 解压长度不符` };
    if (crc32(body) !== e.crc) return { ok: false, reason: `${e.name} CRC 不符` };
  }
  return { ok: true, entries };
}

// 发行清单：让解压后的安装器知道"我来自哪个仓库、哪个 tag、该装哪个版本、两个资产各是什么哈希"。
// 没有它，ZIP 里的脚本默认仓库与发布仓库不一致时，就会出现"定制层来自 A、插件层来自 B"。
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const tgzPath = path.join(path.dirname(out), `${pkg.name}-${pkg.version}.tgz`);
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const manifest = {
  repo: process.env.PURGE_RELEASE_REPO || "0xyxy/dsh-purge",
  tag: process.env.PURGE_RELEASE_TAG || `v${pkg.version}`,
  version: pkg.version,
  assets: {
    plugin: `${pkg.name}-${pkg.version}.tgz`,
    custom: path.basename(out),
  },
  sha256: {},
};
if (fs.existsSync(tgzPath)) manifest.sha256.plugin = sha256(fs.readFileSync(tgzPath));
manifest.sha256.custom_pending = "(构建后自校验，见 SHA256SUMS.txt)";
files.push({ name: "release-manifest.json", data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8") });
// 再算一次清单文件本身的哈希说明（自引用做不到，写进输出日志即可）
console.log(`  · manifest: ${manifest.repo} ${manifest.tag} v${manifest.version}${manifest.sha256.plugin ? ` plugin.sha256=${manifest.sha256.plugin.slice(0, 16)}…` : ""}`);

fs.mkdirSync(path.dirname(out), { recursive: true });
const zip = buildZip(files);
fs.writeFileSync(out, zip);
const check = verifyZip(fs.readFileSync(out));
if (!check.ok) {
  console.error(`[pack] 回读校验失败：${check.reason}`);
  process.exit(1);
}
if (check.entries.length !== files.length) {
  console.error(`[pack] 回读条数不符：${check.entries.length} vs ${files.length}`);
  process.exit(1);
}
console.log(`✓ ${out}（${files.length} 个文件 / ${(zip.length / 1024).toFixed(1)} KB，回读校验通过）`);
