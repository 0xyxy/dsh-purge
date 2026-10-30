# 关宿主 → 挪走 app.asar → 以解包目录重启；启动失败自动回滚
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$Resources
)
$ErrorActionPreference = 'SilentlyContinue'
$log = Join-Path $env:DSH_HOME 'dsh-purge\swap-restart.log'
if (-not (Test-Path (Split-Path $log))) { New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null }
function W($m) { ("{0} {1}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $m) | Out-File -FilePath $log -Append -Encoding utf8 }

$asar   = Join-Path $Resources 'app.asar'
$bak    = "$asar.bak"
$appDir = Join-Path $Resources 'app'
$procName = [System.IO.Path]::GetFileNameWithoutExtension($Exe)

W "=== begin | exe=$Exe | appDir=$(Test-Path $appDir) asar=$(Test-Path $asar) ==="
Start-Sleep -Seconds 2

W "closing $procName"
Get-Process -Name $procName | ForEach-Object { $_.CloseMainWindow() | Out-Null }
Start-Sleep -Seconds 4
Get-Process -Name $procName | Stop-Process -Force
for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 500; if (-not (Get-Process -Name $procName -ErrorAction SilentlyContinue)) { break } }
W "stopped=$(-not [bool](Get-Process -Name $procName -ErrorAction SilentlyContinue))"

if (-not (Test-Path $appDir)) { W 'FATAL: 解包目录不存在，按原样重启'; Start-Process $Exe; exit }

$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  try {
    if (Test-Path $bak) { Remove-Item -LiteralPath $bak -Force -ErrorAction Stop }
    Move-Item -LiteralPath $asar -Destination $bak -Force -ErrorAction Stop
    $ok = $true; break
  } catch { Start-Sleep -Milliseconds 500 }
}
W "swap ok=$ok asar=$(Test-Path $asar) bak=$(Test-Path $bak)"
if (-not $ok) { Start-Process $Exe; W 'swap 失败，按原样重启'; exit }

Start-Sleep -Seconds 1
W '从解包目录启动'
Start-Process -FilePath $Exe
Start-Sleep -Seconds 30
if (-not (Get-Process -Name $procName -ErrorAction SilentlyContinue)) {
  W 'BOOT FAILED -> 回滚'
  if (Test-Path $asar) { Remove-Item -LiteralPath $asar -Force }
  Move-Item -LiteralPath $bak -Destination $asar -Force
  Start-Process $Exe
  W '已回滚并用 app.asar 重启'
} else {
  W 'OK: 运行在解包目录上'
}
W '=== end ==='
