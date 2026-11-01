// JSON 读写：失败返回 fallback，不抛异常。
// 原先 community.js / uninstall.js / update-state.js 各有一份等价实现，
// 合并成一处，避免三份行为漂移。
import fs from "node:fs";

export function readJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}