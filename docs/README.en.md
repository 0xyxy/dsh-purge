# Purge Community

An independently maintained community fork of [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge), originally created by **小杨**. This is not an official upstream release. Original attribution, Git history and the MIT license are retained. This community distribution is free and is not offered for paid resale.

## What changes

1.3.0 restores full parity with upstream 1.1.71. 1.2.0 had hard-disabled every legacy host-file patch (apply, revert, uninstall, boot self-heal, auto apply/update, hooks toggle, per-patch status, original CLI); that global switch is gone and `__COMMUNITY__` now only changes branding, labels and the update repository.

All 82 host patches were re-qualified against a pristine DSH Desktop **0.2.1-rc.1** copy: 63 written, 6 already at target state, 0 failed. Six drifted anchors were rewritten for the new host source (the Web-surface identity sentence moved to `dsh-harness-dev-context`, `assemble()` gained a `requiredContexts` filter, `append()` clears `revised` lazily). A new anchor diagnosis (`/dsh-purge/diagnose`, `npm run diagnose`, panel "Status → Compatibility") reports exactly which patch, file and expected source snippet no longer match, instead of disabling everything.

The package also restores the conversation-input rewind button with draft refill, the first-run welcome notice, the red-team environment gate, the original CLI (`dsh-purge --apply/--revert/--uninstall/--edit`), and the original update lanes (stable/beta, branch, tag and pin selection, multi-install planning). Updates default to this repository's verified releases; selecting the abandoned upstream source is opt-in and carries an explicit incompatibility warning.

**Qualified target: macOS DSH Desktop 0.2.1-rc.1.** Unknown host versions are allowed but reported as unverified; mixed component versions pause writes; Windows and Web profiles are not end-to-end qualified in this release.

## Install and migrate

Download the `.tgz` and `SHA256SUMS.txt` from [Releases](https://github.com/kingcharleslzy-ai/dsh-purge/releases/latest), verify the checksum, and extract the tarball. On macOS the desktop runtime itself can run the installer, so no `dsh` on PATH is required:

```sh
APP="/Applications/DeepSeek Harness.app"
ELECTRON_RUN_AS_NODE=1 "$APP/Contents/MacOS/DeepSeek Harness" \
  "$PWD/package/bin/community.js" migrate "$PWD/dsh-purge-community-1.3.0.tgz"
```

The installer backs up existing Purge packages and configuration, replaces only Purge's active bundle entries, and preserves other plugins. Then fully quit and reopen DSH manually, open **Purge Community → Status**, check the compatibility level, press **Apply** to write the host patches (a profile snapshot is taken first), and quit/reopen once more so the unpacked host takes effect. Do not install a second standalone panel.

Maintenance snapshots remain local under `$DSH_HOME/dsh-purge-community/backups`. Rollback restores plugin code and enablement only; current prompts, rules and unrelated settings are preserved. Snapshot settings are available for deliberate file-by-file recovery. Credentials, sessions, galleries and models are not collected.

See the [Chinese guide](../README.md), [maintenance documentation](MAINTENANCE.md), [compatibility fix](CWD-COMPAT.md) and [NOTICE](../NOTICE.md).
