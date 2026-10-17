#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { Maintenance, compatibility, ROOT, PACKAGE } from "../lib/community.js";
import { findDshHome, findAiBase, patchDrift } from "../lib/core.js";
import { selfCheck } from "../lib/selfcheck.js";
import { installPreset, presetStatus } from "../lib/presets.js";
import { readBoost, writeBoost } from "../lib/boost.js";
import { createProbe, readProbe } from "../lib/probe.js";
const rawArgs = process.argv.slice(2);
// 原版 CLI 的全部动作（apply/revert/uninstall/edit/status）原样保留，
// purge-community 只做转发，避免两套实现漂移。
const LEGACY = { apply: "--apply", revert: "--revert", uninstall: "--uninstall", edit: "--edit", "legacy-status": "--status" };
const [op = "status", argument] = rawArgs,
  home = process.env.DSH_HOME || findDshHome();
// A supplied Desktop CLI is sufficient for installation. Avoid a recursive host scan
// from ordinary Node; packaged Electron can resolve its own resources directly.
function cliAiBase() {
  if (!process.env.PURGE_DSH_CLI) return findAiBase();
  const resources = path.resolve(
    path.dirname(fs.realpathSync(process.env.PURGE_DSH_CLI)),
    "../../..",
  );
  const candidate = path.join(resources, "app/dsh/node_modules/@deepseek-ai");
  return fs.existsSync(candidate) ? candidate : "";
}
const aiBase = cliAiBase();
// 懒构造：status / diagnose / selfcheck 不该因为 profile 目录暂时不可用就直接崩。
const maintenance = () => new Maintenance({
  home,
  profile: process.env.PURGE_PROFILE_DIR,
  aiBase,
});
if (LEGACY[op]) {
  const run = spawnSync(process.execPath, [path.join(ROOT, "bin", "dsh-purge.js"), LEGACY[op], ...rawArgs.slice(1)], { stdio: "inherit" });
  process.exitCode = run.status === null ? 1 : run.status;
} else try {
  let result;
  if (op === "probe") {
    if (argument === "new" || argument === "create") {
      const probe = createProbe();
      result = { ok: true, ...probe };
    } else {
      const probe = readProbe();
      result = { ok: true, active: !!probe, nonce: probe?.nonce || "", hint: "purge-community probe new" };
    }
  } else if (op === "preset") {
    const sub = argument || "status";
    if (sub === "install" || sub === "update") {
      result = installPreset({ force: rawArgs.includes("--force") });
    } else if (sub === "status" || sub === "path") {
      result = presetStatus(home);
    } else {
      throw Error("用法：purge-community preset [status|install [--force]]");
    }
  } else if (op === "boost") {
    if (argument === "on" || argument === "off") result = { enabled: writeBoost(argument === "on") };
    else result = { enabled: readBoost(), hint: "purge-community boost on|off" };
  } else if (op === "selfcheck" || op === "check-bypass") {
    const report = await selfCheck(aiBase || "");
    if (rawArgs.includes("--json")) result = report;
    else {
      const lines = [
        `Purge 破甲自检 · ${report.host || "(未定位宿主)"}`,
        `  DSH ${report.host_version} · ${report.level} · 宿主补丁 ${report.patch.applied}/${report.patch.total}`,
        "",
      ];
      for (const layer of report.layers) {
        const mark = layer.state === "pending" ? "⏳" : layer.ok ? "✓" : "✗";
        const tail = layer.note
          || (layer.broken.length ? JSON.stringify(layer.broken) : "")
          || (layer.pending && layer.pending.length ? `待应用 #${layer.pending.join("/#")}` : "");
        lines.push(`  ${mark} ${layer.title}  ${layer.applied}/${layer.required ?? layer.total}${tail ? "  " + tail : ""}`);
      }
      const pendingCount = (report.summary && report.summary.pending && report.summary.pending.patches) || 0;
      lines.push(
        "",
        report.state === "pending"
          ? `结论：有 ${pendingCount} 条补丁待应用 —— 点一次「应用」，然后退出重开 DSH 即可。`
          : report.state === "broken"
            ? "结论：有层真的没生效（✗），见上面。"
            : "结论：所有层都在位。",
      );
      if (rawArgs.includes("--text")) {
        console.log(lines.join("\n"));
        process.exit(report.state === "broken" ? 1 : 0);
      }
      result = { ok: report.ok, text: lines.join("\n"), summary: report.summary };
    }
  } else if (op === "diagnose") {
    const target = aiBase || findAiBase();
    const drift = await patchDrift(target);
    result = { name: "Purge Community", package: PACKAGE, compatibility: compatibility(target), ...drift };
  } else if (op === "status")
    result = {
      name: "Purge Community",
      package: PACKAGE,
      compatibility: compatibility(aiBase),
      backups: (() => { try { return maintenance().list(); } catch { return []; } })(),
    };
  else if (op === "backup") result = await maintenance().backup("cli");
  else if (op === "prune") result = maintenance().prune();
  else if (op === "usage") result = maintenance().usage();
  else if (op === "rollback") result = await maintenance().rollback(argument);
  else if (op === "install" || op === "migrate") {
    if (!argument) throw Error("需要安装包路径");
    result = await maintenance().install(path.resolve(argument), {
      reason: op === "migrate" ? "before-migration" : "before-update",
      migrate: op === "migrate",
    });
  } else
    throw Error(
      "用法：purge-community status | diagnose | selfcheck [--json] | boost on|off | probe [new] | preset [status|install] | backup [prune|usage] | rollback <备份ID> | migrate <tgz> | apply | revert | uninstall | edit",
    );
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
