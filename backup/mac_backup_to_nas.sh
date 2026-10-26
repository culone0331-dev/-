#!/bin/bash
# ============================================================
#  Mac のデータ（ホームフォルダ）を NAS にバックアップ
#  使い方: Finder で NAS の共有フォルダを開いて（マウントして）から、
#          下の NAS_DIR を書き換え、ターミナルで
#          bash mac_backup_to_nas.sh
# ============================================================
set -u

# ▼ マウントした NAS の共有フォルダ（Finder で開くと /Volumes/<共有名> になります）
NAS_DIR="/Volumes/backup"

if [ ! -d "$NAS_DIR" ]; then
  echo "[エラー] NAS が見つかりません: $NAS_DIR"
  echo "Finder の「移動」→「サーバへ接続」で NAS に接続してから再実行してください。"
  exit 1
fi

DEST="$NAS_DIR/$(scutil --get ComputerName)/$USER"
mkdir -p "$DEST"

echo "=== ホームフォルダ（書類・写真・デスクトップ・ダウンロード等）をコピー中 ==="
# 変更のあったファイルだけをコピーするので、途中で止めても再実行すれば続きから進みます
rsync -rltvh --progress \
  --exclude "Library/" \
  --exclude ".Trash/" \
  --exclude ".DS_Store" \
  "$HOME/" "$DEST/"

if [ $? -eq 0 ]; then
  echo "バックアップが完了しました: $DEST"
else
  echo "[警告] 一部のファイルをコピーできませんでした。上のメッセージを確認してください。"
fi
