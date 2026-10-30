#!/usr/bin/env node
/**
 * dsh-purge 一键破甲（换机迁移用）
 *
 * 做什么：
 *   1. 定位 DeepSeek Harness 桌面安装与 dsh-purge-community 插件
 *   2. 解开 app.asar → resources/app（官方密封宿主）
 *   3. 对 @deepseek-ai 打全部补丁
 *   4. 注入 CLI shim（dsh.cmd / dsh.ps1 / dsh）
 *   5. 挪走 app.asar → app.asar.bak 并重启宿主
 *
 * 用法：
 *   node run-purge.mjs                 # 全流程，末尾自动重启宿主
 *   node run-purge.mjs --no-restart    # 只改文件，不重启
 *   node run-purge.mjs --exe "C:\\...\\DeepSeek Harness.exe"
 *   node run-purge.mjs --status        # 只看状态
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const arg = (name, def = '') => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(name);

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const PROFILE = path.join(DSH_HOME, 'profiles', 'desktop');
const PLUGIN = path.join(PROFILE, 'node_modules', 'dsh-purge-community', 'lib');

const log = (...a) => console.log('[purge]', ...a);
const die = (m) => { console.error('[purge][FATAL]', m); process.exit(1); };

// ── 定位 exe ────────────────────────────────────────────────────────────────
function findExe() {
  const explicit = arg('--exe', process.env.DSH_EXE || '');
  if (explicit) {
    if (!fs.existsSync(explicit)) die(`--exe 指向的文件不存在: ${explicit}`);
    return path.normalize(explicit);
  }
  const names = ['DeepSeek Harness.exe', 'dsh desktop.exe', 'DeepseekHarnessDesktop.exe'];
  const roots = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs'),
    process.env.ProgramFiles || '',
    process.env['ProgramFiles(x86)'] || '',
    path.join(os.homedir(), 'AppData', 'Local', 'Programs'),
  ].filter(Boolean);
  for (const root of roots) {
    for (const dir of safeReaddir(root)) {
      for (const n of names) {
        const p = path.join(root, dir, n);
        if (fs.existsSync(p)) return path.normalize(p);
      }
    }
  }
  die('找不到 DeepSeek Harness.exe；用 --exe 指定');
}
function safeReaddir(d) { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } }

if (!fs.existsSync(PLUGIN)) die(`未装 dsh-purge-community 插件: ${PLUGIN}\n先跑 setup-new-machine.ps1 的 install 阶段`);

const exe = findExe();
const resources = path.join(path.dirname(exe), 'resources');
const asar = path.join(resources, 'app.asar');
const appDir = path.join(resources, 'app');
log('exe =', exe);
log('resources =', resources);

process.env.DSH_SURFACE = process.env.DSH_SURFACE || 'desktop';
process.env.DSH_EXE = exe;

const core = await import('file:///' + PLUGIN.replace(/\\/g, '/') + '/core.js');
const desktop = await import('file:///' + PLUGIN.replace(/\\/g, '/') + '/desktop.js');
const extract = await import('file:///' + PLUGIN.replace(/\\/g, '/') + '/extract-asar.js');

// ── status ──────────────────────────────────────────────────────────────────
if (flag('--status')) {
  const st = await core.gatherState();
  log(`applied=${st.patches_applied}/${core.ALL_PATCHES.length} pending=${st.patches_pending} backup=${st.has_backup}`);
  log('app dir =', fs.existsSync(appDir), '| asar =', fs.existsSync(asar), '| asar.bak =', fs.existsSync(asar + '.bak'));
  const left = core.ALL_PATCHES.filter((p) => (st.patch_status[p.id] ?? '') !== 'applied');
  log('not applied =', JSON.stringify(left.map((p) => [p.id, p.name, st.patch_status[p.id]])));
  process.exit(0);
}

// ── 1. 解包 ─────────────────────────────────────────────────────────────────
let aiBase = path.join(appDir, 'dsh', 'node_modules', '@deepseek-ai');
if (!fs.existsSync(aiBase)) {
  if (!fs.existsSync(asar)) die(`既没有解包目录也没有 app.asar: ${resources}`);
  log('解包 app.asar → resources/app ...');
  const side = extract.extractAsarToSide(asar, appDir);          // 解到 app.dshpurge-next
  extract.overlayAsarUnpacked(asar, side.next);                   // 补原生模块
  const committed = extract.commitExtractedDir(appDir, side.next); // 换上新目录
  log('解包完成，prev =', committed.prev || '(none)');
  aiBase = path.join(appDir, 'dsh', 'node_modules', '@deepseek-ai');
  if (!fs.existsSync(aiBase)) die('解包后仍没有 @deepseek-ai');
}

// ── 2. 打补丁 ───────────────────────────────────────────────────────────────
log('applyPatches ...');
const report = await core.applyPatches(aiBase, core.ALL_PATCHES, { preserveClientBundles: false });
const tally = {};
for (const r of report) tally[r.status] = (tally[r.status] || 0) + 1;
log('tally =', JSON.stringify(tally));
const hard = report.filter((r) => !['applied', 'already', 'na', 'skipped'].includes(r.status));
for (const r of hard) log(`  !! #${r.patch_id} ${r.name} → ${r.status}`);
if (hard.length) log('提示：missing_file 多为该版本不存在 hooks/额外 preset，属无对象');

// ── 3. shim ─────────────────────────────────────────────────────────────────
const shimDir = path.join(resources, 'runtime', 'cli', 'bin');
if (fs.existsSync(shimDir)) {
  const cmd = path.join(shimDir, 'dsh.cmd');
  const entryApp = '%~dp0..\\..\\..\\app\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js';
  const entryAsar = '%~dp0..\\..\\..\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js';
  const entryUnp = '%~dp0..\\..\\..\\app.asar.unpacked\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js';
  const exeRel = '%~dp0..\\..\\..\\..\\' + path.basename(exe);
  const cmdText = [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    'set "ELECTRON_RUN_AS_NODE=1"',
    'REM dsh-purge cli entry begin',
    `set "entry=${entryApp}"`,
    `if not exist "%entry%" set "entry=${entryAsar}"`,
    `if not exist "%entry%" set "entry=${entryUnp}"`,
    'REM dsh-purge cli entry end',
    `"${exeRel}" --expose-internals "%entry%" %*`,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n');
  if (fs.existsSync(cmd)) fs.copyFileSync(cmd, cmd + '.pre-purge.bak');
  fs.writeFileSync(cmd, cmdText, 'ascii');

  const ps1 = path.join(shimDir, 'dsh.ps1');
  fs.writeFileSync(ps1, [
    '# dsh-purge shim begin',
    'if (-not $env:DSH_HOME) {',
    '  foreach ($rel in @((Join-Path $PSScriptRoot \'.dsh\'), (Join-Path $PSScriptRoot \'..\\.dsh\'), (Join-Path $PSScriptRoot \'..\\..\\.dsh\'))) {',
    '    $cand = [System.IO.Path]::GetFullPath($rel)',
    '    if (Test-Path -LiteralPath $cand) { $env:DSH_HOME = $cand; break }',
    '  }',
    '}',
    '# dsh-purge shim end',
    "$launcher = Join-Path $PSScriptRoot 'dsh.cmd'",
    '& $launcher @args',
    'if ($LASTEXITCODE) { exit $LASTEXITCODE }',
    '',
  ].join('\r\n'), 'utf8');
  log('shim 已写入', shimDir);
}

// ── 4. 逐文件原始备份（从归档提取，供 purge_revert 用）─────────────────────
if (fs.existsSync(asar)) {
  try { core.rememberUnpackedArchive?.(); } catch {}
  const asarForBak = fs.existsSync(asar) ? asar : asar + '.bak';
  if (fs.existsSync(asarForBak)) {
    const fd = fs.openSync(asarForBak, 'r');
    const pre = Buffer.alloc(16);
    fs.readSync(fd, pre, 0, 16, 0);
    const headerSize = pre.readUInt32LE(4), jsonSize = pre.readUInt32LE(12);
    const jb = Buffer.alloc(jsonSize);
    fs.readSync(fd, jb, 0, jsonSize, 16);
    const header = JSON.parse(jb.toString('utf8'));
    const dataOffset = 8 + headerSize;
    const index = new Map();
    (function walk(node, prefix) {
      const f = node && node.files;
      if (!f) return;
      for (const [n, info] of Object.entries(f)) {
        const rel = prefix ? `${prefix}/${n}` : n;
        if (info && info.files) walk(info, rel);
        else if (info) index.set(rel, info);
      }
    })(header, '');
    const targets = [...new Set(Object.values(core.targetFiles(aiBase)).filter((v) => typeof v === 'string'))];
    let made = 0;
    for (const fp of targets) {
      const bak = fp + '.dshpurge.bak';
      if (fs.existsSync(bak) || !fp.startsWith(appDir)) continue;
      const rel = path.relative(appDir, fp).split(path.sep).join('/');
      const info = index.get(rel);
      if (!info || info.unpacked || typeof info.size !== 'number') continue;
      const size = Number(info.size), off = Number(info.offset || 0);
      const buf = Buffer.alloc(size);
      if (size > 0) fs.readSync(fd, buf, 0, size, dataOffset + off);
      fs.writeFileSync(bak, buf);
      made += 1;
    }
    fs.closeSync(fd);
    log('.dshpurge.bak 生成 =', made);
  }
}

// ── 5. 关掉自动安装（不然一次官方更新就白干）───────────────────────────────
const pref = path.join(DSH_HOME, 'dsh-purge', 'update-preferences.json');
try {
  const cur = fs.existsSync(pref) ? JSON.parse(fs.readFileSync(pref, 'utf8')) : { autoCheck: true, autoInstall: false, intervalHours: 6 };
  cur.autoInstall = false;
  if (typeof cur.autoCheck !== 'boolean') cur.autoCheck = true;
  if (!cur.intervalHours) cur.intervalHours = 6;
  fs.mkdirSync(path.dirname(pref), { recursive: true });
  fs.writeFileSync(pref, JSON.stringify(cur, null, 2) + '\n', 'utf8');
  log('autoInstall = false');
} catch (e) { log('update-preferences 写入失败:', e.message); }

// ── 6. 换目录 + 重启 ────────────────────────────────────────────────────────
const st = await core.gatherState();
log(`完成：applied=${st.patches_applied}/${core.ALL_PATCHES.length} pending=${st.patches_pending} backup=${st.has_backup}`);

if (flag('--no-restart')) {
  log('未重启。手动重启宿主，或把 app.asar 改名为 app.asar.bak 后重启。');
  process.exit(0);
}

log('3 秒后关闭宿主 → 挪走 app.asar → 重启 ...');
const switcher = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'swap-restart.ps1');
setTimeout(() => {
  if (!fs.existsSync(switcher)) { log('swap-restart.ps1 不存在，跳过重启'); process.exit(0); }
  const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', switcher,
    '-Exe', exe, '-Resources', resources], { detached: true, stdio: 'ignore', windowsHide: true });
  p.unref();
  process.exit(0);
}, 3000);
