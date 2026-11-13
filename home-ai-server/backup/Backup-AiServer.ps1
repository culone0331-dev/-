<#
.SYNOPSIS
    第3段階: 自宅AIサーバーのバックアップスクリプト（下書き / 調査結果を受けて確定）

.DESCRIPTION
    既定は「確認モード」: 何をどこへコピーするか・容量を表示するだけで、何も書き込まない。
    実際にコピーするには -Execute を付ける（ユーザー承認後に実行すること）。

    対象:
      1. n8n  … ワークフロー / 認証情報(暗号化のまま) / 暗号化キー(config) / compose 定義
      2. Docker 永続データ … 名前付きボリューム(tar.gz) / バインドマウント / コンテナ定義
      3. Ollama モデル（-IncludeOllamaModels 指定時のみ。数百GBになり得る）
      4. Strata 設定（モデル本体は -IncludeStrataModels 指定時のみ）
      5. Open WebUI（ネイティブ版のデータフォルダ。Docker 版は 2 に含まれる）

    守ること:
      - サービス・コンテナを停止しない（稼働中のままコピー。整合性は n8n は export で担保、
        SQLite 等は「ほぼ整合」。完全な整合が必要なら承認を得て停止後に再実行）
      - NAS 上の既存データを変更しない: 新しい日時付きフォルダを作り、その中にだけ書く。
        robocopy は /MIR・/PURGE・/MOV を使わない
      - 秘密情報の中身を画面・ログに出さない（ファイルとしてはバックアップ先に保存される）

.PARAMETER Destination
    バックアップ先の親フォルダ（例: \\DXP4800PLUS\backup\ms02-ultra）。この下に ms02-backup-<日時> を作る。

.PARAMETER Staging
    Docker ボリュームを一時的に tar 化するローカルフォルダ。

.EXAMPLE
    # 確認モード（何も書き込まない）
    .\Backup-AiServer.ps1 -Destination '\\DXP4800PLUS\backup\ms02-ultra'

    # 実行（承認後）
    .\Backup-AiServer.ps1 -Destination '\\DXP4800PLUS\backup\ms02-ultra' -Execute
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Destination,
    [string]$Staging = (Join-Path $env:SystemDrive 'ai-backup-staging'),
    [switch]$Execute,
    [switch]$IncludeOllamaModels,
    [switch]$IncludeStrataModels,
    [switch]$SkipDockerVolumes,
    [string]$HelperImage = 'alpine:3.20'
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$bkRoot  = Join-Path $Destination "ms02-backup-$stamp"
$stageRt = Join-Path $Staging "stage-$stamp"
$mode    = if ($Execute) { '実行モード' } else { '確認モード（書き込みなし）' }
$plan    = New-Object System.Collections.Generic.List[object]

function Say { param([string]$m, [string]$c = 'Gray') Write-Host $m -ForegroundColor $c }
function Test-Command { param([string]$n) [bool](Get-Command $n -ErrorAction SilentlyContinue) }

function Get-SizeGB {
    param([string]$Path, [string[]]$ExcludeExt = @())
    if (-not (Test-Path -LiteralPath $Path)) { return 0 }
    $f = Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue
    if ($ExcludeExt.Count) { $f = $f | Where-Object { $ExcludeExt -notcontains $_.Extension.ToLower() } }
    $s = ($f | Measure-Object Length -Sum).Sum
    if (-not $s) { $s = 0 }
    return [math]::Round($s / 1GB, 2)
}

function Add-Plan { param([string]$Item, [string]$Source, [string]$Target, [double]$GB, [string]$Note = '')
    $plan.Add([pscustomobject]@{ Item = $Item; Source = $Source; Target = $Target; GB = $GB; Note = $Note })
}

function Copy-Tree {
    <# 追加コピーのみ。既存ファイルの削除・移動はしない #>
    param([string]$Source, [string]$Target, [string[]]$ExcludeFiles = @(), [string]$LogName)
    if (-not $Execute) { return }
    New-Item -ItemType Directory -Path $Target -Force | Out-Null
    $log  = Join-Path $bkRoot "_logs\$LogName.log"
    $rcArgs = @($Source, $Target, '/E', '/COPY:DAT', '/DCOPY:DAT', '/R:1', '/W:2', '/MT:8', '/NP', '/NFL', '/NDL', "/LOG:$log")
    if ($ExcludeFiles.Count) { $rcArgs += '/XF'; $rcArgs += $ExcludeFiles }
    & robocopy @rcArgs | Out-Null
    # robocopy の終了コード 0-7 は成功、8 以上は失敗
    if ($LASTEXITCODE -ge 8) { Say "  ! robocopy 失敗 (code $LASTEXITCODE): $Source  → ログ: $log" 'Red' }
    else { Say "  ✓ $Source" 'Green' }
}

function Copy-File {
    param([string]$Source, [string]$Target)
    if (-not $Execute) { return }
    New-Item -ItemType Directory -Path (Split-Path $Target) -Force | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Target -Force
}

# ---------------------------------------------------------------------------
Say "=== 自宅AIサーバー バックアップ [$mode] ===" 'Cyan'
Say "保存先: $bkRoot"

if (-not (Test-Path -LiteralPath $Destination)) {
    Say "保存先の親フォルダに到達できません: $Destination" 'Red'
    Say 'NAS のマウント / 共有名を確認してください（このスクリプトは共有フォルダを作成しません）。' 'Red'
    exit 1
}
if (Test-Path -LiteralPath $bkRoot) { Say "同名フォルダが既に存在します。中止します: $bkRoot" 'Red'; exit 1 }

if ($Execute) {
    New-Item -ItemType Directory -Path (Join-Path $bkRoot '_logs') -Force | Out-Null
    New-Item -ItemType Directory -Path $stageRt -Force | Out-Null
}

$dockerOk = $false
if (Test-Command 'docker') { & docker info --format '{{.ServerVersion}}' 2>$null | Out-Null; $dockerOk = ($LASTEXITCODE -eq 0) }
$containers = @()
if ($dockerOk) {
    $containers = @(& docker ps -aq | ForEach-Object { ((& docker inspect $_) -join "`n" | ConvertFrom-Json)[0] })
}

# ---------------------------------------------------------------------------
Say "`n[1] n8n" 'Cyan'
$n8nDocker = @($containers | Where-Object { $_.Config.Image -match 'n8n' -and $_.State.Running })
foreach ($c in $n8nDocker) {
    $name = $c.Name.TrimStart('/')
    $t = Join-Path $bkRoot "n8n\$name"
    Add-Plan 'n8n workflows (export)'          "$name (container)" "$t\workflows"   0 'n8n export:workflow --backup'
    Add-Plan 'n8n credentials (暗号化のまま)'   "$name (container)" "$t\credentials" 0 'n8n export:credentials --backup（--decrypted は使わない）'
    Add-Plan 'n8n 暗号化キー (config)'          "${name}:/home/node/.n8n/config" "$t\config" 0 '★最重要。これが無いと認証情報を復元できない'
    if ($Execute) {
        Say "  n8n コンテナ $name から export"
        & docker exec $name sh -c 'rm -rf /tmp/claude-n8n-bk && mkdir -p /tmp/claude-n8n-bk/workflows /tmp/claude-n8n-bk/credentials' | Out-Null
        & docker exec $name n8n export:workflow --backup --output=/tmp/claude-n8n-bk/workflows/ 2>&1 | Out-Null
        & docker exec $name n8n export:credentials --backup --output=/tmp/claude-n8n-bk/credentials/ 2>&1 | Out-Null
        New-Item -ItemType Directory -Path $t -Force | Out-Null
        & docker cp "${name}:/tmp/claude-n8n-bk/workflows" "$t\workflows" | Out-Null
        & docker cp "${name}:/tmp/claude-n8n-bk/credentials" "$t\credentials" | Out-Null
        & docker cp "${name}:/home/node/.n8n/config" "$t\config" 2>$null | Out-Null
        # 自分で作った一時フォルダだけを片付ける
        & docker exec $name rm -rf /tmp/claude-n8n-bk | Out-Null
        $wf = @(Get-ChildItem "$t\workflows" -File -ErrorAction SilentlyContinue).Count
        $cr = @(Get-ChildItem "$t\credentials" -File -ErrorAction SilentlyContinue).Count
        Say "  ✓ workflows=$wf, credentials=$cr, config=$(Test-Path "$t\config")" 'Green'
        if (-not (Test-Path "$t\config")) { Say '  ! config が無い → 暗号化キーは環境変数 N8N_ENCRYPTION_KEY（compose の .env 等）にあるはず。[2] の compose 定義バックアップを確認' 'Yellow' }
    }
}
$n8nNative = Join-Path $env:USERPROFILE '.n8n'
if (Test-Path $n8nNative) {
    $t = Join-Path $bkRoot 'n8n\native'
    Add-Plan 'n8n native data (.n8n 一式)' $n8nNative "$t\dot-n8n" (Get-SizeGB $n8nNative) 'config(暗号化キー) と database.sqlite を含む'
    if ($Execute) {
        Copy-Tree $n8nNative "$t\dot-n8n" -LogName 'n8n-native'
        if (Test-Command 'n8n') {
            New-Item -ItemType Directory -Path "$t\workflows", "$t\credentials" -Force | Out-Null
            & n8n export:workflow --backup --output="$t\workflows\" 2>&1 | Out-Null
            & n8n export:credentials --backup --output="$t\credentials\" 2>&1 | Out-Null
        }
    }
}
if (-not $n8nDocker.Count -and -not (Test-Path $n8nNative)) { Say '  n8n は検出されませんでした' 'Yellow' }

# ---------------------------------------------------------------------------
Say "`n[2] Docker 永続データ" 'Cyan'
if (-not $dockerOk) { Say '  Docker エンジンに接続できないためスキップ' 'Yellow' }
else {
    # コンテナ定義（環境変数を含むため機密扱い）
    Add-Plan 'コンテナ定義 (docker inspect)' 'all containers' "$bkRoot\docker\inspect" 0 '環境変数を含む＝機密'
    if ($Execute) {
        $d = Join-Path $bkRoot 'docker\inspect'; New-Item -ItemType Directory -Path $d -Force | Out-Null
        foreach ($c in $containers) { (& docker inspect $c.Id) | Set-Content -Path (Join-Path $d "$($c.Name.TrimStart('/')).json") -Encoding UTF8 }
        & docker ps -a --format '{{.Names}}|{{.Image}}|{{.Status}}' | Set-Content (Join-Path $d '_containers.txt') -Encoding UTF8
        & docker volume ls --format '{{.Name}}' | Set-Content (Join-Path $d '_volumes.txt') -Encoding UTF8
        & docker image ls --format '{{.Repository}}:{{.Tag}}|{{.ID}}' | Set-Content (Join-Path $d '_images.txt') -Encoding UTF8
    }

    # compose 定義（.env を含む＝機密）
    $composeDirs = @($containers | ForEach-Object {
        $l = $_.Config.Labels
        if ($l -and $l.PSObject.Properties['com.docker.compose.project.working_dir']) { $l.'com.docker.compose.project.working_dir' }
    } | Where-Object { $_ } | Select-Object -Unique)
    foreach ($cd in $composeDirs) {
        if (-not (Test-Path -LiteralPath $cd)) { Say "  compose フォルダがホスト上に見つかりません: $cd" 'Yellow'; continue }
        $t = Join-Path $bkRoot ("docker\compose\" + (Split-Path $cd -Leaf))
        Add-Plan 'compose 定義 (*.yml / .env)' $cd $t 0 '.env に暗号化キー等がある可能性＝機密'
        if ($Execute) {
            New-Item -ItemType Directory -Path $t -Force | Out-Null
            Get-ChildItem -LiteralPath $cd -File -Force | Where-Object { $_.Name -match '\.(ya?ml)$|^\.env|\.env$' } |
                ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $t -Force }
        }
    }

    # バインドマウント
    $binds = @($containers | ForEach-Object { $_.Mounts } | Where-Object { $_.Type -eq 'bind' } |
               Select-Object -ExpandProperty Source -Unique |
               Where-Object { $_ -notmatch '^/(var/run|run|proc|sys|dev)|docker\.sock' })
    foreach ($b in $binds) {
        # Docker Desktop は Windows パスを /run/desktop/mnt/host/c/... 等で表すことがある
        $win = $b
        if ($b -match '^/(?:run/desktop/mnt/host/)?([a-zA-Z])/(.*)$') { $win = "$($Matches[1].ToUpper()):\$($Matches[2] -replace '/', '\')" }
        if (-not (Test-Path -LiteralPath $win)) { Say "  バインドマウント元が Windows 上に見つかりません（WSL 内パスの可能性）: $b" 'Yellow'; continue }
        $t = Join-Path $bkRoot ("docker\binds\" + (($win -replace '[:\\/]+', '_').Trim('_')))
        Add-Plan 'バインドマウント' $win $t (Get-SizeGB $win)
        Copy-Tree $win $t -LogName ("bind-" + (Split-Path $win -Leaf))
    }

    # 名前付きボリューム → 読み取り専用でマウントして tar.gz 化
    if (-not $SkipDockerVolumes) {
        $vols = @(& docker volume ls -q)
        foreach ($v in $vols) {
            $users = @($containers | Where-Object { $_.Mounts | Where-Object { $_.Type -eq 'volume' -and $_.Name -eq $v } } | ForEach-Object { $_.Name.TrimStart('/') })
            $note = if ($users.Count) { '使用中: ' + ($users -join ', ') } else { '未使用ボリューム（整理候補）' }
            Add-Plan 'Docker volume (tar.gz)' $v "$bkRoot\docker\volumes\$v.tar.gz" 0 $note
            if ($Execute) {
                $hostStage = $stageRt -replace '\\', '/'
                & docker run --rm -v "${v}:/src:ro" -v "${hostStage}:/backup" $HelperImage tar czf "/backup/$v.tar.gz" -C /src . 2>&1 | Out-Null
                if ($LASTEXITCODE -ne 0) { Say "  ! ボリューム $v の tar 化に失敗" 'Red' } else { Say "  ✓ volume $v" 'Green' }
            }
        }
        if ($Execute -and $vols.Count) { Copy-Tree $stageRt (Join-Path $bkRoot 'docker\volumes') -LogName 'docker-volumes' }
    }
}

# ---------------------------------------------------------------------------
Say "`n[3] Ollama" 'Cyan'
$om = [Environment]::GetEnvironmentVariable('OLLAMA_MODELS', 'User')
if (-not $om) { $om = [Environment]::GetEnvironmentVariable('OLLAMA_MODELS', 'Machine') }
if (-not $om) { $om = Join-Path $env:USERPROFILE '.ollama\models' }
if (Test-Path $om) {
    $gb = Get-SizeGB $om
    if ($IncludeOllamaModels) {
        Add-Plan 'Ollama models' $om "$bkRoot\ollama\models" $gb
        Copy-Tree $om (Join-Path $bkRoot 'ollama\models') -LogName 'ollama-models'
    } else {
        Add-Plan 'Ollama models' $om '(スキップ)' $gb '-IncludeOllamaModels で対象化。再ダウンロード可能なら不要'
    }
    if ($Execute -and (Test-Command 'ollama')) {
        New-Item -ItemType Directory -Path (Join-Path $bkRoot 'ollama') -Force | Out-Null
        & ollama list 2>&1 | Set-Content (Join-Path $bkRoot 'ollama\ollama-list.txt') -Encoding UTF8
        # 自作 Modelfile の復元用
        foreach ($m in (& ollama list 2>$null | Select-Object -Skip 1 | ForEach-Object { ($_ -split '\s+')[0] } | Where-Object { $_ })) {
            $safe = $m -replace '[\\/:*?"<>|]', '_'
            & ollama show $m --modelfile 2>$null | Set-Content (Join-Path $bkRoot "ollama\modelfile-$safe.txt") -Encoding UTF8
        }
    }
} else { Say "  モデルフォルダが見つかりません: $om" 'Yellow' }

# ---------------------------------------------------------------------------
Say "`n[4] Strata" 'Cyan'
$modelExt = @('.gguf', '.safetensors', '.bin', '.onnx', '.pt', '.pth')
$strataDirs = @(@($env:APPDATA, $env:LOCALAPPDATA, (Join-Path $env:LOCALAPPDATA 'Programs'), $env:USERPROFILE, $env:ProgramData) |
    Where-Object { $_ -and (Test-Path $_) } |
    ForEach-Object { Get-ChildItem -LiteralPath $_ -Directory -Force -ErrorAction SilentlyContinue | Where-Object Name -match 'strata' } |
    Select-Object -ExpandProperty FullName -Unique)
if (-not $strataDirs.Count) { Say '  Strata のフォルダは見つかりませんでした（調査結果で場所を確定させる）' 'Yellow' }
foreach ($d in $strataDirs) {
    $t = Join-Path $bkRoot ("strata\" + (($d -replace '[:\\/]+', '_').Trim('_')))
    if ($IncludeStrataModels) {
        Add-Plan 'Strata (モデル含む)' $d $t (Get-SizeGB $d)
        Copy-Tree $d $t -LogName ("strata-" + (Split-Path $d -Leaf))
    } else {
        Add-Plan 'Strata (設定のみ)' $d $t (Get-SizeGB $d $modelExt) 'モデル本体は -IncludeStrataModels で対象化'
        Copy-Tree $d $t -ExcludeFiles ($modelExt | ForEach-Object { "*$_" }) -LogName ("strata-" + (Split-Path $d -Leaf))
    }
}

# ---------------------------------------------------------------------------
Say "`n[5] Open WebUI（ネイティブ版）" 'Cyan'
$owDirs = @(@($env:APPDATA, $env:LOCALAPPDATA, $env:USERPROFILE) | Where-Object { $_ } |
    ForEach-Object { Get-ChildItem -LiteralPath $_ -Directory -Force -ErrorAction SilentlyContinue | Where-Object Name -match 'open[-_]?webui' } |
    Select-Object -ExpandProperty FullName -Unique)
if (-not $owDirs.Count) { Say '  ネイティブ版のデータは見つかりません（Docker 版なら [2] に含まれる）' }
foreach ($d in $owDirs) {
    $t = Join-Path $bkRoot ("open-webui\" + (Split-Path $d -Leaf))
    Add-Plan 'Open WebUI data' $d $t (Get-SizeGB $d) 'webui.db（ユーザー・会話履歴）を含む'
    Copy-Tree $d $t -LogName 'open-webui'
}

# ---------------------------------------------------------------------------
Say "`n=== バックアップ計画 ===" 'Cyan'
$plan | Format-Table Item, GB, Source, Target, Note -AutoSize -Wrap | Out-String -Width 250 | Write-Host
$total = ($plan | Where-Object { $_.Target -ne '(スキップ)' } | Measure-Object GB -Sum).Sum
Say ("見積もり合計: {0:N1} GB（Docker ボリュームの容量は含まない）" -f $total)

if ($Execute) {
    # マニフェスト（ファイル一覧とサイズ。復元確認に使う）
    $man = Join-Path $bkRoot '_manifest.csv'
    Get-ChildItem -LiteralPath $bkRoot -Recurse -File -Force | Where-Object { $_.FullName -notmatch '\\_logs\\' } |
        Select-Object @{n = 'Path'; e = { $_.FullName.Substring($bkRoot.Length + 1) } }, Length, LastWriteTime |
        Export-Csv -Path $man -NoTypeInformation -Encoding UTF8
    $plan | Export-Csv -Path (Join-Path $bkRoot '_plan.csv') -NoTypeInformation -Encoding UTF8
    @(
        "作成日時: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        "作成元  : $env:COMPUTERNAME"
        '★ このフォルダには n8n 暗号化キー・.env・コンテナ環境変数など機密情報が含まれます。'
        '   NAS 側で共有範囲を自分だけに限定してください。'
    ) | Set-Content (Join-Path $bkRoot 'README-機密.txt') -Encoding UTF8
    Say "`n完了: $bkRoot" 'Green'
    Say "ローカルの一時フォルダ $stageRt は、NAS へのコピー成功を確認してから手動で削除してください。" 'Yellow'
} else {
    Say "`n確認モードのため何も書き込んでいません。内容に問題なければ -Execute を付けて再実行してください。" 'Yellow'
}
