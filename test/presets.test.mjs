// The bundled `unrestricted` preset is a skeleton: it must stay a valid agent
// composition, install idempotently, and keep the anchors that patches #24 / #76
// are written against — otherwise installing it silently disables those patches.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installPreset, presetStatus, bundledPresetDir } from "../lib/presets.js";
import { readPresetDefinition } from "../lib/redteam/preset-composition.js";
import { ALL_PATCHES, applyReplacementsToText } from "../lib/core.js";

const template = () => fs.readFileSync(path.join(bundledPresetDir(), "agent.cordis.yml"), "utf8");

test("the bundled preset is present and still matches the patch anchors", () => {
  const text = template();
  assert(text.length > 1000, "template should be a full composition, not a stub");
  assert(text.includes("- id: persona"), "persona row");
  assert(text.includes("@deepseek-ai/dsh-tool-bash"), "shell tool row");
  assert(text.includes("- id: tool-web"), "web tool row");
  // #24 flips preset fetch on; the anchor must exist or the patch silently skips.
  const fetchPatch = ALL_PATCHES.find((p) => p.id === 24);
  assert.equal(applyReplacementsToText(text, fetchPatch).changed, true, "#24 anchor");
  // #76 is optional for this preset: it must not mangle a preset that never used
  // the stock identity line.
  const stripPatch = ALL_PATCHES.find((p) => p.id === 76);
  assert.equal(applyReplacementsToText(text, stripPatch).changed, false, "#76 stays optional");
});

test("install is idempotent and never overwrites user edits without force", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-preset-"));
  try {
    assert.equal(presetStatus(home).installed, false);
    const first = installPreset({ home });
    assert.equal(first.action, "installed");
    const file = path.join(first.dir, "agent.cordis.yml");
    assert(fs.existsSync(file));
    assert.equal(fs.readFileSync(file, "utf8"), template());

    fs.writeFileSync(file, "user edited\n");
    const second = installPreset({ home });
    assert.equal(second.action, "kept");
    assert.equal(fs.readFileSync(file, "utf8"), "user edited\n");

    const forced = installPreset({ home, force: true });
    assert.equal(forced.action, "updated");
    assert.equal(fs.readFileSync(file, "utf8"), template());
    assert.equal(presetStatus(home).installed, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("the bundled preset parses into a registry definition", () => {
  const def = readPresetDefinition("unrestricted", bundledPresetDir());
  assert.equal(def.id, "unrestricted");
  assert.equal(def.name, "无限制模式");
  assert.equal(def.order, 20);
  assert(Array.isArray(def.plugins), "plugins rows");
  assert(def.plugins.length >= 12, `expected a full composition, got ${def.plugins.length}`);
  const ids = def.plugins.map((row) => row && row.id).filter(Boolean);
  assert(ids.includes("persona"), "persona row kept");
  assert(!ids.includes("redteam-tools"), "red team rows stripped");
});
