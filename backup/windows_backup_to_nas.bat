@echo off
rem ============================================================
rem  Windows パソコンのデータ（ユーザーフォルダ）を NAS にバックアップ
rem  使い方: 下の NAS を自分の環境に合わせて書き換え、
rem          このファイルをダブルクリックで実行
rem ============================================================
chcp 65001 >nul
setlocal

rem ▼ NAS の共有フォルダ（例: \\192.168.1.10\backup や \\NAS\backup）
set "NAS=\\192.168.0.10\backup"

set "DEST=%NAS%\%COMPUTERNAME%"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "STAMP=%%i"

if not exist "%NAS%\" (
  echo [エラー] NAS に接続できません: %NAS%
  echo エクスプローラーで一度 %NAS% を開き、ユーザー名とパスワードを保存してから再実行してください。
  pause
  exit /b 1
)
if not exist "%DEST%\logs" mkdir "%DEST%\logs"

set "FAILED=0"

echo === 1/2 ユーザーフォルダ（ドキュメント・写真・デスクトップ・ダウンロード等）をコピー中 ===
rem /E: サブフォルダも含めてコピー（NAS 側のファイルは削除しない）
rem 変更のあったファイルだけをコピーするので、途中で止めても再実行すれば続きから進みます
robocopy "%USERPROFILE%" "%DEST%\%USERNAME%" /E /COPY:DAT /DCOPY:T /R:1 /W:1 /XJ /MT:16 /NP ^
  /XD "%USERPROFILE%\AppData" ^
  /XF ntuser.dat* NTUSER.DAT* UsrClass.dat* *.tmp ^
  /LOG:"%DEST%\logs\users_%STAMP%.log" /TEE
if %ERRORLEVEL% GEQ 8 set "FAILED=1"

echo.
echo === 2/2 D ドライブ（DATA）をコピー中 ===
if exist "D:\" (
  robocopy "D:\" "%DEST%\D_drive" /E /COPY:DAT /DCOPY:T /R:1 /W:1 /XJ /MT:16 /NP ^
    /XD "$RECYCLE.BIN" "System Volume Information" ^
    /LOG:"%DEST%\logs\d_drive_%STAMP%.log" /TEE
  if errorlevel 8 set "FAILED=1"
) else (
  echo D ドライブが見つからないためスキップしました。
)

echo.
if "%FAILED%"=="1" (
  echo [警告] 一部のファイルをコピーできませんでした。ログを確認してください:
  echo %DEST%\logs\
) else (
  echo バックアップが完了しました: %DEST%
)
pause
endlocal
