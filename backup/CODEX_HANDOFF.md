# Codex への引き継ぎ: 売却予定 PC のデータを CULONE-SERVER に一時退避

## 目的
売却予定の Windows PC（以下「売却 PC」）のデータを、同じ LAN 上の Windows サーバー
**CULONE-SERVER**（MINISFORUM MS-02 Ultra）に一時退避する。
最終的には UGREEN NAS（DXP4800 Plus / 192.168.0.10）へ移す予定だが、
NAS 側の共有フォルダがまだ使えないため、今回は CULONE-SERVER を退避先にする。

## 対象と方針
- **データのみ**（OS・アプリは不要。PC は売却後に初期化する）
- コピー対象
  1. 売却 PC のユーザーフォルダ `%USERPROFILE%`（`AppData` は除外）
  2. 売却 PC の **D ドライブ全体**（`$RECYCLE.BIN`、`System Volume Information` は除外）
- 退避先: `\\CULONE-SERVER\backup\<売却PCのコンピューター名>\`
- **退避先のファイルを削除しないこと**（robocopy の `/MIR` や `/PURGE` は使わない）
- 売却 PC 上のファイルは読み取りのみ。変更・削除しないこと

---

## 手順 1: CULONE-SERVER 上で実行（管理者 PowerShell）
共有フォルダ `backup` を作る。すでにあればそのまま使う。

```powershell
$ErrorActionPreference = 'Stop'
$share = Get-SmbShare -Name 'backup' -ErrorAction SilentlyContinue
if ($share) {
  $path = $share.Path
} else {
  $vol = Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveType -eq 'Fixed' } |
    Sort-Object SizeRemaining -Descending | Select-Object -First 1
  $path = "$($vol.DriveLetter):\backup"
  New-Item -ItemType Directory -Path $path -Force | Out-Null
  New-SmbShare -Name 'backup' -Path $path -FullAccess 'Everyone' | Out-Null
}
icacls $path /grant '*S-1-1-0:(OI)(CI)M' | Out-Null
Get-NetFirewallRule -Group '@FirewallAPI.dll,-28502' -ErrorAction SilentlyContinue | Enable-NetFirewallRule
"共有パス: $path"
"空き容量: {0:N0} GB" -f ((Get-Volume -DriveLetter $path.Substring(0,1)).SizeRemaining / 1GB)
```

完了条件: `Get-SmbShare -Name backup` で共有が表示され、空き容量が報告されること。

---

## 手順 2: 売却 PC 上で実行（PowerShell）

### 2-1. 事前確認
```powershell
Test-Path '\\CULONE-SERVER\backup'
```
- `False` の場合: エクスプローラーで `\\CULONE-SERVER\backup` を開き、CULONE-SERVER の
  Windows ユーザー名・パスワードで「資格情報を記憶する」にチェックしてログインするよう
  **ユーザーに依頼して停止**する（パスワードを推測・入力しないこと）。

### 2-2. 容量確認
コピー対象の合計サイズと、手順 1 で表示された空き容量を比較する。足りなければ **停止してユーザーに報告**。
```powershell
$size = (Get-ChildItem $env:USERPROFILE -Recurse -File -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notlike "$env:USERPROFILE\AppData\*" } | Measure-Object Length -Sum).Sum
$size += (Get-ChildItem 'D:\' -Recurse -File -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '\\(\$RECYCLE\.BIN|System Volume Information)\\' } | Measure-Object Length -Sum).Sum
"{0:N1} GB" -f ($size / 1GB)
```

### 2-3. コピー実行
```powershell
$dest  = "\\CULONE-SERVER\backup\$env:COMPUTERNAME"
$stamp = Get-Date -Format yyyyMMdd_HHmmss
New-Item -ItemType Directory -Path "$dest\logs" -Force | Out-Null

robocopy $env:USERPROFILE "$dest\$env:USERNAME" /E /COPY:DAT /DCOPY:T /R:1 /W:1 /XJ /MT:16 /NP `
  /XD "$env:USERPROFILE\AppData" /XF ntuser.dat* UsrClass.dat* *.tmp `
  /LOG:"$dest\logs\users_$stamp.log"
$rc1 = $LASTEXITCODE

robocopy 'D:\' "$dest\D_drive" /E /COPY:DAT /DCOPY:T /R:1 /W:1 /XJ /MT:16 /NP `
  /XD '$RECYCLE.BIN' 'System Volume Information' `
  /LOG:"$dest\logs\d_drive_$stamp.log"
$rc2 = $LASTEXITCODE

"users=$rc1 d_drive=$rc2  (0-7 は成功、8 以上は一部失敗)"
```
時間がかかる場合があるので、途中で止まったら同じコマンドを再実行すれば続きから進む。

### 2-4. 検証（完了条件）
- `$rc1` と `$rc2` がどちらも 8 未満
- ログ末尾の集計で「失敗 (FAILED)」が 0、またはその内容をユーザーに報告
  ```powershell
  Get-Content "$dest\logs\users_$stamp.log" -Tail 15
  Get-Content "$dest\logs\d_drive_$stamp.log" -Tail 15
  ```
- `$dest` 配下に `<ユーザー名>` と `D_drive` フォルダがあり、写真や文書を数件開けること

## 報告してほしい内容
- 退避先パス、コピーしたファイル数・容量、失敗件数（あれば対象ファイル名）
- コピーされない場所に残っていそうなデータ（例: C:\ 直下の独自フォルダ、Outlook の .pst、
  ブラウザのパスワード/ブックマーク）があれば指摘

## 注意
- `backup` 共有は LAN 内の誰でも読み書きできる設定。NAS への移動が終わったら共有を解除すること
  （`Remove-SmbShare -Name backup`）。
- PC の初期化はユーザーが自分で行う。Codex は初期化・削除操作を行わないこと。
