$ErrorActionPreference = 'Stop'

$projectDir = Split-Path -Parent $PSScriptRoot
$previewDir = Join-Path $projectDir '.preview'
$toolDir = Join-Path $projectDir '.tools'
$logDir = Join-Path $previewDir 'logs'
$pidDir = Join-Path $previewDir 'pids'
$cloudflaredPath = Join-Path $toolDir 'cloudflared.exe'
$pythonBundled = 'C:\Users\HP\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$port = 8765
$localUrl = "http://127.0.0.1:$port/"
$targetFile = Join-Path $projectDir '利用者チェック表.html'
$serverLog = Join-Path $logDir 'server.log'
$serverErr = Join-Path $logDir 'server-error.log'
$tunnelLog = Join-Path $logDir 'cloudflared.log'
$serverPidFile = Join-Path $pidDir 'server.pid'
$tunnelPidFile = Join-Path $pidDir 'cloudflared.pid'
$publicUrlFile = Join-Path $previewDir 'public-url.txt'
$cloudflareDownload = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'

foreach ($dir in @($previewDir, $toolDir, $logDir, $pidDir)) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

function Get-AliveProcess([string]$pidFile) {
  if (-not (Test-Path -LiteralPath $pidFile)) { return $null }
  $raw = (Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
  if (-not $raw) { return $null }
  try {
    return Get-Process -Id ([int]$raw) -ErrorAction Stop
  } catch {
    return $null
  }
}

function Save-Pid([string]$pidFile, [int]$pid) {
  Set-Content -LiteralPath $pidFile -Value $pid -Encoding ascii
}

function Resolve-Python() {
  if (Get-Command py.exe -ErrorAction SilentlyContinue) { return @('py.exe', '-3') }
  if (Get-Command python.exe -ErrorAction SilentlyContinue) { return @('python.exe') }
  if (Test-Path -LiteralPath $pythonBundled) { return @($pythonBundled) }
  throw "Python not found. Install Python or confirm bundled path: $pythonBundled"
}

function Ensure-Cloudflared() {
  if (Test-Path -LiteralPath $cloudflaredPath) { return }
  Write-Host ''
  Write-Host 'Downloading cloudflared...' -ForegroundColor Yellow
  Invoke-WebRequest -Uri $cloudflareDownload -OutFile $cloudflaredPath
}

function Start-PreviewServer() {
  $existing = Get-AliveProcess $serverPidFile
  if ($existing) { return $existing }

  $pythonCommand = Resolve-Python
  $exe = $pythonCommand[0]
  $prefix = @()
  if ($pythonCommand.Count -gt 1) {
    $prefix = $pythonCommand[1..($pythonCommand.Count - 1)]
  }

  $args = @()
  $args += $prefix
  $args += '-m'
  $args += 'http.server'
  $args += "$port"
  $args += '--bind'
  $args += '127.0.0.1'

  Remove-Item -LiteralPath $serverLog, $serverErr -Force -ErrorAction SilentlyContinue
  $proc = Start-Process -FilePath $exe -ArgumentList $args -WorkingDirectory $projectDir -RedirectStandardOutput $serverLog -RedirectStandardError $serverErr -PassThru -WindowStyle Hidden
  Save-Pid $serverPidFile $proc.Id

  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -Uri $localUrl -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $proc
      }
    } catch {
    }
  }

  throw "Could not start local preview server. Check $serverErr"
}

function Stop-RunningTunnel() {
  $existing = Get-AliveProcess $tunnelPidFile
  if ($existing) {
    Stop-Process -Id $existing.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
  }
}

function Start-Tunnel() {
  Stop-RunningTunnel
  Remove-Item -LiteralPath $tunnelLog, $publicUrlFile -Force -ErrorAction SilentlyContinue
  $proc = Start-Process -FilePath $cloudflaredPath -ArgumentList @('tunnel', '--url', $localUrl, '--no-autoupdate', '--logfile', $tunnelLog) -WorkingDirectory $projectDir -PassThru -WindowStyle Hidden
  Save-Pid $tunnelPidFile $proc.Id

  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    if (-not (Test-Path -LiteralPath $tunnelLog)) { continue }
    $match = Select-String -LiteralPath $tunnelLog -Pattern 'https://[a-zA-Z0-9.-]+trycloudflare\.com' -AllMatches -ErrorAction SilentlyContinue | Select-Object -Last 1
    if ($match) {
      $url = $match.Matches[-1].Value
      Set-Content -LiteralPath $publicUrlFile -Value $url -Encoding ascii
      return $url
    }
  }

  throw "Could not detect Cloudflare Tunnel URL. Check $tunnelLog"
}

Write-Host ''
Write-Host '=== Cloudflare Preview Start ===' -ForegroundColor Cyan
Write-Host "Target file: $targetFile"
Write-Host "Project dir: $projectDir"

Ensure-Cloudflared
$null = Start-PreviewServer
$publicUrl = Start-Tunnel

Write-Host ''
Write-Host 'Local URL' -ForegroundColor Green
Write-Host $localUrl
Write-Host ''
Write-Host 'Public URL' -ForegroundColor Green
Write-Host $publicUrl -ForegroundColor Yellow
Write-Host ''
Write-Host "Saved URL file: $publicUrlFile"
Write-Host ''
Write-Host 'Run stop_cloudflare_preview.bat when you want to stop.' -ForegroundColor Cyan
