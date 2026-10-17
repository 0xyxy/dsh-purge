/** Community updates use verified release packages, not branch overlays or automatic re-patching. */
import fs from "node:fs";
import path from "node:path";
import {
  Maintenance,
  ROOT,
  REPOSITORY,
  releasedVersions,
  installRelease,
} from "./community.js";
import { findDshHome, findAiBase } from "./core.js";
let last = null;
export const pluginRoot = () => ROOT;
export const localVersion = () =>
  JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
export const channelPublic = () => ({
  channel: "stable",
  channelRef: "releases",
  pin: "",
  repository: REPOSITORY,
});
export const lastUpdateResult = () => last;
export function versionIsNewer(a, b) {
  const x = a.split(".").map(Number),
    y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
}
export async function checkUpdate() {
  const local = localVersion();
  let listed = [],
    error = "";
  try {
    listed = await releasedVersions();
  } catch (e) {
    error = e.message;
  }
  const remote = listed[0]?.version || local;
  const versions = listed.map((v, i) => ({
    ...v,
    current: v.version === local,
    latest: i === 0,
  }));
  if (!versions.some((v) => v.version === local))
    versions.push({
      id: "v" + local,
      ref: "v" + local,
      version: local,
      channel: "stable",
      current: true,
      label: "Purge Community " + local,
    });
  return {
    ...channelPublic(),
    ok: true,
    localVersion: local,
    remoteVersion: remote,
    hasUpdate: versionIsNewer(remote, local),
    versions,
    hasBeta: false,
    error,
    lanes: [
      {
        id: "stable",
        channel: "stable",
        label: "正式版",
        current: true,
        version: remote,
        hasUpdate: versionIsNewer(remote, local),
      },
      { id: "beta", channel: "beta", exists: false },
    ],
  };
}
export async function handleUpdateOp(body = {}) {
  const op = String(body.op || "apply");
  if (["check", "status", "versions"].includes(op)) return checkUpdate();
  if (op === "auto") return autoUpdateIfNeeded();
  if (op === "channel" && body.channel !== "stable")
    throw Error("社区版只提供经过发布检查的正式版本");
  const listed = await releasedVersions(),
    requested = body.ref || body.version || body.id;
  const selected = requested
    ? listed.find((v) => v.ref === requested || v.version === requested)
    : listed[0];
  if (!selected) throw Error("请选择本 fork 已发布的正式版本");
  const manager = new Maintenance({
    home: findDshHome(),
    aiBase: findAiBase(),
  });
  const result = await installRelease(manager, selected);
  last = {
    ...result,
    applied: true,
    needRestart: true,
    needsFullQuit: true,
    restartAfter: false,
    reloadClient: false,
    localVersion: selected.version,
  };
  return last;
}
export async function autoUpdateIfNeeded() {
  return { skipped: "manual-only", hasUpdate: false, ...channelPublic() };
}
