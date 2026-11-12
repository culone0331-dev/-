<#
.SYNOPSIS
    自宅AIサーバー (MINISFORUM MS-02 Ultra / Windows 11) 現状調査スクリプト【読み取り専用】

.DESCRIPTION
    第1段階「現状調査」の10項目を収集し、デスクトップにレポートを出力する。

    このスクリプトが「しないこと」:
      - サービス / コンテナ / プロセスの停止・起動・再起動
      - ファイル・レジストリ・ファイアウォール・ネットワーク設定の変更
      - ソフトウェアのインストール / アンインストール
      - NAS 上のファイルへの書き込み
      - 設定ファイルの中身（APIキー・パスワード・暗号化キー）の表示
    書き込むのは出力先フォルダ（既定: デスクトップ\ai-server-survey-<日時>）のみ。

    出力はすべて秘密情報のマスク処理 (Protect-Text) を通してから保存する。
    それでも共有前に report.txt を目視確認すること。

.PARAMETER OutputRoot
    レポートの出力先親フォルダ。既定はデスクトップ。

.PARAMETER NasHosts
    NAS の候補ホスト名 / IP。既定は Tailscale IP とホスト名。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\Invoke-AiServerSurvey.ps1
    （-ExecutionPolicy Bypass はこのプロセスだけに効き、システム設定は変更しない）
#>
[CmdletBinding()]
param(
    [string]$OutputRoot = [Environment]::GetFolderPath('Desktop'),
    [string[]]$NasHosts = @('dxp4800plus-c39', '100.116.226.85', 'DXP4800PLUS')
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

# ---------------------------------------------------------------------------
# 共通
# ---------------------------------------------------------------------------
$stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $OutputRoot "ai-server-survey-$stamp"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$report = Join-Path $outDir 'report.txt'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# 関連ソフトの検索キーワード
$Keywords = @('ollama', 'strata', 'open-webui', 'openwebui', 'webui', 'n8n', 'tailscale', 'docker', 'wsl', 'nvidia')
$KeywordRegex = ($Keywords | ForEach-Object { [regex]::Escape($_) }) -join '|'

function Protect-Text {
    <# 秘密情報らしき値をマスクする #>
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return $Text }
    $t = $Text
    # key=value / key: value / "key": "value"
    $t = [regex]::Replace($t,
        '(?i)("?(?:[a-z0-9_\-]*?(?:api[_\-]?key|apikey|token|secret|password|passwd|pwd|encryption[_\-]?key|auth[_\-]?key|private[_\-]?key|client[_\-]?secret|cookie|session)[a-z0-9_\-]*)"?\s*[:=]\s*)("[^"]*"|''[^'']*''|\S+)',
        '$1***REDACTED***')
    # 既知のトークン形式
    $t = [regex]::Replace($t, 'tskey-[A-Za-z0-9\-_]+', 'tskey-***REDACTED***')
    $t = [regex]::Replace($t, '(?i)\b(sk|pk|rk)-[A-Za-z0-9\-_]{16,}', '$1-***REDACTED***')
    $t = [regex]::Replace($t, '(?i)Bearer\s+[A-Za-z0-9\-\._~\+/]+=*', 'Bearer ***REDACTED***')
    $t = [regex]::Replace($t, 'eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]+', '***JWT-REDACTED***')
    return $t
}

function Write-Report {
    param([Parameter(ValueFromPipeline = $true)]$InputObject)
    process {
        if ($null -eq $InputObject) { return }
        $s = if ($InputObject -is [string]) { $InputObject } else { ($InputObject | Out-String -Width 250).TrimEnd() }
        $s = Protect-Text $s
        Add-Content -Path $report -Value $s -Encoding UTF8
        Write-Host $s
    }
}

function Write-Section {
    param([string]$Title)
    Write-Report ''
    Write-Report ('=' * 78)
    Write-Report "## $Title"
    Write-Report ('=' * 78)
}

function Invoke-Safe {
    <# スクリプトブロックを実行し、例外はレポートに記録して続行 #>
    param([string]$Label, [scriptblock]$Script)
    Write-Report ''
    Write-Report "--- $Label ---"
    try {
        # Format-Table 等の書式オブジェクトはまとめて文字列化する
        $text = (& $Script 2>&1 | Out-String -Width 250).TrimEnd()
        if ([string]::IsNullOrWhiteSpace($text)) { Write-Report '(結果なし)' }
        else { Write-Report $text }
    } catch {
        Write-Report "(取得失敗: $($_.Exception.Message))"
    }
}

function Test-Command {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-Native {
    <# 外部コマンドを実行。存在しなければその旨を返す #>
    param([string]$Exe, [string[]]$Arguments = @())
    if (-not (Test-Command $Exe)) { return "($Exe コマンドが見つかりません)" }
    $out = & $Exe @Arguments 2>&1 | ForEach-Object { "$_" }
    return $out
}

function Get-HttpProbe {
    <# GET のみ。短いタイムアウトでローカル API の応答を確認 #>
    param([string]$Url, [int]$MaxChars = 1500)
    try {
        $resp = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 4 -UseBasicParsing -ErrorAction Stop
        $body = [string]$resp.Content
        if ($body.Length -gt $MaxChars) { $body = $body.Substring(0, $MaxChars) + ' ...(省略)' }
        return "[$($resp.StatusCode)] $Url`n$body"
    } catch {
        $code = $null
        try { $code = [int]$_.Exception.Response.StatusCode } catch { }
        if ($code) { return "[$code] $Url (応答あり / エラー応答)" }
        return "[--] $Url (応答なし: $($_.Exception.Message))"
    }
}

function Get-DirSummary {
    <# フォルダのサイズとトップレベル一覧（ファイル内容は読まない） #>
    param([string]$Path, [int]$Depth = 1)
    if (-not (Test-Path -LiteralPath $Path)) { return "$Path : 存在しない" }
    $files = Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue
    $sum = ($files | Measure-Object -Property Length -Sum).Sum
    if (-not $sum) { $sum = 0 }
    $lines = @("$Path : ファイル数 $(@($files).Count) / 合計 {0:N2} GB" -f ($sum / 1GB))
    Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue | Select-Object -First 40 | ForEach-Object {
        $kind = if ($_.PSIsContainer) { '<DIR>' } else { '{0,12:N0}' -f $_.Length }
        $lines += ('    {0}  {1:yyyy-MM-dd HH:mm}  {2}' -f $kind, $_.LastWriteTime, $_.Name)
    }
    return $lines
}

function Get-JsonKeys {
    <# JSON 設定ファイルのトップレベルのキー名だけを返す（値は出さない） #>
    param([string]$Path)
    try {
        $obj = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        return ($obj.PSObject.Properties.Name -join ', ')
    } catch { return '(JSONとして解析不可)' }
}

function Find-AppFolders {
    param([string]$Pattern)
    $roots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA, $env:APPDATA,
               (Join-Path $env:LOCALAPPDATA 'Programs'), $env:USERPROFILE, $env:ProgramData) |
             Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
    foreach ($r in $roots) {
        Get-ChildItem -LiteralPath $r -Directory -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match $Pattern } |
            ForEach-Object { $_.FullName }
    }
}

function Get-InstalledApps {
    param([string]$Pattern)
    $keys = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
              'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
              'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*')
    Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue |
        Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -match $Pattern } |
        Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation, InstallDate |
        Sort-Object DisplayName -Unique
}

# プロセス / 待受ポートの対応表（以降のセクションで共用）
$procById = @{}
Get-Process -ErrorAction SilentlyContinue | ForEach-Object { $procById[$_.Id] = $_ }
$listeners = @()
try {
    $listeners = Get-NetTCPConnection -State Listen -ErrorAction Stop | ForEach-Object {
        $p = $procById[[int]$_.OwningProcess]
        [pscustomobject]@{
            Address = $_.LocalAddress
            Port    = $_.LocalPort
            PID     = $_.OwningProcess
            Process = if ($p) { $p.ProcessName } else { '?' }
            Scope   = if ($_.LocalAddress -in @('127.0.0.1', '::1')) { 'localhost only' }
                      elseif ($_.LocalAddress -in @('0.0.0.0', '::')) { 'ALL interfaces' }
                      else { 'specific IF' }
        }
    } | Sort-Object Port, Address -Unique
} catch { }

# ---------------------------------------------------------------------------
Write-Report "自宅AIサーバー 現状調査レポート（読み取り専用）"
Write-Report "作成日時   : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Report "実行ユーザー: $env:USERNAME  / 管理者権限: $isAdmin"
Write-Report "PowerShell : $($PSVersionTable.PSVersion)"
if (-not $isAdmin) { Write-Report '※ 管理者権限なし。ファイアウォール規則・一部サービス情報は取得できない場合があります。' }

# ---------------------------------------------------------------------------
Write-Section '1. コンピューター名 / Windows バージョン'
Invoke-Safe 'OS' {
    $os = Get-CimInstance Win32_OperatingSystem
    $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
    [pscustomobject]@{
        ComputerName   = $env:COMPUTERNAME
        DNSHostName    = [System.Net.Dns]::GetHostName()
        Caption        = $os.Caption
        DisplayVersion = $cv.DisplayVersion
        Build          = "$($cv.CurrentBuild).$($cv.UBR)"
        InstallDate    = $os.InstallDate
        LastBoot       = $os.LastBootUpTime
        Domain         = (Get-CimInstance Win32_ComputerSystem).Domain
    } | Format-List
}
Invoke-Safe '機種' { Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer, Model, SystemType | Format-List }
Invoke-Safe '電源プラン / スリープ設定（自動起動・常時稼働の確認用）' {
    Invoke-Native 'powercfg' @('/getactivescheme')
    Invoke-Native 'powercfg' @('/query', 'SCHEME_CURRENT', 'SUB_SLEEP', 'STANDBYIDLE') | Select-String 'Current|現在'
}

# ---------------------------------------------------------------------------
Write-Section '2. CPU / GPU / RAM の認識状態'
Invoke-Safe 'CPU' { Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed | Format-List }
Invoke-Safe 'RAM（合計）' {
    $cs = Get-CimInstance Win32_ComputerSystem
    $os = Get-CimInstance Win32_OperatingSystem
    "搭載: {0:N1} GB / 空き: {1:N1} GB" -f ($cs.TotalPhysicalMemory / 1GB), ($os.FreePhysicalMemory * 1KB / 1GB)
}
Invoke-Safe 'RAM（モジュール）' {
    Get-CimInstance Win32_PhysicalMemory |
        Select-Object BankLabel, DeviceLocator, @{n = 'GB'; e = { [math]::Round($_.Capacity / 1GB) } }, Speed, ConfiguredClockSpeed, Manufacturer, PartNumber |
        Format-Table -AutoSize
}
Invoke-Safe 'GPU（Windows 認識）' { Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, DriverDate, Status | Format-List }
Invoke-Safe 'GPU（nvidia-smi）' {
    Invoke-Native 'nvidia-smi' @('--query-gpu=name,driver_version,memory.total,memory.used,utilization.gpu,temperature.gpu,power.draw', '--format=csv')
    Invoke-Native 'nvidia-smi' @('--query-compute-apps=pid,process_name,used_memory', '--format=csv')
}
Invoke-Safe 'ディスク' {
    Get-Volume | Where-Object DriveLetter |
        Select-Object DriveLetter, FileSystemLabel, FileSystem,
            @{n = 'SizeGB'; e = { [math]::Round($_.Size / 1GB) } },
            @{n = 'FreeGB'; e = { [math]::Round($_.SizeRemaining / 1GB) } } | Format-Table -AutoSize
}

# ---------------------------------------------------------------------------
Write-Section '3. Tailscale'
Invoke-Safe 'インストール状態' { Get-InstalledApps 'tailscale' | Format-List }
Invoke-Safe 'サービス' { Get-Service -Name 'Tailscale*' -ErrorAction SilentlyContinue | Select-Object Name, Status, StartType | Format-Table -AutoSize }
Invoke-Safe 'バージョン' { Invoke-Native 'tailscale' @('version') }
Invoke-Safe '自デバイスの Tailscale IP' { Invoke-Native 'tailscale' @('ip') }
Invoke-Safe 'tailnet 内デバイス一覧（status）' { Invoke-Native 'tailscale' @('status') }
Invoke-Safe '自デバイス詳細（キー類は出力しない）' {
    if (-not (Test-Command 'tailscale')) { return '(tailscale コマンドなし)' }
    $j = (& tailscale status --json 2>$null) -join "`n" | ConvertFrom-Json
    [pscustomobject]@{
        BackendState = $j.BackendState
        HostName     = $j.Self.HostName
        DNSName      = $j.Self.DNSName
        TailscaleIPs = ($j.Self.TailscaleIPs -join ', ')
        Online       = $j.Self.Online
        OS           = $j.Self.OS
        MagicDNS     = $j.CurrentTailnet.MagicDNSEnabled
        Tailnet      = $j.CurrentTailnet.Name
    } | Format-List
    '--- Peers ---'
    $j.Peer.PSObject.Properties.Value | ForEach-Object {
        [pscustomobject]@{ HostName = $_.HostName; IP = ($_.TailscaleIPs | Select-Object -First 1); OS = $_.OS; Online = $_.Online; LastSeen = $_.LastSeen }
    } | Sort-Object HostName | Format-Table -AutoSize
}
Invoke-Safe 'Tailscale serve / funnel 設定（インターネット公開の有無）' {
    Invoke-Native 'tailscale' @('serve', 'status')
    Invoke-Native 'tailscale' @('funnel', 'status')
}

# ---------------------------------------------------------------------------
Write-Section '4. Docker Desktop / WSL / コンテナ / ボリューム / ネットワーク'
Invoke-Safe 'インストール状態' { Get-InstalledApps 'docker' | Format-List }
Invoke-Safe 'Docker サービス / プロセス' {
    Get-Service -Name 'com.docker*', 'docker*' -ErrorAction SilentlyContinue | Select-Object Name, Status, StartType | Format-Table -AutoSize
    Get-Process -Name 'Docker Desktop', 'com.docker.*', 'dockerd' -ErrorAction SilentlyContinue | Select-Object Name, Id, StartTime | Format-Table -AutoSize
}
Invoke-Safe 'WSL ディストリビューション' {
    # wsl.exe は UTF-16 で出力するため変換
    if (-not (Test-Command 'wsl')) { return '(wsl なし)' }
    $prev = [Console]::OutputEncoding
    try { [Console]::OutputEncoding = [Text.Encoding]::Unicode; & wsl -l -v 2>&1 | ForEach-Object { "$_" } }
    finally { [Console]::OutputEncoding = $prev }
}
Invoke-Safe '.wslconfig（WSL のメモリ上限など）' {
    $p = Join-Path $env:USERPROFILE '.wslconfig'
    if (Test-Path $p) { Get-Content $p } else { '(.wslconfig なし = WSL 既定値)' }
}

$dockerOk = $false
if (Test-Command 'docker') {
    & docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
    $dockerOk = ($LASTEXITCODE -eq 0)
}
Invoke-Safe 'docker version' { Invoke-Native 'docker' @('version', '--format', 'Client {{.Client.Version}} / Server {{.Server.Version}}') }
if ($dockerOk) {
    Invoke-Safe 'docker info（要約）' { & docker info --format 'Context={{.Name}} OS={{.OperatingSystem}} CPUs={{.NCPU}} Mem={{.MemTotal}} Root={{.DockerRootDir}} Runtimes={{json .Runtimes}}' }
    Invoke-Safe 'コンテナ一覧（停止中含む）' { & docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' }
    Invoke-Safe 'コンテナ詳細（環境変数は出力しない）' {
        $ids = & docker ps -aq
        foreach ($id in $ids) {
            $c = (& docker inspect $id) -join "`n" | ConvertFrom-Json
            $c = $c[0]
            $labels = $c.Config.Labels
            $proj = $null; $wd = $null; $cfg = $null
            if ($labels) {
                $proj = $labels.'com.docker.compose.project'
                $wd   = $labels.'com.docker.compose.project.working_dir'
                $cfg  = $labels.'com.docker.compose.project.config_files'
            }
            "■ $($c.Name.TrimStart('/'))"
            "   Image        : $($c.Config.Image)"
            "   State        : $($c.State.Status)  (StartedAt $($c.State.StartedAt))"
            "   Restart      : $($c.HostConfig.RestartPolicy.Name)"
            "   Compose      : project=$proj  dir=$wd  file=$cfg"
            "   EnvVarNames  : $((@($c.Config.Env) | ForEach-Object { ($_ -split '=', 2)[0] }) -join ', ')"
            "   GPU request  : $(if ($c.HostConfig.DeviceRequests) { 'yes' } else { 'no' })"
            "   Networks     : $(($c.NetworkSettings.Networks.PSObject.Properties.Name) -join ', ')"
            if ($c.HostConfig.PortBindings) {
                $c.HostConfig.PortBindings.PSObject.Properties | ForEach-Object {
                    $cp = $_.Name
                    $_.Value | ForEach-Object { "   Port         : $($_.HostIp):$($_.HostPort) -> $cp" + $(if (-not $_.HostIp -or $_.HostIp -eq '0.0.0.0') { '  ← 全IFで公開' } else { '' }) }
                }
            }
            $c.Mounts | ForEach-Object { "   Mount        : [$($_.Type)] $(if ($_.Name) { $_.Name } else { $_.Source }) -> $($_.Destination)" }
            ''
        }
    }
    Invoke-Safe 'docker compose プロジェクト' { & docker compose ls -a 2>&1 }
    Invoke-Safe 'ボリューム' { & docker volume ls }
    Invoke-Safe 'ネットワーク' { & docker network ls }
    Invoke-Safe 'イメージ' { & docker image ls --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}' }
    Invoke-Safe 'ディスク使用量' { & docker system df }
} else {
    Write-Report ''
    Write-Report '(Docker エンジンに接続できないため、コンテナ情報は取得していません。Docker Desktop 未起動または未導入)'
}

# ---------------------------------------------------------------------------
Write-Section '5. Ollama'
Invoke-Safe 'インストール状態' { Get-InstalledApps 'ollama' | Format-List }
Invoke-Safe 'プロセス / サービス' {
    Get-Process -Name 'ollama*' -ErrorAction SilentlyContinue | Select-Object Name, Id, StartTime, Path | Format-Table -AutoSize
    Get-Service -Name '*ollama*' -ErrorAction SilentlyContinue | Select-Object Name, Status, StartType
}
Invoke-Safe '関連環境変数（名前と値。OLLAMA_* はパス・ホスト設定のみ）' {
    foreach ($scope in 'User', 'Machine') {
        foreach ($n in 'OLLAMA_MODELS', 'OLLAMA_HOST', 'OLLAMA_ORIGINS', 'OLLAMA_KEEP_ALIVE', 'OLLAMA_NUM_PARALLEL', 'OLLAMA_MAX_LOADED_MODELS', 'OLLAMA_FLASH_ATTENTION', 'OLLAMA_CONTEXT_LENGTH') {
            $v = [Environment]::GetEnvironmentVariable($n, $scope)
            if ($v) { "[$scope] $n = $v" }
        }
    }
}
Invoke-Safe 'バージョン / モデル一覧 / 実行中モデル' {
    Invoke-Native 'ollama' @('--version')
    ''
    Invoke-Native 'ollama' @('list')
    ''
    Invoke-Native 'ollama' @('ps')
}
Invoke-Safe 'モデル保存先' {
    $p = [Environment]::GetEnvironmentVariable('OLLAMA_MODELS', 'User')
    if (-not $p) { $p = [Environment]::GetEnvironmentVariable('OLLAMA_MODELS', 'Machine') }
    if (-not $p) { $p = Join-Path $env:USERPROFILE '.ollama\models' }
    Get-DirSummary $p
}
Invoke-Safe 'API 応答（GET のみ）' {
    Get-HttpProbe 'http://127.0.0.1:11434/api/version'
    Get-HttpProbe 'http://127.0.0.1:11434/api/ps'
}

# ---------------------------------------------------------------------------
Write-Section '6. Strata'
Write-Report '※ Strata は配布形態が不明なため、名前一致で広く検索します。設定ファイルは「ファイル名」と「JSONのキー名」のみ出力します。'
Invoke-Safe 'インストール状態' { Get-InstalledApps 'strata' | Format-List }
Invoke-Safe 'プロセス / サービス' {
    Get-Process | Where-Object { $_.ProcessName -match 'strata' } | Select-Object Name, Id, StartTime, Path | Format-Table -AutoSize
    Get-Service | Where-Object { $_.Name -match 'strata' -or $_.DisplayName -match 'strata' } | Select-Object Name, DisplayName, Status, StartType
}
Invoke-Safe 'インストール / データフォルダ' {
    $dirs = @(Find-AppFolders 'strata')
    if ($dirs.Count -eq 0) { return '(strata を含むフォルダは見つかりませんでした)' }
    foreach ($d in $dirs) {
        Get-DirSummary $d
        Get-ChildItem -LiteralPath $d -Recurse -File -Force -ErrorAction SilentlyContinue -Include *.json, *.yaml, *.yml, *.toml, *.ini, *.env, *.cfg, *.conf |
            Select-Object -First 30 | ForEach-Object {
                $keys = if ($_.Extension -eq '.json') { ' keys: ' + (Get-JsonKeys $_.FullName) } else { '' }
                "    config: $($_.FullName) ($($_.Length) bytes)$keys"
            }
        Get-ChildItem -LiteralPath $d -Recurse -File -Force -ErrorAction SilentlyContinue -Include *.gguf, *.safetensors, *.bin, *.onnx |
            Where-Object { $_.Length -gt 100MB } | Select-Object -First 50 | ForEach-Object {
                "    model : {0}  ({1:N1} GB)" -f $_.FullName, ($_.Length / 1GB)
            }
    }
}
Invoke-Safe 'CLI バージョン（存在する場合）' { Invoke-Native 'strata' @('--version') }
Invoke-Safe 'Strata プロセスの待受ポートと API 応答（GET のみ）' {
    $ports = $listeners | Where-Object { $_.Process -match 'strata' }
    if (-not $ports) { return '(Strata プロセスの待受ポートなし = 停止中、または別名プロセス)' }
    $ports | Format-Table -AutoSize
    foreach ($pt in ($ports.Port | Select-Object -Unique)) {
        foreach ($path in '/v1/models', '/api/tags', '/api/version', '/health', '/docs', '/openapi.json') {
            Get-HttpProbe "http://127.0.0.1:$pt$path" 600
        }
    }
}

# ---------------------------------------------------------------------------
Write-Section '7. Open WebUI'
Invoke-Safe '実行方式の判定' {
    $found = @()
    if ($dockerOk) {
        $c = & docker ps -a --format '{{.Names}}|{{.Image}}|{{.Status}}' | Where-Object { $_ -match 'open-webui|openwebui' }
        if ($c) { $found += "Docker: $c" }
    }
    $p = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'open[-_]?webui' -and $_.Name -notmatch 'docker' }
    if ($p) { $found += ($p | ForEach-Object { "Native process: $($_.Name) PID=$($_.ProcessId)" }) }
    foreach ($exe in 'open-webui') { if (Test-Command $exe) { $found += "CLI: $((Get-Command $exe).Source)" } }
    if (Test-Command 'pip') { $v = & pip show open-webui 2>$null | Select-String '^(Version|Location):'; if ($v) { $found += "pip: $($v -join ' / ')" } }
    if ($found.Count -eq 0) { '(Open WebUI の実行形態を検出できませんでした)' } else { $found }
}
Invoke-Safe 'ネイティブ版のデータフォルダ候補' {
    foreach ($d in @(Find-AppFolders 'open[-_]?webui')) { Get-DirSummary $d }
}
Invoke-Safe 'Web 応答（GET のみ）' {
    foreach ($pt in 3000, 8080) { Get-HttpProbe "http://127.0.0.1:$pt/api/version" 300 }
}

# ---------------------------------------------------------------------------
Write-Section '8. n8n'
Write-Report '※ 暗号化キー (encryptionKey) と認証情報の値は出力しません。存在確認とファイル情報のみです。'
Invoke-Safe '実行方式の判定' {
    $found = @()
    if ($dockerOk) {
        $c = & docker ps -a --format '{{.Names}}|{{.Image}}|{{.Status}}' | Where-Object { $_ -match 'n8n' }
        if ($c) { $found += ($c | ForEach-Object { "Docker: $_" }) }
    }
    $p = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match '\bn8n\b' -and $_.Name -notmatch 'docker' }
    if ($p) { $found += ($p | ForEach-Object { "Native process: $($_.Name) PID=$($_.ProcessId)" }) }
    if (Test-Command 'n8n') { $found += "CLI: $((Get-Command n8n).Source)"; $found += "Version: $(& n8n --version 2>$null)" }
    if ($found.Count -eq 0) { '(n8n の実行形態を検出できませんでした)' } else { $found }
}
Invoke-Safe 'ネイティブ版データフォルダ (%USERPROFILE%\.n8n)' {
    $d = Join-Path $env:USERPROFILE '.n8n'
    Get-DirSummary $d
    $cfg = Join-Path $d 'config'
    if (Test-Path $cfg) { "config ファイル: あり / キー名: $(Get-JsonKeys $cfg)  ← encryptionKey がここにある場合はバックアップ必須" }
    $envKey = [Environment]::GetEnvironmentVariable('N8N_ENCRYPTION_KEY', 'User')
    if (-not $envKey) { $envKey = [Environment]::GetEnvironmentVariable('N8N_ENCRYPTION_KEY', 'Machine') }
    "環境変数 N8N_ENCRYPTION_KEY: $(if ($envKey) { '設定あり（値は非表示）' } else { 'なし' })"
    foreach ($n in 'DB_TYPE', 'N8N_PORT', 'N8N_HOST', 'N8N_PROTOCOL', 'WEBHOOK_URL', 'N8N_USER_FOLDER') {
        foreach ($scope in 'User', 'Machine') { $v = [Environment]::GetEnvironmentVariable($n, $scope); if ($v) { "[$scope] $n = $v" } }
    }
}
Invoke-Safe 'Docker 版 n8n のデータ (コンテナ内 /home/node/.n8n)' {
    if (-not $dockerOk) { return '(Docker 未接続)' }
    $names = & docker ps --format '{{.Names}}|{{.Image}}' | Where-Object { $_ -match 'n8n' } | ForEach-Object { ($_ -split '\|')[0] }
    if (-not $names) { return '(稼働中の n8n コンテナなし)' }
    foreach ($n in $names) {
        "■ $n"
        & docker exec $n sh -c 'ls -la /home/node/.n8n 2>/dev/null; echo; n8n --version 2>/dev/null' 2>&1
        # 値はメモリ上でのみ解析し、キー名だけを出力する
        $raw = (& docker exec $n cat /home/node/.n8n/config 2>$null) -join "`n"
        if ($raw) {
            try { "   config キー名: $((($raw | ConvertFrom-Json).PSObject.Properties.Name) -join ', ')  ← encryptionKey があればバックアップ必須" }
            catch { '   config: あり（JSON解析不可）' }
        } else { '   config: なし（環境変数でキー指定の可能性）' }
        $raw = $null
        "   N8N_ENCRYPTION_KEY 環境変数: $(if ((& docker exec $n sh -c 'printenv N8N_ENCRYPTION_KEY >/dev/null && echo set') -eq 'set') { '設定あり（値は非表示）' } else { 'なし' })"
    }
}
Invoke-Safe 'ワークフロー一覧（ID と名前のみ）' {
    $done = $false
    if ($dockerOk) {
        $names = & docker ps --format '{{.Names}}|{{.Image}}' | Where-Object { $_ -match 'n8n' } | ForEach-Object { ($_ -split '\|')[0] }
        foreach ($n in $names) { "■ $n"; & docker exec $n n8n list:workflow 2>&1 | Select-Object -Last 200; $done = $true }
    }
    if (-not $done -and (Test-Command 'n8n')) { & n8n list:workflow 2>&1 | Select-Object -Last 200; $done = $true }
    if (-not $done) { '(n8n CLI に到達できませんでした)' }
}
Invoke-Safe 'Web 応答（GET のみ）' { Get-HttpProbe 'http://127.0.0.1:5678/healthz' 200 }

# ---------------------------------------------------------------------------
Write-Section '9. NAS（UGREEN DXP4800 Plus）'
Write-Report '※ 共有の一覧取得と疎通確認のみ。NAS 上のファイルは読み書きしません。'
Invoke-Safe 'マップ済みドライブ / SMB 接続' {
    Get-SmbMapping -ErrorAction SilentlyContinue | Select-Object LocalPath, RemotePath, Status | Format-Table -AutoSize
    Get-PSDrive -PSProvider FileSystem | Where-Object { $_.DisplayRoot } | Select-Object Name, DisplayRoot | Format-Table -AutoSize
    Invoke-Native 'net' @('use')
}
Invoke-Safe '保存済み資格情報（対象名のみ。パスワードは表示されない）' {
    Invoke-Native 'cmdkey' @('/list') | Where-Object { $_ -match 'Target|ターゲット|対象' }
}
foreach ($h in $NasHosts) {
    Invoke-Safe "疎通確認: $h" {
        $r = Test-NetConnection -ComputerName $h -Port 445 -WarningAction SilentlyContinue
        "ResolvedIP=$($r.RemoteAddress)  Ping=$($r.PingSucceeded)  SMB(445)=$($r.TcpTestSucceeded)"
        if ($r.TcpTestSucceeded) { Invoke-Native 'net' @('view', "\\$h") }
    }
}

# ---------------------------------------------------------------------------
Write-Section '10. 使用中ポート / Windows ファイアウォール'
Invoke-Safe '待受中 TCP ポート（全件）' { $listeners | Format-Table -AutoSize }
Invoke-Safe '★ 全インターフェースで待受中のポート（外部到達の可能性あり）' {
    $listeners | Where-Object { $_.Scope -eq 'ALL interfaces' -and $_.Port -lt 49152 } | Format-Table -AutoSize
}
Invoke-Safe '主要サービスのポート確認' {
    $known = [ordered]@{ 11434 = 'Ollama'; 3000 = 'Open WebUI (typ.)'; 8080 = 'Open WebUI (alt)'; 5678 = 'n8n'; 2375 = 'Docker API (危険)'; 2376 = 'Docker TLS'; 3389 = 'RDP'; 445 = 'SMB'; 5985 = 'WinRM'; 22 = 'SSH' }
    foreach ($k in $known.Keys) {
        $l = $listeners | Where-Object Port -eq $k
        if ($l) { '{0,-6} {1,-20} {2}' -f $k, $known[$k], (($l | ForEach-Object { "$($_.Address)($($_.Process))" }) -join ', ') }
        else    { '{0,-6} {1,-20} (待受なし)' -f $k, $known[$k] }
    }
}
Invoke-Safe 'ネットワークアダプター / プロファイル' {
    Get-NetConnectionProfile -ErrorAction SilentlyContinue | Select-Object InterfaceAlias, Name, NetworkCategory, IPv4Connectivity | Format-Table -AutoSize
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne '127.0.0.1' } |
        Select-Object InterfaceAlias, IPAddress, PrefixLength | Format-Table -AutoSize
}
Invoke-Safe 'ファイアウォール プロファイル' {
    Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction | Format-Table -AutoSize
}
Invoke-Safe '関連する有効な受信許可ルール' {
    $rules = Get-NetFirewallRule -Direction Inbound -Enabled True -Action Allow -ErrorAction Stop |
             Where-Object { $_.DisplayName -match $KeywordRegex -or $_.DisplayName -match 'python|node|uvicorn' }
    foreach ($r in $rules) {
        $pf = $r | Get-NetFirewallPortFilter
        $af = $r | Get-NetFirewallAddressFilter
        $ap = $r | Get-NetFirewallApplicationFilter
        [pscustomobject]@{
            Name     = $r.DisplayName
            Profile  = $r.Profile
            Protocol = $pf.Protocol
            Port     = ($pf.LocalPort -join ',')
            Remote   = ($af.RemoteAddress -join ',')
            Program  = $ap.Program
        }
    } | Format-Table -AutoSize -Wrap
}
Invoke-Safe 'ポート指定の受信許可ルール（主要ポート）' {
    $targets = @('11434', '3000', '8080', '5678', '2375', '3389')
    Get-NetFirewallPortFilter -ErrorAction Stop | Where-Object { @($_.LocalPort | Where-Object { $_ -in $targets }).Count -gt 0 } | ForEach-Object {
        $r = $_ | Get-NetFirewallRule
        if ($r.Enabled -eq 'True' -and $r.Direction -eq 'Inbound') {
            [pscustomobject]@{ Name = $r.DisplayName; Action = $r.Action; Profile = $r.Profile; Port = ($_.LocalPort -join ',') }
        }
    } | Format-Table -AutoSize
}
Invoke-Safe 'UPnP（ルーター自動ポート開放）関連サービス' {
    Get-Service -Name 'upnphost', 'SSDPSRV' -ErrorAction SilentlyContinue | Select-Object Name, Status, StartType | Format-Table -AutoSize
}

# ---------------------------------------------------------------------------
Write-Section '付録. 自動起動の設定'
Invoke-Safe '関連サービス' {
    Get-Service | Where-Object { $_.Name -match $KeywordRegex -or $_.DisplayName -match $KeywordRegex } |
        Select-Object Name, DisplayName, Status, StartType | Format-Table -AutoSize
}
Invoke-Safe 'スタートアップ登録（Run キー）' {
    foreach ($k in 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run') {
        $p = Get-ItemProperty $k -ErrorAction SilentlyContinue
        if ($p) { $p.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { "[$k] $($_.Name) = $($_.Value)" } }
    }
}
Invoke-Safe 'スタートアップフォルダ' {
    foreach ($d in [Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup')) {
        Get-ChildItem $d -ErrorAction SilentlyContinue | ForEach-Object { "$d\$($_.Name)" }
    }
}
Invoke-Safe '関連スケジュールタスク' {
    Get-ScheduledTask -ErrorAction SilentlyContinue |
        Where-Object { $_.TaskName -match $KeywordRegex -or (@($_.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' ') -match $KeywordRegex } |
        Select-Object TaskPath, TaskName, State | Format-Table -AutoSize
}
Invoke-Safe '関連するインストール済みソフト（全体）' {
    Get-InstalledApps ($KeywordRegex + '|python|node\.js|git') | Format-Table DisplayName, DisplayVersion, Publisher -AutoSize
}

# ---------------------------------------------------------------------------
Write-Report ''
Write-Report ('=' * 78)
Write-Report "調査完了: $report"
Write-Report '共有前に report.txt を開き、パスワード・キー・個人情報が残っていないか確認してください。'
Write-Host ''
Write-Host "レポートを出力しました: $report" -ForegroundColor Green
