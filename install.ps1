<#
================================================================================
  Orion Copy Server - one-shot install for a WINDOWS host running BOTH the
  backend and the game server on the same box.

      Right-click PowerShell -> Run as administrator
      cd <this folder>
      Copy-Item .env.example .env ; notepad .env
      .\install.ps1

  Idempotent: re-run after editing .env. Flags:
      -NoBuild       skip dotnet publish (just re-apply config + restart)
      -NoFirewall    don't touch Windows Firewall
      -NoDashboardUi skip the Next.js dashboard UI (npm install + build + task)
      -Status        show what's running and exit
      -Uninstall     stop + remove the services (leaves data)

  Game-server binaries are NOT shipped here: place your compatible game build
  under windows\game\ and your payload DLL next to server.config.psd1
  (see windows\server.config.psd1.example and docs\GAME-SERVERS.md).
================================================================================
#>
[CmdletBinding()]
param(
    [switch] $NoBuild,
    [switch] $NoFirewall,
    [switch] $NoDashboardUi,
    [switch] $Status,
    [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Ok  ($m) { Write-Host "[ok]   $m" -ForegroundColor Green }
function Inf ($m) { Write-Host "[info] $m" -ForegroundColor Cyan }
function Wrn ($m) { Write-Host "[warn] $m" -ForegroundColor Yellow }
function Die ($m) { Write-Host "[err]  $m" -ForegroundColor Red; exit 1 }

# -- admin check (urlacl + firewall + service install all need it) -------------
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Die "Run this from an ELEVATED PowerShell (Run as administrator)." }

$BackendDir  = Join-Path $PSScriptRoot 'backend'
$PublishDir  = Join-Path $PSScriptRoot 'run\backend'
$GameDir     = Join-Path $PSScriptRoot 'windows'
$DashUiDir   = Join-Path $BackendDir  'dashboard'
$TaskBackend = 'OrionCopyServer'
$TaskDashUi  = 'OrionCopyServerDashboardUi'

# -- status / uninstall -------------------------------------------------------
if ($Status) {
    Inf "scheduled task:"
    Get-ScheduledTask -TaskName $TaskBackend,$TaskDashUi -ErrorAction SilentlyContinue |
        Select-Object TaskName,State | Format-Table -AutoSize
    Inf "backend process:"; Get-Process AUnrealFeatures.Ares -ErrorAction SilentlyContinue |
        Select-Object Id,ProcessName | Format-Table -AutoSize
    Inf "game servers:";    Get-Process A2-Win64-Shipping -ErrorAction SilentlyContinue |
        Select-Object Id,@{n='Started';e={$_.StartTime}} | Format-Table -AutoSize
    Inf "dashboard UI:";  Get-Process node -ErrorAction SilentlyContinue |
        Select-Object Id,ProcessName | Format-Table -AutoSize
    Inf "listening:"
    Get-NetTCPConnection -State Listen -EA SilentlyContinue |
        Where-Object LocalPort -in 50,78,80,90,3000,8080 |
        Select-Object LocalAddress,LocalPort -Unique | Format-Table -AutoSize
    Get-NetUDPEndpoint -EA SilentlyContinue | Where-Object { $_.LocalPort -ge 7777 -and $_.LocalPort -le 7787 } |
        Select-Object LocalAddress,LocalPort -Unique | Format-Table -AutoSize
    exit 0
}
if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskBackend -Confirm:$false -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskDashUi  -Confirm:$false -ErrorAction SilentlyContinue
    Get-Process AUnrealFeatures.Ares,A2-Win64-Shipping -EA SilentlyContinue | Stop-Process -Force
    # Only kill the node that is serving OUR dashboard, not every node on the box.
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -EA SilentlyContinue |
        Where-Object { $_.CommandLine -like '*next*start*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }
    Ok "stopped + removed (data left in run\)"; exit 0
}

# -- read .env ----------------------------------------------------------------
if (-not (Test-Path .env)) { Die "No .env. Run:  Copy-Item .env.example .env ; notepad .env" }
$cfg = @{}
Get-Content .env | ForEach-Object {
    $l = $_.Trim()
    if ($l -and -not $l.StartsWith('#') -and $l.Contains('=')) {
        $k,$v = $l.Split('=',2)
        # Strip INLINE comments ("KEY=value   # comment"); split on whitespace-then-#
        # so a '#' inside an actual value is left alone.
        $v = ($v -split '\s+#', 2)[0].Trim()
        if ($v.Length -ge 2 -and (($v[0] -eq '"' -and $v[-1] -eq '"') -or ($v[0] -eq "'" -and $v[-1] -eq "'"))) {
            $v = $v.Substring(1, $v.Length - 2)
        }
        $cfg[$k.Trim()] = $v
    }
}
function C($k,$d=$null){ if($cfg.ContainsKey($k) -and $cfg[$k]){$cfg[$k]}else{$d} }
function IsPlaceholder($v) {
    return (-not $v) -or ($v -like 'CHANGE_ME*') -or ($v -like 'YOUR_*') -or ($v -like '<FILL_ME*')
}

$PublicHost = C 'ORION_PUBLIC_HOST'
if (IsPlaceholder $PublicHost) {
    try { $PublicHost = (Invoke-RestMethod 'https://api.ipify.org?format=json' -TimeoutSec 10).ip
          Wrn "ORION_PUBLIC_HOST not set in .env; detected $PublicHost" } catch { Die "Set ORION_PUBLIC_HOST in .env" }
}
$Domain = C 'ORION_DOMAIN'

# -- validate required secrets (fail safe: never run on placeholders) ----------
$required = @('ORION_SERVER_API_KEY','ORION_DASHBOARD_API_KEY','ORION_DASHBOARD_ADMIN_KEY',
              'ORION_DASHBOARD_SESSION_SECRET','ORION_AUTOMATION_KEY')
$bad = @()
foreach ($k in $required) { if (IsPlaceholder (C $k)) { $bad += $k } }
if ($bad.Count -gt 0) {
    Die ("These .env values are still placeholders: " + ($bad -join ', ') + ". Generate real ones (openssl rand -hex 32) and re-run.")
}
if (IsPlaceholder (C 'ORION_META_APP_SECRET')) {
    Wrn "ORION_META_APP_SECRET is not set - platform attestation WILL fail and clients cannot log in."
}
if (IsPlaceholder (C 'ORION_JWT_SECRET')) {
    Wrn "ORION_JWT_SECRET is not set - a random one is generated per run (sessions don't survive restarts)."
}
# -- generated secrets (persisted into .env on first run) ----------------------
# The database password and agent key must never be a known default. When still
# placeholders, generate strong random values and write them back into .env so
# re-runs are stable. They are never printed.
function New-RandomHex($bytes = 32) {
    $b = New-Object byte[] $bytes
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    return ([BitConverter]::ToString($b) -replace '-','').ToLowerInvariant()
}
function Ensure-Generated($name) {
    if (IsPlaceholder (C $name)) {
        $val = New-RandomHex
        $lines = Get-Content .env
        $done = $false
        $lines = $lines | ForEach-Object {
            if ($_ -match "^$name=") { $done = $true; "$name=$val" } else { $_ }
        }
        if (-not $done) { $lines += "$name=$val" }
        Set-Content .env $lines
        $cfg[$name] = $val
        Ok "generated $name and saved it into .env (not shown)"
    }
}
Ensure-Generated 'ORION_DB_PASSWORD'
Ensure-Generated 'ORION_AGENT_KEY'

$ApiKey   = C 'ORION_SERVER_API_KEY'
$DashKey  = C 'ORION_DASHBOARD_API_KEY'
$Build    = C 'ORION_BUILD_VERSION' '22284'
$P_MS     = [int](C 'ORION_BACKEND_PORT_MOTHERSHIP' 90)
$P_SD     = [int](C 'ORION_BACKEND_PORT_STATIONDB'  78)
$P_EOS    = [int](C 'ORION_BACKEND_PORT_EOS'        50)
$P_WS     = [int](C 'ORION_BACKEND_PORT_EOS_WS'     80)
$P_DASH   = [int](C 'ORION_BACKEND_PORT_DASHBOARD'  8080)
$P_DASHUI = [int](C 'ORION_BACKEND_PORT_DASHBOARD_UI' 3000)
$UdpFirst = [int](C 'ORION_GAME_UDP_FIRST'  7777)
$UdpLast  = [int](C 'ORION_GAME_UDP_LAST'   7787)
if ((C 'ORION_INSTALL_DASHBOARD_UI' '1') -ne '1') { $NoDashboardUi = $true }

if ((C 'ORION_INSECURE' '0') -eq '1' -or (C 'MOTHERSHIP_INSECURE' '0') -eq '1') {
    Wrn "ORION_INSECURE=1 disables ALL identity checks (open auth bypass)."
    if ((Read-Host "Continue anyway? [y/N]") -ne 'y') { exit 1 }
}

# EOS public host: explicit env wins, else orion-eos.<domain>, else the public host.
$EosHost = C 'ORION_EOS_HOST'
if (-not $EosHost) {
    if ($Domain) { $EosHost = "orion-eos.$Domain" } else { $EosHost = $PublicHost }
}

# -- bind policy --------------------------------------------------------------
# Tunnel/proxy installs keep everything on loopback (secure default). Raw-IP
# installs (no tunnel) must bind the CLIENT-FACING services publicly or nobody
# can reach them; management services stay on loopback regardless.
# NOTE: .env.example ships ORION_PUBLIC_BIND=127.0.0.1, so "is it set" is not a
# sufficient test -- loopback-like values must also be upgraded for raw-IP mode.
$TunnelName = C 'TUNNEL_NAME'
$UsePublicBind = (-not $TunnelName)
$pubBind = C 'ORION_PUBLIC_BIND'
if ($UsePublicBind -and ((-not $pubBind) -or ($pubBind -eq '127.0.0.1') -or ($pubBind -eq 'localhost'))) {
    $cfg['ORION_PUBLIC_BIND'] = '0.0.0.0'
    Wrn "No tunnel configured: binding client-facing services to 0.0.0.0 (ORION_PUBLIC_BIND)."
    Wrn "  Management ports stay on loopback. Restrict service ports by firewall (see below)."
} elseif ($UsePublicBind) {
    Inf "client-facing services bind to $($cfg['ORION_PUBLIC_BIND']) (explicit ORION_PUBLIC_BIND kept)"
}

# -- .NET ---------------------------------------------------------------------
$dotnet = (Get-Command dotnet -EA SilentlyContinue).Source
if (-not $dotnet) {
    Inf "installing .NET 6 SDK..."
    $ps1 = Join-Path $env:TEMP 'dotnet-install.ps1'
    Invoke-WebRequest 'https://dot.net/v1/dotnet-install.ps1' -OutFile $ps1 -UseBasicParsing
    & $ps1 -Channel 6.0 -InstallDir "$env:ProgramFiles\dotnet"
    $env:PATH = "$env:ProgramFiles\dotnet;$env:PATH"
    $dotnet = (Get-Command dotnet -EA SilentlyContinue).Source
}
if (-not $dotnet) { Die ".NET install failed" }
Ok "dotnet: $dotnet"

# -- apply .env into the backend sources --------------------------------------
# Secrets are env-driven now, so there is nothing to patch into C# constants.
# The only build-time value is the EOS public host inside the embedded endpoint
# tables: substitute the __ORION_EOS_HOST__ token before publishing.
function Apply-EnvToSource {
    $eosFiles = @(
        (Join-Path $BackendDir 'src\AUnrealFeatures.EOSSDK\AUnrealFeatures.EOSSDK\Responses\custom_endpoints.json'),
        (Join-Path $BackendDir 'src\AUnrealFeatures.EOSSDK\AUnrealFeatures.EOSSDK\Responses\default_endpoints.json')
    )
    foreach ($f in $eosFiles) {
        if (-not (Test-Path $f)) { Wrn "missing $f; skipping"; continue }
        $t = Get-Content $f -Raw
        if ($t.Contains('__ORION_EOS_HOST__')) {
            $t = $t.Replace('__ORION_EOS_HOST__', $EosHost)
            Set-Content $f $t -NoNewline
            Ok "pointed $(Split-Path -Leaf $f) at $EosHost"
        }
        $turnHost = C 'ORION_TURN_HOST'
        if ($turnHost -and -not (IsPlaceholder $turnHost) -and $t.Contains('__ORION_TURN_HOST__')) {
            $t = $t.Replace('__ORION_TURN_HOST__', $turnHost)
            Set-Content $f $t -NoNewline
            Ok "pointed $(Split-Path -Leaf $f) TURN at $turnHost"
        }
    }
    # Never ship a seeded ghost station, and drop stale persisted sessions.
    $mm = Join-Path $BackendDir 'src\AUnrealFeatures.EOSSDK\AUnrealFeatures.EOSSDK\Responses\matchmaking.json'
    if ((Test-Path $mm) -and ((Get-Content $mm -Raw) -match '"sessions"\s*:\s*\[\s*\{')) {
        Wrn "matchmaking.json seeds a fake session - emptying"
        $empty = @('{','    "count": 0,','    "sessions": []','}') -join "`r`n"
        Set-Content $mm $empty
    }
    Remove-Item (Join-Path $PublishDir 'sessions.json'),(Join-Path $PublishDir 'lobbies.json') -EA SilentlyContinue
}

if (-not $NoBuild) {
    Inf "applying .env into backend sources..."
    Apply-EnvToSource
    Inf "publishing backend (takes a minute)..."
    & $dotnet publish (Join-Path $BackendDir 'src\AUnrealFeatures.Ares') -c Release -o $PublishDir --nologo -v q
    if ($LASTEXITCODE -ne 0) { Die "dotnet publish failed" }
    Ok "published -> $PublishDir"
}

# -- backend launch wrapper (scheduled tasks cannot carry env vars) ------------
# All backend configuration travels as ORION_* environment variables, set here
# from .env at install time. Re-run the installer after editing .env.
New-Item -ItemType Directory -Path $PublishDir -Force | Out-Null
$backendCmd = Join-Path $PSScriptRoot 'run\backend.cmd'
$envLines = @('@echo off', 'REM Generated by install.ps1 - re-run it to regenerate.')
foreach ($k in ($cfg.Keys | Sort-Object)) {
    if ($k -like 'ORION_*' -or $k -like 'MOTHERSHIP_*' -or $k -like 'DASHBOARD_*' -or $k -like 'BOARD_*' -or $k -like 'STATION_*') {
        $envLines += "set $k=$($cfg[$k])"
    }
}
$envLines += "set ORION_EOS_HOST=$EosHost"
$envLines += "set ORION_BUILD_VERSION=$Build"
$envLines += 'cd /d "%~dp0backend"'
$envLines += 'dotnet "%~dp0backend\AUnrealFeatures.Ares.dll"'
$envLines -join "`r`n" | Set-Content -LiteralPath $backendCmd -Encoding ASCII
Ok "wrote run\backend.cmd (env from .env)"

# -- low-port reservations (50/78/80/90 are privileged on Windows) ------------
Inf "reserving low ports (urlacl)..."
$who = "$env:USERDOMAIN\$env:USERNAME"
foreach ($p in @($P_EOS,$P_SD,$P_WS,$P_MS,$P_DASH)) {
    netsh http delete urlacl url="http://+:$p/" 2>&1 | Out-Null
    netsh http add urlacl url="http://+:$p/" user="$who" 2>&1 | Out-Null
}
Ok "urlacl set for $P_EOS,$P_SD,$P_WS,$P_MS,$P_DASH"

# -- firewall -----------------------------------------------------------------
# Public by default: game UDP only, plus client-facing service TCP in raw-IP
# mode. StationDb (:78, open self-registration) is NEVER opened unless
# ORION_EXPOSE_STATIONDB=1, optionally scoped to ORION_STATIONDB_CIDR.
# Dashboard (:8080) and orchestrator (9095/9100) are never opened -- use a tunnel.
if (-not $NoFirewall -and (C 'ORION_MANAGE_FIREWALL' '1') -eq '1') {
    Inf "configuring Windows Firewall..."
    foreach ($n in 'Orion Copy Server (TCP)','Orion Copy Server Game (UDP)','Orion Copy Server StationDb (TCP)') {
        Remove-NetFirewallRule -DisplayName $n -EA SilentlyContinue
    }
    $publicTcp = @()
    if ($UsePublicBind) { $publicTcp += $P_MS,$P_EOS,$P_WS }
    New-NetFirewallRule -DisplayName 'Orion Copy Server Game (UDP)' -Direction Inbound -Action Allow `
        -Protocol UDP -LocalPort "$UdpFirst-$UdpLast" -Profile Any | Out-Null
    if ($publicTcp.Count -gt 0) {
        New-NetFirewallRule -DisplayName 'Orion Copy Server (TCP)' -Direction Inbound -Action Allow `
            -Protocol TCP -LocalPort $publicTcp -Profile Any | Out-Null
        Ok "opened TCP $($publicTcp -join ',') and UDP $UdpFirst-$UdpLast"
    } else {
        Ok "opened UDP $UdpFirst-$UdpLast (tunnel mode: service ports stay on loopback)"
    }
    if ((C 'ORION_EXPOSE_STATIONDB' '0') -eq '1') {
        $cidr = C 'ORION_STATIONDB_CIDR'
        if ($cidr) {
            New-NetFirewallRule -DisplayName 'Orion Copy Server StationDb (TCP)' -Direction Inbound -Action Allow `
                -Protocol TCP -LocalPort $P_SD -RemoteAddress $cidr -Profile Any | Out-Null
            Ok "opened StationDb :$P_SD scoped to $cidr"
        } else {
            New-NetFirewallRule -DisplayName 'Orion Copy Server StationDb (TCP)' -Direction Inbound -Action Allow `
                -Protocol TCP -LocalPort $P_SD -Profile Any | Out-Null
            Wrn "opened StationDb :$P_SD to ANY remote address. Scope it with ORION_STATIONDB_CIDR."
        }
    } else {
        Wrn "StationDb :$P_SD NOT opened (ORION_EXPOSE_STATIONDB=0). Remote game servers need it:"
        Wrn "  set ORION_EXPOSE_STATIONDB=1 (+ ORION_STATIONDB_CIDR) and re-run, or keep game servers on this box."
    }
    Wrn "dashboard :$P_DASH and orchestrator 9095/9100 deliberately NOT opened."
    Wrn "  Reach the dashboard over an SSH/RDP tunnel. See docs\DASHBOARD.md."
}

# -- tunnel (reverse proxy) ----------------------------------------------------
# Optional: if your orion-* hostnames are routed through a tunnel, run it on THIS
# box so it reaches the backend over loopback. No inbound service ports needed.
$TunnelName = C 'TUNNEL_NAME'
$TunnelCreds = C 'TUNNEL_CREDENTIALS'
if ($TunnelName) {
    if (-not $Domain) { Wrn "TUNNEL_NAME is set but ORION_DOMAIN is empty - skipping tunnel setup." }
    elseif (-not $TunnelCreds -or -not (Test-Path $TunnelCreds)) {
        Wrn "TUNNEL_NAME='$TunnelName' but TUNNEL_CREDENTIALS is missing/not found. Skipping tunnel setup."
    } else {
        $cfDir = Join-Path $PSScriptRoot 'run\cloudflared'
        New-Item -ItemType Directory -Force -Path $cfDir | Out-Null
        $cfExe = Join-Path $cfDir 'cloudflared.exe'
        if (-not (Test-Path $cfExe)) {
            Inf "downloading cloudflared..."
            try {
                Invoke-WebRequest 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' `
                    -OutFile $cfExe -UseBasicParsing
            } catch { Wrn "cloudflared download failed: $($_.Exception.Message)" }
        }
        if (Test-Path $cfExe) {
            $cfCredDst = Join-Path $cfDir ([IO.Path]::GetFileName($TunnelCreds))
            Copy-Item $TunnelCreds $cfCredDst -Force
            $cfYml = Join-Path $cfDir 'config.yml'
            @(
                "tunnel: $TunnelName"
                "credentials-file: $cfCredDst"
                ""
                "ingress:"
                "  - hostname: orion-ms.$($Domain)"
                "    service: http://127.0.0.1:$P_MS"
                "  - hostname: orion.$($Domain)"
                "    service: http://127.0.0.1:$P_SD"
                "  - hostname: orion-eos.$($Domain)"
                "    service: http://127.0.0.1:$P_EOS"
                "  - service: http_status:404"
            ) -join "`r`n" | Set-Content $cfYml -Encoding ASCII
            Ok "wrote $cfYml"

            & $cfExe service uninstall 2>&1 | Out-Null
            & $cfExe --config $cfYml service install 2>&1 | Out-Null
            Start-Sleep -Seconds 2
            $svc = Get-Service cloudflared -EA SilentlyContinue
            if ($svc) {
                Start-Service cloudflared -EA SilentlyContinue
                Start-Sleep -Seconds 3
                $svc = Get-Service cloudflared -EA SilentlyContinue
                Ok "cloudflared service: $($svc.Status)"
            } else {
                Wrn "cloudflared service not registered; run manually to debug:"
                Wrn "  `"$cfExe`" --config `"$cfYml`" tunnel run $TunnelName"
            }
            Wrn "If this tunnel also runs elsewhere, STOP the other replica now, or"
            Wrn "  requests will load-balance between backends and fail intermittently."
        }
    }
}

# -- run the backend (scheduled task = survives logoff, autostarts on boot) ---
Inf "registering '$TaskBackend' to run at startup..."
Unregister-ScheduledTask -TaskName $TaskBackend -Confirm:$false -EA SilentlyContinue
$act = New-ScheduledTaskAction -Execute $backendCmd -WorkingDirectory $PublishDir
$trg = New-ScheduledTaskTrigger -AtStartup
$pri = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskBackend -Action $act -Trigger $trg -Principal $pri -Settings $set | Out-Null

Get-Process AUnrealFeatures.Ares -EA SilentlyContinue | Stop-Process -Force
Start-ScheduledTask -TaskName $TaskBackend
Start-Sleep -Seconds 6

$listening = Get-NetTCPConnection -State Listen -EA SilentlyContinue |
             Where-Object LocalPort -in $P_MS,$P_SD,$P_EOS,$P_DASH |
             Select-Object -Expand LocalPort -Unique | Sort-Object
if ($listening) { Ok "backend listening on: $($listening -join ', ')" }
else { Wrn "backend not listening yet - check: Get-Content '$PublishDir\logs\*.txt' -Tail 40" }

# -- root certificates for the game server's HTTPS calls ----------------------
# The game build ships no CA bundle, so its HTTP stack verifies against the WINDOWS
# root store. A fresh Windows Server image carries a minimal root set; import the
# bundled roots so outbound TLS (backend registration, quest fetch) can validate.
$certDir = Join-Path $GameDir 'certs'
if (Test-Path $certDir) {
    foreach ($cf in Get-ChildItem $certDir -Filter '*.cer' -EA SilentlyContinue) {
        try {
            $c  = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $cf.FullName
            $have = Get-ChildItem Cert:\LocalMachine\Root -EA SilentlyContinue |
                    Where-Object Thumbprint -eq $c.Thumbprint
            if ($have) { Inf "root CA already trusted: $($cf.BaseName)" }
            else {
                Import-Certificate -FilePath $cf.FullName -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
                Ok "installed root CA: $($cf.BaseName) ($($c.Thumbprint))"
            }
        } catch { Wrn "could not install $($cf.Name): $($_.Exception.Message)" }
    }
}

# -- Next.js dashboard UI (optional, nicer front-end for the same :8080 API) --
# The backend already serves a static UI on :8080. This is the richer React one in
# backend\dashboard. It is a PROXY only: /auth rewrites to :$P_DASH and the API routes
# attach the admin key server-side, so it holds no secrets of its own.
$DashUiReady = $false
if ($NoDashboardUi) {
    Inf "dashboard UI skipped (-NoDashboardUi / ORION_INSTALL_DASHBOARD_UI=0)"
} elseif (-not (Test-Path (Join-Path $DashUiDir 'package.json'))) {
    Wrn "no backend\dashboard\package.json - skipping the Next.js UI"
} else {
    $npm  = (Get-Command npm.cmd -EA SilentlyContinue).Source
    $node = (Get-Command node.exe -EA SilentlyContinue).Source
    if (-not $npm -or -not $node) {
        Wrn "Node.js not found - skipping the Next.js dashboard UI."
        Wrn "  Install it, then re-run this script:   winget install OpenJS.NodeJS.LTS"
        Wrn "  (open a NEW shell afterwards so PATH picks it up)"
        Wrn "  The backend's own UI on :$P_DASH works without Node."
    } else {
        $nodeMajor = 0
        if ((& $node -v) -match '^v(\d+)') { $nodeMajor = [int]$Matches[1] }
        if ($nodeMajor -lt 20) {
            Wrn "Node $(& $node -v) is too old for Next 16 (needs >=20) - skipping the dashboard UI."
        } else {
            Inf "building the dashboard UI (Node $(& $node -v); first run takes a few minutes)..."
            Push-Location $DashUiDir
            try {
                & $npm 'ci' '--no-audit' '--no-fund' 2>&1 | Out-Null
                if ($LASTEXITCODE -ne 0) { & $npm 'install' '--no-audit' '--no-fund' 2>&1 | Out-Null }
                if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)" }
                $env:BACKEND_HOST      = '127.0.0.1'
                $env:DASHBOARD_API_PORT = "$P_DASH"
                $env:STATION_API_PORT   = "$P_SD"
                & $npm 'run' 'build'
                if ($LASTEXITCODE -ne 0) { throw "next build failed (exit $LASTEXITCODE)" }
                $DashUiReady = $true
            } catch {
                Wrn "dashboard UI build failed: $($_.Exception.Message)"
                Wrn "  the backend UI on :$P_DASH is unaffected; retry with .\install.ps1 -NoBuild"
            } finally { Pop-Location }
        }
    }
}

if ($DashUiReady) {
    $wrapper = Join-Path $PSScriptRoot 'run\dashboard-ui.cmd'
    New-Item -ItemType Directory -Path (Split-Path $wrapper) -Force | Out-Null
    # Pass every ORION_* value from .env so the UI sees the same configuration
    # as the backend (origins, keys, optional store). Re-run to regenerate.
    # Port-derived origins follow custom ORION_BACKEND_PORT_* unless the operator
    # set an explicit (non-default) origin for split layouts.
    $uiCfg = @{}
    foreach ($k in $cfg.Keys) { $uiCfg[$k] = $cfg[$k] }
    if (-not $uiCfg['ORION_DASHBOARD_API_ORIGIN'] -or $uiCfg['ORION_DASHBOARD_API_ORIGIN'] -eq 'http://127.0.0.1:8080') {
        $uiCfg['ORION_DASHBOARD_API_ORIGIN'] = "http://127.0.0.1:$P_DASH"
    }
    if (-not $uiCfg['ORION_STATIONDB_ORIGIN'] -or $uiCfg['ORION_STATIONDB_ORIGIN'] -eq 'http://127.0.0.1:78') {
        $uiCfg['ORION_STATIONDB_ORIGIN'] = "http://127.0.0.1:$P_SD"
    }
    $uiLines = @('@echo off', 'REM Generated by install.ps1 - re-run it to regenerate. Serves the Next.js dashboard UI.')
    foreach ($k in ($uiCfg.Keys | Sort-Object)) {
        if ($k -like 'ORION_*' -or $k -like 'DASHBOARD_*' -or $k -like 'OPERATOR_STORE_*' -or $k -like 'UPSTASH_*' -or $k -like 'GAME_API_*') {
            $uiLines += "set $k=$($uiCfg[$k])"
        }
    }
    $uiLines += @(
        'set BACKEND_HOST=127.0.0.1'
        "set PORT=$P_DASHUI"
        'set HOSTNAME=127.0.0.1'
        "cd /d `"$DashUiDir`""
        "`"$node`" `"node_modules\next\dist\bin\next`" start -p $P_DASHUI -H 127.0.0.1"
    )
    $uiLines -join "`r`n" | Set-Content -LiteralPath $wrapper -Encoding ASCII

    Inf "registering '$TaskDashUi' to run at startup..."
    Unregister-ScheduledTask -TaskName $TaskDashUi -Confirm:$false -EA SilentlyContinue
    $dAct = New-ScheduledTaskAction -Execute $wrapper -WorkingDirectory $DashUiDir
    $dTrg = New-ScheduledTaskTrigger -AtStartup
    $dPri = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $dSet = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                                         -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $TaskDashUi -Action $dAct -Trigger $dTrg -Principal $dPri -Settings $dSet | Out-Null

    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -EA SilentlyContinue |
        Where-Object { $_.CommandLine -like '*next*start*' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }
    Start-ScheduledTask -TaskName $TaskDashUi
    Start-Sleep -Seconds 8
    # -H 127.0.0.1 binds LOOPBACK ONLY. Reach it over RDP or an SSH tunnel, never
    # directly from the internet.
    if (Get-NetTCPConnection -State Listen -LocalPort $P_DASHUI -EA SilentlyContinue) {
        Ok "dashboard UI listening on 127.0.0.1:$P_DASHUI (loopback only)"
    } else {
        Wrn "dashboard UI did not bind :$P_DASHUI yet - check: Get-ScheduledTask $TaskDashUi | Get-ScheduledTaskInfo"
    }
}

# -- pair the GAME SERVER to this same box -----------------------------------
# Both roles are on one machine, so the game server talks to the backend over
# LOOPBACK (plain HTTP, no TLS, no proxy round-trip). Only RegisterIp must
# be the PUBLIC address, because that is what clients are told to connect to.
$gameCfgExample = Join-Path $GameDir 'server.config.psd1.example'
$gameCfg = Join-Path $GameDir 'server.config.psd1'
if (-not (Test-Path $gameCfg) -and (Test-Path $gameCfgExample)) {
    Copy-Item $gameCfgExample $gameCfg
    Inf "created windows\server.config.psd1 from the example - review it before starting servers"
}
if (Test-Path $gameCfg) {
    $g = Get-Content $gameCfg -Raw
    $g = $g -replace "DashboardApiUrl = '[^']*'", "DashboardApiUrl = 'http://127.0.0.1:$P_SD'"
    $g = $g -replace "RegisterIp = '[^']*'",      "RegisterIp = '$PublicHost'"
    $g = $g -replace "'-MothershipHost=[^']*'",   "'-MothershipHost=127.0.0.1'"
    $g = $g -replace "'-MothershipPort=[^']*'",   "'-MothershipPort=$P_MS'"
    $g = $g -replace "'-BackendHost=[^']*'",      "'-BackendHost=127.0.0.1'"
    $g = $g -replace "'-BackendPort=[^']*'",      "'-BackendPort=$P_SD'"
    if ($ApiKey) {
        if ($g -match "'-ServerApiKey=") { $g = $g -replace "'-ServerApiKey=[^']*'", "'-ServerApiKey=$ApiKey'" }
        else { $g = $g -replace "(\s*)'-BackendPort=[^']*'", "`$0`$1'-ServerApiKey=$ApiKey'" }
    }
    if ($DashKey) {
        $g = $g -replace "DashboardApiKey = '[^']*'", "DashboardApiKey = '$DashKey'"
    }
    Set-Content $gameCfg $g -NoNewline
    Ok "paired windows\server.config.psd1 to this box (backend over 127.0.0.1, RegisterIp=$PublicHost)"
}

@"

--------------------------------------------------------------------------
 Orion Copy Server installed (backend + game server on this one Windows box).

   backend status : .\install.ps1 -Status
   backend logs   : $PublishDir\logs\
   restart backend: Restart-ScheduledTask -TaskName $TaskBackend
   restart dash UI: Restart-ScheduledTask -TaskName $TaskDashUi

 START A GAME SERVER (registers itself and appears in the browser):
   cd windows
   .\Start-Server.ps1

 Clients reach you at : $PublicHost  (UDP $UdpFirst-$UdpLast must be open)

 DASHBOARDS (both LOCAL ONLY - do not expose either port):
   Full UI (React)    : http://127.0.0.1:$P_DASHUI $(if(-not $DashUiReady){'  <-- NOT RUNNING, see warnings above'})
   Basic UI + API     : http://127.0.0.1:$P_DASH
   From your own PC   : ssh -L ${P_DASHUI}:127.0.0.1:$P_DASHUI -L ${P_DASH}:127.0.0.1:$P_DASH Administrator@$PublicHost
                        ...or just open it in a browser over RDP.
--------------------------------------------------------------------------
"@ | Write-Host
