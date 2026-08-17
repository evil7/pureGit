# PureGit one-click deploy script (Cloudflare Workers)
#
# Usage:
#   .\scripts\deploy.ps1             one-click: detect -> login -> create KV -> deploy
#   .\scripts\deploy.ps1 --update    git pull to latest, then re-deploy
#
# What it does (all steps are idempotent, safe to re-run):
#   1. (--update) git pull --ff-only
#   2. detect node / pnpm / wrangler (local node_modules\.bin first, then global)
#   3. pnpm install (only when node_modules is missing)
#   4. wrangler whoami -> if not logged in, wrangler login
#   5. generate worker\wrangler.jsonc from example when missing
#   6. create KV namespace SESSIONS + backfill its id into wrangler.jsonc (only when id is a placeholder)
#   7. wrangler secret put GITHUB_CLIENT_SECRET (only when not yet configured)
#   8. pnpm --filter web build, then wrangler deploy
#
# Note: kept ASCII-only so PowerShell 5.1 reads it correctly under the ANSI (GBK) codepage.
[CmdletBinding()]
param(
    [switch]$Update
)

$ErrorActionPreference = "Stop"

$RepoRoot  = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$WorkerDir = Join-Path $RepoRoot "worker"
$Config    = Join-Path $WorkerDir "wrangler.jsonc"

function Say([string]$Msg)  { Write-Host "==> $Msg" -ForegroundColor Green }
function Warn([string]$Msg) { Write-Host "!   $Msg" -ForegroundColor Yellow }
function Fail([string]$Msg) { Write-Host "x   $Msg" -ForegroundColor Red; exit 1 }

# 0. --update: pull latest
if ($Update) {
    Say "git pull to latest ..."
    git -C $RepoRoot pull --ff-only
    if ($LASTEXITCODE -ne 0) { Fail "git pull failed" }
}

# 1. detect node
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Node.js not found (>=20 required)" }
Say "node: $(node --version)"

# 2. detect pnpm (project locks pnpm workspace)
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Fail "pnpm not found; install from https://pnpm.io" }

# 3. install deps when missing
if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) {
    Say "pnpm install ..."
    Push-Location $RepoRoot
    pnpm install
    Pop-Location
}

# 4. detect wrangler (local node_modules\.bin first, then global)
$Wrangler = $null
$LocalWrangler = Join-Path $RepoRoot "node_modules\.bin\wrangler.cmd"
if (Test-Path $LocalWrangler) {
    $Wrangler = $LocalWrangler
}
elseif (Get-Command wrangler -ErrorAction SilentlyContinue) {
    $Wrangler = (Get-Command wrangler).Source
}
else {
    Fail "wrangler not found; run 'pnpm install' or 'npm i -g wrangler'"
}
Say "wrangler: $Wrangler"

# run wrangler inside worker dir so it picks up wrangler.jsonc
function Invoke-Wrangler([string[]]$Args) {
    Push-Location $WorkerDir
    try { & $Wrangler @Args } finally { Pop-Location }
}

# 5. login check
Invoke-Wrangler @("whoami") *> $null
if ($LASTEXITCODE -ne 0) {
    Warn "Not logged in to Cloudflare; launching browser login ..."
    Invoke-Wrangler @("login")
    if ($LASTEXITCODE -ne 0) { Fail "wrangler login failed" }
}

# 6. generate wrangler.jsonc from example when missing
if (-not (Test-Path $Config)) {
    Copy-Item (Join-Path $WorkerDir "wrangler.jsonc.example") $Config
    Say "Generated worker\wrangler.jsonc from example"
    Warn "Edit worker\wrangler.jsonc to fill GITHUB_CLIENT_ID / domain, then re-run"
}

# 7. create KV namespace + backfill id (only when id is still a placeholder like "id": "<...")
$RawConfig = Get-Content $Config -Raw
if ($RawConfig -match '"id"\s*:\s*"<') {
    Say "Creating KV namespace SESSIONS ..."
    $KvOut = Invoke-Wrangler @("kv", "namespace", "create", "SESSIONS") 2>&1 | Out-String
    $KvId = [regex]::Match($KvOut, "[0-9a-f]{32}").Value
    if (-not $KvId) {
        Write-Host $KvOut
        Fail "Failed to parse KV namespace id from wrangler output above"
    }
    Say "KV namespace id: $KvId"
    $RawConfig = [regex]::Replace($RawConfig, '"id"\s*:\s*"<[^"]*>"', ('"id": "' + $KvId + '"'))
    [System.IO.File]::WriteAllText($Config, $RawConfig, [System.Text.UTF8Encoding]::new($false))
    Say "Backfilled kv_namespaces id into wrangler.jsonc"
}

# 8. secret: GITHUB_CLIENT_SECRET (only when not yet configured)
$SecretList = Invoke-Wrangler @("secret", "list") 2>&1 | Out-String
if ($SecretList -notmatch "GITHUB_CLIENT_SECRET") {
    Warn "GITHUB_CLIENT_SECRET not configured; entering interactive (hidden) input ..."
    Invoke-Wrangler @("secret", "put", "GITHUB_CLIENT_SECRET")
    if ($LASTEXITCODE -ne 0) { Fail "secret put failed" }
}

# 9. build frontend + deploy worker
Say "Building frontend (pnpm --filter web build) ..."
Push-Location $RepoRoot
pnpm --filter web build
Pop-Location
Say "Deploying Worker (wrangler deploy) ..."
Invoke-Wrangler @("deploy")

Say "Deploy completed."
