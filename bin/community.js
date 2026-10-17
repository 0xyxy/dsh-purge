#!/usr/bin/env node
import path from "node:path";
import { Maintenance, compatibility, ROOT, PACKAGE } from "../lib/community.js";
import { findDshHome, findAiBase } from "../lib/core.js";
const [op = "status", argument] = process.argv.slice(2),
  home = process.env.DSH_HOME || findDshHome();
const manager = new Maintenance({
  home,
  profile: process.env.PURGE_PROFILE_DIR,
  aiBase: findAiBase(),
});
try {
  let result;
  if (op === "status")
    result = {
      name: "Purge Community",
      package: PACKAGE,
      compatibility: compatibility(findAiBase()),
      backups: manager.list(),
    };
  else if (op === "backup") result = await manager.backup("cli");
  else if (op === "rollback") result = await manager.rollback(argument);
  else if (op === "install" || op === "migrate") {
    if (!argument) throw Error("需要安装包路径");
    result = await manager.install(path.resolve(argument), {
      reason: op === "migrate" ? "before-migration" : "before-update",
      migrate: op === "migrate",
    });
  } else
    throw Error(
      "用法：purge-community status | backup | rollback <备份ID> | migrate <tgz>",
    );
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
