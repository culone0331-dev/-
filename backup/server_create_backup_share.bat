@echo off
rem ============================================================
rem  CULONE-SERVER 側で実行: バックアップ受け取り用の共有フォルダ「backup」を自動で作成
rem  使い方: CULONE-SERVER でこのファイルをダブルクリック（管理者確認に「はい」）
rem  ・空き容量がいちばん多いドライブに <ドライブ>:\backup を作成
rem  ・\\CULONE-SERVER\backup として共有（読み書き可）
rem ============================================================
chcp 65001 >nul
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((Get-Content -LiteralPath '%~f0' -Raw -Encoding UTF8) -split ('#'+'PS'+'#'),2)[1]"
pause
exit /b

#PS#
$ErrorActionPreference = 'Stop'
try {
  $share = Get-SmbShare -Name 'backup' -ErrorAction SilentlyContinue
  if ($share) {
    $path = $share.Path
    Write-Host "共有フォルダ backup はすでにあります: $path"
  } else {
    $vol = Get-Volume |
      Where-Object { $_.DriveLetter -and $_.DriveType -eq 'Fixed' } |
      Sort-Object SizeRemaining -Descending | Select-Object -First 1
    $path = "$($vol.DriveLetter):\backup"
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    New-SmbShare -Name 'backup' -Path $path -FullAccess 'Everyone' | Out-Null
    Write-Host "共有フォルダを作成しました: $path"
  }
  # フォルダ自体にも読み書き権限を付与（S-1-1-0 = Everyone）
  icacls $path /grant '*S-1-1-0:(OI)(CI)M' | Out-Null

  # ファイル共有のファイアウォール許可（すでに許可済みなら何も変わらない）
  Get-NetFirewallRule -Group '@FirewallAPI.dll,-28502' -ErrorAction SilentlyContinue |
    Enable-NetFirewallRule

  $drive = Get-Volume -DriveLetter $path.Substring(0,1)
  Write-Host ("空き容量: {0:N0} GB" -f ($drive.SizeRemaining / 1GB))
  Write-Host ""
  Write-Host "準備完了です。売却する PC から \\$env:COMPUTERNAME\backup にアクセスできます。"
  Write-Host "接続時は、この CULONE-SERVER の Windows のユーザー名とパスワードを入力してください。"
} catch {
  Write-Host "[エラー] $($_.Exception.Message)" -ForegroundColor Red
}
