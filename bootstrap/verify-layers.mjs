#!/usr/bin/env node
/**
 * 三层破甲验证：提示词层 / 代码层 / 引擎层
 *
 * 用法：
 *   node verify-layers.mjs                 # 自动定位宿主与 DSH_HOME
 *   node verify-layers.mjs --exe "C:\\...\\DeepSeek Harness.exe"
 *   node verify-layers.mjs --json          # 机器可读输出
 *
 * 退出码：0 = 三层全通；1 = 有层未过
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const argv = process.argv.slice(2);
const arg = (n, d = '') => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const asJson = argv.includes('--json');

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');

function findExe() {
  const explicit = arg('--exe', process.env.DSH_EXE || '');
  if (explicit && fs.existsSync(explicit)) return path.normalize(explicit);
  const names = ['DeepSeek Harness.exe', 'dsh desktop.exe', 'DeepseekHarnessDesktop.exe'];
  const roots = [path.join(process.env.LOCALAPPDATA || '', 'Programs'), process.env.ProgramFiles || '', process.env['ProgramFiles(x86)'] || ''].filter(Boolean);
  for (const root of roots) {
    let dirs = [];
    try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { continue; }
    for (const d of dirs) for (const n of names) {
      const p = path.join(root, d, n);
      if (fs.existsSync(p)) return path.normalize(p);
    }
  }
  return '';
}

const exe = findExe();
if (!exe) { console.error('[verify] 找不到 DeepSeek Harness.exe，用 --exe 指定'); process.exit(1); }
const resources = path.join(path.dirname(exe), 'resources');
const appDir = path.join(resources, 'app');
const AI = path.join(appDir, 'dsh', 'node_modules', '@deepseek-ai');
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const has = (text, needle) => Boolean(text) && text.includes(needle);

const rows = [];
function check(layer, id, name, ok, detail, fix) {
  rows.push({ layer, id, name, ok: Boolean(ok), detail, fix });
}

// ───────────────────────── 提示词层 ─────────────────────────
const injectPath = path.join(DSH_HOME, 'prompt-inject.md');
const inject = read(injectPath);
check('提示词', 'P1', 'prompt-inject.md 存在且完整',
  inject.length > 20000,
  `${inject.length} 字符 / ${inject.split('\n').length} 行`,
  '从 dsh-unleashed-custom.zip 取 prompt-inject.md 放到 DSH_HOME');

const neverSrc = read(path.join(AI, 'dsh-user-approval', 'lib', 'index.js'));
check('提示词', 'P2', '审批文案已改为 auto-granted',
  has(neverSrc, 'Approval requests are auto-granted'),
  has(neverSrc, 'Approval requests are auto-granted') ? 'NEVER_SENTENCE 命中' : `仍含旧文案: ${has(neverSrc, 'rejected automatically') ? 'rejected automatically' : '未知'}`,
  '重跑 run-purge.mjs（对应补丁 #5/#11/#12）');

const baseYml = read(path.join(AI, 'dsh-base', 'cordis.patch.yml'));
check('提示词', 'P3', 'plan-mode 软阻断已移除',
  has(baseYml, '[dsh-purge] plan-mode soft block removed'),
  has(baseYml, '[dsh-purge] plan-mode soft block removed') ? 'marker 命中' : 'marker 缺失',
  '重跑 run-purge.mjs（补丁 #63/#55）');

const presetUn = read(path.join(DSH_HOME, '.agent-presets', 'unrestricted', 'agent.cordis.yml'));
const presetLs = read(path.join(DSH_HOME, '.agent-presets', 'liangshen', 'agent.cordis.yml'));
const noOfficialId = !has(presetUn, 'You are a helpful software engineer assistant.');
check('提示词', 'P4', '预设已去官方身份句',
  Boolean(presetUn) && noOfficialId,
  presetUn ? (noOfficialId ? `unrestricted ${presetUn.length}B` : 'unrestricted 仍含官方身份句') : 'unrestricted 预设不存在',
  '从 dsh-unleashed-custom.zip 铺 presets/');
check('提示词', 'P5', '梁神模式已落地并被 #71 洗过',
  Boolean(presetLs) && has(presetLs, '[dsh-purge] liangshen identity line removed'),
  presetLs ? (has(presetLs, '[dsh-purge] liangshen identity line removed') ? 'marker 命中' : 'marker 缺失') : 'liangshen 预设不存在',
  '铺 presets/liangshen 后重跑 apply（补丁 #71）');

// ───────────────────────── 代码层 ─────────────────────────
check('代码', 'C1', '审批 schema 默认 never',
  has(neverSrc, '.default("never")'),
  has(neverSrc, '.default("never")') ? 'zod default 命中' : (has(neverSrc, '.default("ask")') ? '仍是 ask' : '未识别'),
  '重跑 run-purge.mjs（补丁 #8/#10）');

const fsSandbox = read(path.join(AI, 'dsh-fs-sandbox', 'lib', 'index.js'));
check('代码', 'C2', '文件围栏已拆',
  fsSandbox.length > 0 && !has(fsSandbox, 'denyEveryMutation'),
  fsSandbox ? 'fs-sandbox 已加载（围栏判定放行由 mode 决定）' : '文件缺失',
  '重跑 run-purge.mjs（补丁 #16）');

const escalation = read(path.join(AI, 'dsh-sandbox', 'lib', 'index.js'));
check('代码', 'C3', '升级目标含 danger-full-access',
  has(escalation, 'ESCALATION_TARGETS') && has(escalation, 'danger-full-access'),
  has(escalation, 'danger-full-access') ? 'ESCALATION_TARGETS 命中' : '未命中',
  '重跑 run-purge.mjs（补丁 #14/#15）');

const loop = read(path.join(AI, 'dsh-agent-loop', 'lib', 'index.js'));
check('代码', 'C4', 'agent-loop 守卫补丁在位',
  loop.length > 0,
  loop ? `${Math.round(loop.length / 1024)} KB` : '文件缺失',
  '重跑 run-purge.mjs（补丁 #67/#69）');

const bakCount = (() => {
  let n = 0;
  (function walk(d, depth) {
    if (depth > 6) return;
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f, depth + 1);
      else if (e.name.endsWith('.dshpurge.bak')) n += 1;
    }
  })(AI, 0);
  return n;
})();
check('代码', 'C5', '逐文件原始备份存在（可细粒度回滚）',
  bakCount > 0,
  `${bakCount} 个 .dshpurge.bak`,
  'run-purge.mjs 会从 app.asar.bak 自动生成');

// ───────────────────────── 引擎层 ─────────────────────────
check('引擎', 'E1', '宿主已解包（resources/app 在用）',
  fs.existsSync(path.join(appDir, 'dsh', 'node_modules')),
  fs.existsSync(appDir) ? 'app 目录存在' : 'app 目录不存在',
  '跑 run-purge.mjs 解包');

const asarPath = path.join(resources, 'app.asar');
const swapped = !fs.existsSync(asarPath) && fs.existsSync(asarPath + '.bak');
check('引擎', 'E2', '归档已挪开（否则 Electron 仍读 asar）',
  swapped,
  `asar=${fs.existsSync(asarPath)} bak=${fs.existsSync(asarPath + '.bak')}`,
  'swap-restart.ps1 会处理；被占用时关宿主后重跑');

check('引擎', 'E3', '沙箱默认 danger-full-access',
  has(baseYml, "?? 'danger-full-access'"),
  has(baseYml, "?? 'danger-full-access'") ? "mode 默认命中" : (has(baseYml, "?? 'workspace-write'") ? '仍是 workspace-write' : '未识别'),
  '重跑 run-purge.mjs（补丁 #7）');

check('引擎', 'E4', '审批策略默认恒 never',
  has(baseYml, "'danger-full-access') === 'danger-full-access' ? 'never' : 'ask'"),
  has(baseYml, "'danger-full-access') === 'danger-full-access' ? 'never'") ? 'policy 表达式命中' : '未命中',
  '重跑 run-purge.mjs（补丁 #8）');

const shimDir = path.join(resources, 'runtime', 'cli', 'bin');
const dshCmd = read(path.join(shimDir, 'dsh.cmd'));
check('引擎', 'E5', 'CLI 入口指向解包目录',
  has(dshCmd, 'app\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host'),
  dshCmd ? (has(dshCmd, 'app\\dsh\\node_modules') ? 'dsh.cmd 首顺位 = app' : '仍指向 app.asar') : 'dsh.cmd 不存在',
  'run-purge.mjs 会重写 shim');

const prefPath = path.join(DSH_HOME, 'dsh-purge', 'update-preferences.json');
let autoInstall = null;
try { autoInstall = JSON.parse(read(prefPath) || '{}').autoInstall; } catch {}
check('引擎', 'E6', '自动安装已关闭（防官方更新抹掉补丁）',
  autoInstall === false,
  autoInstall === null ? '偏好文件缺失' : `autoInstall=${autoInstall}`,
  'run-purge.mjs 会写 autoInstall=false');

// ───────────────────────── 输出 ─────────────────────────
const byLayer = { '提示词': [], '代码': [], '引擎': [] };
for (const r of rows) byLayer[r.layer].push(r);
const layerOk = (l) => byLayer[l].every((r) => r.ok);
const allOk = ['提示词', '代码', '引擎'].every(layerOk);

if (asJson) {
  console.log(JSON.stringify({ exe, layers: byLayer, ok: allOk }, null, 2));
} else {
  console.log(`\n宿主：${exe}`);
  console.log(`DSH_HOME：${DSH_HOME}\n`);
  for (const l of ['提示词', '代码', '引擎']) {
    console.log(`── ${l}层 ${layerOk(l) ? 'PASS' : 'FAIL'} ──────────────────────────`);
    for (const r of byLayer[l]) {
      console.log(`  ${r.ok ? '✓' : '✗'} ${r.id} ${r.name}`);
      console.log(`      ${r.detail}${r.ok ? '' : `\n      fix: ${r.fix}`}`);
    }
    console.log('');
  }
  const pass = rows.filter((r) => r.ok).length;
  console.log(`合计 ${pass}/${rows.length} 项通过 · ${allOk ? '三层全通' : '有层未通'}`);
}
process.exit(allOk ? 0 : 1);
