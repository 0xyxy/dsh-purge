# 三层破甲一键安装器：引擎层 → 代码层 → 提示词层 → 验证
#
# 用法：
#   .\install-layers.ps1                  # 全流程（同步预设→装/升级插件→解包→补丁→shim→铺提示词与预设→重启→验证）
#   .\install-layers.ps1 -VerifyOnly      # 只跑三层验证，不改任何文件
#   .\install-layers.ps1 -NoRestart       # 文件层全做完，但不自动重启
#   .\install-layers.ps1 -Tag v1.6.67     # 锁插件版本（默认 latest，期望版本取自仓库 package.json）
#   .\install-layers.ps1 -Repo 0xyxy/dsh-purge
#   .\install-layers.ps1 -Exe "D:\Apps\DeepSeek Harness\DeepSeek Harness.exe"
#
# 前提：DSH 桌面版已装且至少启动过一次。
#
# 设计取舍（每一条都是踩过的坑）：
#   - 安装源只来自 -Repo/-Tag；历史上安装源曾不一致，导致
#     "装的到底是哪个仓库的包"说不清。
#   - 已装版本 ≠ 期望版本时**真的升级**，不再只打印版本号就让旧表去改新宿主。
#   - 预设以仓库 presets/ 为唯一事实源，安装前先跑 sync-presets.mjs（会删掉多余副本）。
#   - 换包失败必须让安装器失败：run-purge 退出码 2 = 补丁没打全，直接停，不进验证。
#   - 重启后轮询复验，但只在"连续两次同一结论"时才认；退出码 2（待应用/等待）继续等，
#     退出码 1（真坏了）立刻停。
param(
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }),
  [string]$Exe = '',
  [string]$Repo = '0xyxy/dsh-purge',
  [string]$Tag = 'latest',
  [string]$ExpectVersion = '',
  [string]$PluginUrl = '',
  [string]$CustomUrl = '',
  [int]$RestartTimeoutSec = 180,
  [switch]$VerifyOnly,
  [switch]$NoRestart,
  [switch]$SkipVerify
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$log = Join-Path $here 'install-layers.log'
function W($m) { $line = ("{0} {1}" -f (Get-Date).ToString('HH:mm:ss'), $m); Write-Host $line; $line | Out-File -FilePath $log -Append -Encoding utf8 }
function Fail($m) { W "FAIL: $m"; exit 1 }

# 发行清单优先：ZIP 里带着 release-manifest.json（repo / tag / version / plugin sha256），
# 没显式传参就按它来，避免"定制层来自 A 仓库、插件层来自 B 仓库"。
$manifest = $null
$manifestPath = Join-Path $here 'release-manifest.json'
if (Test-Path $manifestPath) {
  try { $manifest = Get-Content $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json } catch { $manifest = $null }
}
if ($manifest) {
  if (-not $PSBoundParameters.ContainsKey('Repo') -and $manifest.repo) { $Repo = $manifest.repo }
  if (-not $PSBoundParameters.ContainsKey('Tag') -and $manifest.tag) { $Tag = $manifest.tag }
  if (-not $ExpectVersion -and $manifest.version) { $ExpectVersion = $manifest.version }
  W "发行清单：$($manifest.repo) $($manifest.tag) v$($manifest.version)"
}
if (-not $PluginUrl) {
  $pluginName = if ($Tag -eq 'latest') { 'dsh-purge-community.tgz' } else { "dsh-purge-community-$($Tag.TrimStart('v')).tgz" }
  $PluginUrl = "https://github.com/$Repo/releases/$Tag/download/$pluginName"
}
if ($manifest -and $manifest.assets -and $manifest.assets.plugin -and $Tag -ne 'latest') {
  $PluginUrl = "https://github.com/$Repo/releases/$Tag/download/$($manifest.assets.plugin)"
}
if (-not $CustomUrl) { $CustomUrl = "https://github.com/$Repo/releases/$Tag/download/dsh-unleashed-custom.zip" }
if (-not $ExpectVersion) {
  if ($Tag -ne 'latest') {
    $ExpectVersion = $Tag.TrimStart('v')
  } else {
    $repoPkg = Join-Path (Split-Path $here -Parent) 'package.json'
    if (Test-Path $repoPkg) { $ExpectVersion = (Get-Content $repoPkg -Raw -Encoding utf8 | ConvertFrom-Json).version }
  }
}
W "安装源 = $Repo ($Tag)"
W "插件   = $PluginUrl"
W "期望版本 = $(if ($ExpectVersion) { $ExpectVersion } else { '未指定（不做版本对齐）' })"

function Find-Exe {
  if ($Exe) { if (-not (Test-Path $Exe)) { Fail "-Exe 不存在: $Exe" }; return (Resolve-Path $Exe).Path }
  $names = @('DeepSeek Harness.exe', 'dsh desktop.exe', 'DeepseekHarnessDesktop.exe')
  $roots = @((Join-Path $env:LOCALAPPDATA 'Programs'), $env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ -and (Test-Path $_) }
  foreach ($root in $roots) {
    foreach ($dir in Get-ChildItem $root -Directory -ErrorAction SilentlyContinue) {
      foreach ($n in $names) { $p = Join-Path $dir.FullName $n; if (Test-Path $p) { return $p } }
    }
  }
  Fail '找不到 DeepSeek Harness.exe；用 -Exe 指定'
}

$exePath = Find-Exe
$resources = Join-Path (Split-Path $exePath) 'resources'
$rt = Join-Path $resources 'runtime\primary-runtime\dependencies'
$nodeExe = Join-Path $rt 'node\bin\node.exe'
$pnpmMjs = Join-Path $rt 'pnpm\bin\pnpm.mjs'
$profileDir = Join-Path $DshHome 'profiles\desktop'
$pluginDir = Join-Path $profileDir 'node_modules\dsh-purge-community'

W "exe      = $exePath"
W "DSH_HOME = $DshHome"
if (-not (Test-Path $nodeExe)) { Fail "找不到内置 node: $nodeExe" }

$env:DSH_HOME = $DshHome
$env:DSH_EXE = $exePath
$env:DSH_SURFACE = 'desktop'

function Invoke-Verify {
  $v = Join-Path $here 'verify-layers.mjs'
  if (-not (Test-Path $v)) { Fail "缺少 $v" }
  & $nodeExe $v --exe $exePath 2>&1 | ForEach-Object { Write-Host $_ }
  return $LASTEXITCODE
}

if ($VerifyOnly) { exit (Invoke-Verify) }

# ── 0. 预设副本与仓库对齐（仓库 presets/ 是唯一事实源）────────────────────────
$sync = Join-Path $here 'sync-presets.mjs'
if (Test-Path $sync) {
  W '同步预设副本（presets/ → payload/presets/）...'
  & $nodeExe $sync 2>&1 | ForEach-Object { W "  $_" }
  $syncCode = $LASTEXITCODE
  if ($syncCode -ne 0) { Fail '预设同步失败（payload 副本与仓库不一致，不继续）' }
} else {
  W '缺少 sync-presets.mjs，跳过预设同步（payload 副本可能已过期）'
}

# ── 1. 插件：装或升级到期望版本 ─────────────────────────────────────────────
function Get-PluginVersion {
  $pj = Join-Path $pluginDir 'package.json'
  if (-not (Test-Path $pj)) { return $null }
  try { return (Get-Content $pj -Raw -Encoding utf8 | ConvertFrom-Json).version } catch { return $null }
}
function Install-Plugin {
  New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
  # 先下载再装：这样能在写任何东西之前验 SHA256（URL 直装没有校验点）。
  $source = $PluginUrl
  if ($PluginUrl -match '^https?://') {
    $tmp = Join-Path $env:TEMP ("purge-plugin-" + [guid]::NewGuid().ToString('N') + ".tgz")
    Invoke-WebRequest -Uri $PluginUrl -OutFile $tmp -UseBasicParsing
    if ($manifest -and $manifest.sha256 -and $manifest.sha256.plugin) {
      $actual = (Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower()
      if ($actual -ne $manifest.sha256.plugin.ToLower()) {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        Fail "插件包 SHA256 不符（期望 $($manifest.sha256.plugin.Substring(0,16))… 实际 $($actual.Substring(0,16))…），已停止"
      }
      W "插件包 SHA256 校验通过"
    }
    $source = $tmp
  }
  & $nodeExe $pnpmMjs --dir $profileDir add $source 2>&1 | ForEach-Object { W "  pnpm: $_" }
  $code = $LASTEXITCODE
  if ($code -ne 0) { Fail "pnpm add 失败（退出码 $code），检查网络与 $PluginUrl" }
  $pkgJson = Join-Path $profileDir 'package.json'
  $pkg = Get-Content $pkgJson -Raw -Encoding utf8 | ConvertFrom-Json
  if (-not $pkg.dsh) { $pkg | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{ profile = [pscustomobject]@{ bundles = @() } }) -Force }
  $bundles = @($pkg.dsh.profile.bundles)
  if ($bundles -notcontains 'dsh-purge-community') {
    $pkg.dsh.profile.bundles = $bundles + 'dsh-purge-community'
    $pkg | ConvertTo-Json -Depth 12 | Set-Content $pkgJson -Encoding utf8
    W 'bundles 已补 dsh-purge-community'
  }
}

$installedVersion = Get-PluginVersion
if (-not $installedVersion) {
  W '安装 dsh-purge-community ...'
  Install-Plugin
  $installedVersion = Get-PluginVersion
  if (-not $installedVersion) { Fail "插件安装后仍读不到版本：$pluginDir" }
  W "插件已装（$installedVersion）。需要重启一次 DSH 让插件加载，然后重跑本脚本继续。"
  exit 0
}

W "已装插件版本 = $installedVersion"
if ($ExpectVersion -and $installedVersion -ne $ExpectVersion) {
  W "版本不符（期望 $ExpectVersion），执行升级 ..."
  Install-Plugin
  $upgraded = Get-PluginVersion
  if ($upgraded -ne $ExpectVersion) { Fail "升级后版本仍为 $upgraded（期望 $ExpectVersion）。确认 release 上是否存在该版本资产" }
  W "已升级到 $upgraded。需要重启一次 DSH 让新版本加载，然后重跑本脚本继续。"
  exit 0
}

# ── 2. 定制内容（提示词层 + 预设层）───────────────────────────────────────────
$payload = Join-Path $here 'payload'
if (-not (Test-Path (Join-Path $payload 'prompt-inject.md'))) {
  W '从 release 下载定制包 ...'
  $zip = Join-Path $env:TEMP 'dsh-unleashed-custom.zip'
  Invoke-WebRequest -Uri $CustomUrl -OutFile $zip -UseBasicParsing
  # 新版 ZIP 根是 bootstrap/ + presets/，直接解到 $payload 会变成 payload/bootstrap/payload。
  # 先解到临时根，再把 bootstrap/payload 这一层拿过来。
  $stage = Join-Path $env:TEMP ("purge-custom-" + [guid]::NewGuid().ToString('N'))
  Expand-Archive $zip -DestinationPath $stage -Force
  $inner = Join-Path $stage 'bootstrap\payload'
  if (Test-Path (Join-Path $inner 'prompt-inject.md')) {
    Copy-Item $inner $payload -Recurse -Force
  } else {
    Copy-Item (Join-Path $stage 'payload') $payload -Recurse -Force
  }
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}
$stamp = Get-Date -Format yyyyMMdd-HHmmss
$written = @()   # 事务清单：本次改过的用户文件（失败时按它回退）
$inject = Join-Path $DshHome 'prompt-inject.md'
if (Test-Path $inject) {
  $bak = "$inject.bak-$stamp"
  Copy-Item $inject $bak -Force
  $written += [pscustomobject]@{ target = $inject; backup = $bak }
}
Copy-Item (Join-Path $payload 'prompt-inject.md') $inject -Force
W "提示词层 → $inject"

$presetsDst = Join-Path $DshHome '.agent-presets'
New-Item -ItemType Directory -Force -Path $presetsDst | Out-Null
foreach ($d in Get-ChildItem (Join-Path $payload 'presets') -Directory) {
  $t = Join-Path $presetsDst $d.Name
  if (Test-Path $t) {
    $bak = "$t.bak-$stamp"
    Copy-Item $t $bak -Recurse -Force
    $written += [pscustomobject]@{ target = $t; backup = $bak }
  }
  Copy-Item $d.FullName $t -Recurse -Force
  W "预设 → $t"
}

function Show-WrittenBackups {
  if (-not $written.Count) { W '本次没有覆盖任何用户文件。'; return }
  W '本次覆盖过的用户文件（原样备份，需要就自己拷回；安装器不自动回退，避免"用户文件回到旧版、宿主却是新版"的混合状态）：'
  foreach ($w in $written) { W "  $($w.target)  ←  $($w.backup)" }
}

# ── 3. 引擎层 + 代码层：解包 / 补丁 / shim / 关更新 ─────────────────────────
$runner = Join-Path $here 'payload\run-purge.mjs'
if (-not (Test-Path $runner)) { $runner = Join-Path $payload 'run-purge.mjs' }
if (-not (Test-Path $runner)) { Fail '缺少 run-purge.mjs' }
$args2 = @('--exe', $exePath)
if ($NoRestart) { $args2 += '--no-restart' }
& $nodeExe $runner @args2 2>&1 | ForEach-Object { W $_ }
$purgeCode = $LASTEXITCODE
$reportPath = Join-Path $DshHome 'dsh-purge-community\last-apply-report.json'
if ($purgeCode -ne 0) {
  # 任何非零都不进验证：验证读的是磁盘终态，会把"这次没打成"糊成"上次的样子"。
  W "run-purge 退出码 $purgeCode，停止（不换包、不验证）。"
  if (Test-Path $reportPath) {
    $rep = Get-Content $reportPath -Raw -Encoding utf8 | ConvertFrom-Json
    W ("apply 报告：total={0} tally={1}" -f $rep.total, (($rep.tally.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ','))
    foreach ($h in @($rep.hard)) { W ("  硬失败 #{0} {1} → {2}" -f $h.id, $h.name, $h.status) }
    Show-WrittenBackups
  } else {
    W "没有 apply 报告（$reportPath）——这次运行本身没跑完，别信磁盘状态。"
  }
  exit $purgeCode
}
W "apply 报告：$reportPath"

# ── 4. 三层验证（重启后轮询；区分"还没起来"和"真坏了"）────────────────────
if ($SkipVerify) { W '按 -SkipVerify 跳过验证'; exit 0 }
if ($NoRestart) {
  W '未重启。重启宿主后再跑 -VerifyOnly 复验三层。'
  exit 0
}
W "等待宿主重启并复验（上限 ${RestartTimeoutSec}s；退出码 0/1/2 = 通过/坏了/待应用）..."
$deadline = (Get-Date).AddSeconds($RestartTimeoutSec)
$attempt = 0
$consecutiveGreen = 0
$lastCode = 2
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 10
  $attempt += 1
  W "第 $attempt 次复验 ..."
  $lastCode = Invoke-Verify
  if ($lastCode -eq 0) {
    $consecutiveGreen += 1
    if ($consecutiveGreen -ge 2) { W "连续 $consecutiveGreen 次通过，验收完成"; exit 0 }
    W "这一次通过，再确认一次（防止换包助手稍后回滚）..."
    continue
  }
  $consecutiveGreen = 0
  if ($lastCode -eq 1) { W '有层真坏了（BROKEN），停止轮询，按每条 fix 修'; exit 1 }
}
W '超时：仍有 ACTION_REQUIRED / WAITING 项。按提示点一次「应用」或完整退出重开后再跑 -VerifyOnly'
exit $lastCode
