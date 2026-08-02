$ErrorActionPreference = 'SilentlyContinue'

$projectDir = Split-Path -Parent $PSScriptRoot
$pidDir = Join-Path $projectDir '.preview\pids'
$serverPidFile = Join-Path $pidDir 'server.pid'
$tunnelPidFile = Join-Path $pidDir 'cloudflared.pid'

function Stop-FromFile([string]$pidFile) {
  if (-not (Test-Path -LiteralPath $pidFile)) { return }
  $raw = (Get-Content -LiteralPath $pidFile | Select-Object -First 1).Trim()
  if (-not $raw) { return }
  try {
    Stop-Process -Id ([int]$raw) -Force
  } catch {
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

Stop-FromFile $tunnelPidFile
Stop-FromFile $serverPidFile

Write-Host ''
Write-Host 'Cloudflare Tunnel and local preview stopped.' -ForegroundColor Cyan
