# 三层破甲一键安装器：引擎层 → 代码层 → 提示词层 → 验证
#
# 用法：
#   .\install-layers.ps1                  # 全流程（装插件→解包→补丁→shim→铺提示词与预设→重启→验证）
#   .\install-layers.ps1 -VerifyOnly      # 只跑三层验证，不改任何文件
#   .\install-layers.ps1 -NoRestart       # 文件层全做完，但不自动重启
#   .\install-layers.ps1 -Exe "D:\Apps\DeepSeek Harness\DeepSeek Harness.exe"
#
# 前提：DSH 桌面版已装且至少启动过一次。
param(
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }),
  [string]$Exe = '',
  [string]$PluginUrl = 'https://github.com/2958252183/dsh-purge/releases/latest/download/dsh-purge-community.tgz',
  [string]$CustomUrl = 'https://github.com/2958252183/dsh-purge/releases/latest/download/dsh-unleashed-custom.zip',
  [switch]$VerifyOnly,
  [switch]$NoRestart
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$log = Join-Path $here 'install-layers.log'
function W($m) { $line = ("{0} {1}" -f (Get-Date).ToString('HH:mm:ss'), $m); Write-Host $line; $line | Out-File -FilePath $log -Append -Encoding utf8 }
function Fail($m) { W "FAIL: $m"; exit 1 }

function Find-Exe {
  if ($Exe) { if (-not (Test-Path $Exe)) { Fail "--Exe 不存在: $Exe" }; return (Resolve-Path $Exe).Path }
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

if ($VerifyOnly) {
  $code = Invoke-Verify
  exit $code
}

# ── 0. 插件（引擎层补丁来源）────────────────────────────────────────────────
if (-not (Test-Path $pluginDir)) {
  W '安装 dsh-purge-community ...'
  New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
  & $nodeExe $pnpmMjs --dir $profileDir add $PluginUrl 2>&1 | ForEach-Object { W "  pnpm: $_" }
  if (-not (Test-Path $pluginDir)) { Fail '插件安装失败，检查网络或 -PluginUrl' }
  $pkgJson = Join-Path $profileDir 'package.json'
  $pkg = Get-Content $pkgJson -Raw | ConvertFrom-Json
  if (-not $pkg.dsh) { $pkg | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{ profile = [pscustomobject]@{ bundles = @() } }) -Force }
  $bundles = @($pkg.dsh.profile.bundles)
  if ($bundles -notcontains 'dsh-purge-community') {
    $pkg.dsh.profile.bundles = $bundles + 'dsh-purge-community'
    $pkg | ConvertTo-Json -Depth 12 | Set-Content $pkgJson -Encoding utf8
    W 'bundles 已补 dsh-purge-community'
  }
  W '插件已装。需要重启一次 DSH 让插件加载，然后重跑本脚本继续。'
  exit 0
}

# ── 1. 定制内容（提示词层 + 预设层）──────────────────────────────────────────
$payload = Join-Path $here 'payload'
if (-not (Test-Path (Join-Path $payload 'prompt-inject.md'))) {
  W '从 release 下载定制包 ...'
  $zip = Join-Path $env:TEMP 'dsh-unleashed-custom.zip'
  Invoke-WebRequest -Uri $CustomUrl -OutFile $zip -UseBasicParsing
  Expand-Archive $zip -DestinationPath $payload -Force
}
$inject = Join-Path $DshHome 'prompt-inject.md'
if (Test-Path $inject) { Copy-Item $inject "$inject.bak-$(Get-Date -Format yyyyMMdd-HHmmss)" -Force }
Copy-Item (Join-Path $payload 'prompt-inject.md') $inject -Force
W "提示词层 → $inject"
$presetsDst = Join-Path $DshHome '.agent-presets'
New-Item -ItemType Directory -Force -Path $presetsDst | Out-Null
foreach ($d in Get-ChildItem (Join-Path $payload 'presets') -Directory) {
  $t = Join-Path $presetsDst $d.Name
  if (Test-Path $t) { Copy-Item $t "$t.bak-$(Get-Date -Format yyyyMMdd-HHmmss)" -Recurse -Force }
  Copy-Item $d.FullName $t -Recurse -Force
  W "预设 → $t"
}

# ── 2. 引擎层 + 代码层：解包 / 补丁 / shim / 关更新 ─────────────────────────
$runner = Join-Path $here 'run-purge.mjs'
if (-not (Test-Path $runner)) { $runner = Join-Path $payload 'run-purge.mjs' }
if (-not (Test-Path $runner)) { Fail '缺少 run-purge.mjs' }
$args2 = @('--exe', $exePath)
if ($NoRestart) { $args2 += '--no-restart' }
& $nodeExe $runner @args2 2>&1 | ForEach-Object { W $_ }

# ── 3. 三层验证 ─────────────────────────────────────────────────────────────
if ($NoRestart) {
  W '未重启。重启宿主后再跑 -VerifyOnly 复验三层。'
  exit 0
}
Start-Sleep -Seconds 45   # 等宿主重启完成
W '三层验证 ...'
$code = Invoke-Verify
if ($code -ne 0) { W '有层未通，按上面每条的 fix 处理' }
exit $code
