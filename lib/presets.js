// User-plane agent presets that ship with the plugin.
//
// `unrestricted` is a skeleton: the preset owns the persona and tool plane, while
// approvals/sandbox stay with the host — those gates are removed by host patches,
// not by the preset. Installing it also gives patches #24 / #76 something to act on.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findDshHome } from "./core.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const UNRESTRICTED_PRESET = "unrestricted";
export const PRESET_FILES = ["preset.yml", "agent.cordis.yml"];
/** 插件自己写的文件带这一行；带它就会被新版覆盖，去掉即视为用户自定义。 */
export const MANAGED_MARKER = "# managed-by: dsh-purge";

export function bundledPresetDir(name = UNRESTRICTED_PRESET) {
  return path.join(ROOT, "presets", name);
}

export function userPresetDir(home, name = UNRESTRICTED_PRESET) {
  const base = home || findDshHome();
  if (!base) throw new Error("未定位 DSH 数据目录");
  return path.join(base, ".agent-presets", name);
}

/**
 * 把自带预设落到用户目录。
 * 已存在且没给 force 时**不覆盖**（用户可能改过），只报告 kept。
 * @returns {{ action: 'installed'|'updated'|'kept', dir: string, files: string[] }}
 */
export function installPreset({ name = UNRESTRICTED_PRESET, force = false, home } = {}) {
  const src = bundledPresetDir(name);
  if (!fs.existsSync(src)) throw new Error(`发行包里没有预设：${src}`);
  const dir = userPresetDir(home, name);
  const agentFile = path.join(dir, "agent.cordis.yml");
  const exists = fs.existsSync(agentFile);
  let managed = false;
  if (exists) {
    try {
      managed = fs.readFileSync(agentFile, "utf8").startsWith(MANAGED_MARKER);
    } catch {
      managed = false;
    }
  }
  if (exists && !force && !managed) return { action: "kept", dir, files: PRESET_FILES.slice() };
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const file of PRESET_FILES) {
    const from = path.join(src, file);
    if (!fs.existsSync(from)) continue;
    fs.copyFileSync(from, path.join(dir, file));
  }
  return { action: exists ? "updated" : "installed", dir, files: PRESET_FILES.slice() };
}

export function presetStatus(home, name = UNRESTRICTED_PRESET) {
  let dir = "";
  try {
    dir = userPresetDir(home, name);
  } catch {
    return { name, dir: "", installed: false };
  }
  const file = path.join(dir, "agent.cordis.yml");
  return { name, dir, installed: fs.existsSync(file), file };
}
