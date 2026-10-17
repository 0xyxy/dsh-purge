# Purge Community

An independently maintained community fork of [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge), originally created by **小杨**. This is not an official upstream release. Original attribution, Git history and the MIT license are retained. This community distribution is free and is not offered for paid resale.

## What changes

One `dsh-purge-community` package combines the backend and native right-sidebar settings. It retains internal configuration IDs and data locations, fixes missing `cwd` prompt variables, checks the host version, and provides local backups plus plugin rollback. Updates come only from this repository's stable GitHub Releases, with SHA256 and package identity checks. No automatic application restart or host re-patching occurs.

**Tested target: macOS DSH Desktop 0.2.1-rc.1 runtime.** Legacy host binary patch writes/restores are disabled, not declared compatible. Unknown or mixed host versions disable the main runtime hook while keeping maintenance available. Windows and Web profiles have not completed this release's end-to-end qualification. Existing on-disk host patches are left unchanged.

## Install and migrate

Download the `.tgz` and `SHA256SUMS.txt` from [Releases](https://github.com/kingcharleslzy-ai/dsh-purge/releases/latest), verify the checksum, and extract the tarball. With Node 22+ and the Desktop `dsh` command available:

```sh
PURGE_DSH_CLI="$(command -v dsh)" node \
  ./package/bin/community.js migrate ./dsh-purge-community-1.2.0.tgz
```

The installer backs up existing Purge packages and configuration, replaces only Purge's active bundle entries, and preserves other plugins. Then fully quit and reopen DSH manually. Use **Purge Community** in the right sidebar. Do not install a second standalone panel.

Maintenance snapshots remain local under `$DSH_HOME/dsh-purge-community/backups`. Rollback restores plugin code and enablement only; current prompts, rules and unrelated settings are preserved. Snapshot settings are available for deliberate file-by-file recovery. Credentials, sessions, galleries and models are not collected.

See the [Chinese guide](../README.md), [maintenance documentation](MAINTENANCE.md), [compatibility fix](CWD-COMPAT.md) and [NOTICE](../NOTICE.md).
