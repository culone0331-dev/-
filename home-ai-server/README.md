# 自宅AIサーバー環境 再構築プロジェクト

MINISFORUM MS-02 Ultra（Windows 11 / RTX PRO 4000 Blackwell SFF / RAM 224GB）を中心に、
Ollama・Strata・Open WebUI・n8n・Tailscale・UGREEN NAS の構成を再構築する。

| 段階 | 内容 | 状態 |
|---|---|---|
| 第1段階 | 現状調査（読み取り専用） | **スクリプト準備済み → MS-02 で実行待ち** |
| 第2段階 | 再構築計画 | **下書き済み**（`docs/phase2-plan.md`）→ 調査結果で確定 |
| 第3段階 | バックアップ → 復元確認 → 整理・再構築 | **スクリプト下書き済み**（`backup/`, `compose/`）→ 承認後に実施 |

## ファイル

| パス | 内容 |
|---|---|
| `survey/Invoke-AiServerSurvey.ps1` | 第1段階 現状調査（読み取り専用） |
| `docs/phase2-plan.md` | 第2段階 再構築計画の下書き（構成・手順・リスク） |
| `backup/Backup-AiServer.ps1` | 第3段階 バックアップ（既定は確認モード。`-Execute` で実行） |
| `compose/docker-compose.yml` | 新構成の下書き（Open WebUI + n8n、127.0.0.1 限定公開） |
| `compose/.env.example` | 上記の設定テンプレート（`.env` は Git に入れない） |

## 作業ルール

- 削除・アンインストール・初期化・既存サービスの停止・ネットワーク設定変更は **明示的な承認を得るまで実行しない**
- インターネットへの直接ポート公開は禁止。遠隔アクセスは Tailscale のみ
- APIキー・パスワード・暗号化キーをログやレポートに出さない
- NAS の既存データは変更しない

---

## 第1段階：現状調査の実行手順

### 1. スクリプトを MS-02 Ultra にコピー

`survey/Invoke-AiServerSurvey.ps1` を MS-02 のデスクトップなどに保存する。

### 2. PowerShell を「管理者として実行」で開く

管理者でなくても動くが、ファイアウォール規則などが取れない項目がある。

### 3. 実行

```powershell
cd $env:USERPROFILE\Desktop
powershell -NoProfile -ExecutionPolicy Bypass -File .\Invoke-AiServerSurvey.ps1
```

- `-ExecutionPolicy Bypass` は **このプロセスだけ** に効く。システムの実行ポリシーは変更しない
- ダウンロードしたファイルがブロックされる場合: `Unblock-File .\Invoke-AiServerSurvey.ps1`（ファイル属性の変更のみ）
- 所要時間: 数分（NAS 疎通確認やファイアウォール規則の列挙に時間がかかる）
- Docker Desktop・Ollama・Strata・n8n は **起動した状態で** 実行すると情報が多く取れる（スクリプトは起動も停止もしない）

### 4. 結果

デスクトップに `ai-server-survey-<日時>\report.txt` ができる。
**中身を目視確認してから** その内容をこのチャットに貼り付けるか、ファイルを共有する。

---

## スクリプトの調査項目

| # | 項目 | 取得内容 |
|---|---|---|
| 1 | PC 情報 | コンピューター名、Windows エディション/バージョン/ビルド、電源・スリープ設定 |
| 2 | ハードウェア | CPU、RAM（合計・モジュール別）、GPU（Windows 認識 + `nvidia-smi`）、ディスク |
| 3 | Tailscale | インストール、サービス、自デバイスの IP/ホスト名、tailnet 内の全デバイスと最終接続日時、serve/funnel 設定 |
| 4 | Docker | Desktop/サービス状態、WSL ディストリ、`.wslconfig`、コンテナ（イメージ・再起動ポリシー・compose 情報・公開ポート・マウント・GPU 割当）、ボリューム、ネットワーク、イメージ、ディスク使用量 |
| 5 | Ollama | バージョン、`ollama list`/`ps`、`OLLAMA_*` 環境変数、モデル保存先とサイズ、API 応答 |
| 6 | Strata | 名前一致でインストール・プロセス・サービス・フォルダを検索、設定ファイル名と JSON キー名、モデルファイル、待受ポートと API 互換性（`/v1/models`, `/api/tags` 等） |
| 7 | Open WebUI | Docker / pip / ネイティブのどれで動いているか、データフォルダ、応答 |
| 8 | n8n | 実行方式、データフォルダ、暗号化キーの **有無**（値は出さない）、ワークフロー一覧（ID と名前） |
| 9 | NAS | マップ済みドライブ、SMB 接続、保存済み資格情報の対象名、`dxp4800plus-c39` / `100.116.226.85` への疎通と共有一覧 |
| 10 | ネットワーク | 待受ポート全件と待受範囲（localhost のみ / 全IF）、主要ポート、ファイアウォール プロファイルと受信許可ルール、UPnP |
| 付録 | 自動起動 | 関連サービス、Run キー、スタートアップフォルダ、スケジュールタスク |

### 安全性について

- 実行するのは `Get-*`・`docker ps/inspect/ls`・`ollama list`・`tailscale status` などの **参照系コマンドと HTTP GET のみ**
- `docker exec` は n8n コンテナ内で `ls` / `cat config`（キー名だけ抽出し値は破棄）/ `n8n list:workflow` を実行するだけ
- 出力は保存前にマスク処理（`password=`, `token`, `apiKey`, `tskey-…`, `Bearer …`, JWT など）
- コンテナの環境変数は **名前のみ** 出力し、値は出さない
- 書き込み先は出力フォルダのみ

---

## 調査後に報告する内容

1. 現在の構成
2. 問題点と重複設定
3. バックアップ対象
4. 推奨する新構成
5. 実行予定のコマンド
6. 変更によるリスクと復旧方法

## 事前に判明している確認ポイント

- Tailscale に MS-02 らしきデバイスが見当たらない（`culone*` 4台はすべてオフライン）。売却済みの AI X1 Pro 2台の登録が残っている可能性が高い → report の「自デバイス詳細」で MS-02 のホスト名を特定してから、不要な登録を削除候補にする
- NAS (`dxp4800plus-c39`) も Tailscale 上でオフライン → LAN 経由で接続しているか要確認
- n8n の暗号化キーは、ワークフローの認証情報を復元するのに **必須**。バックアップの最優先対象
- Strata の API 仕様（OpenAI 互換か Ollama 互換か）は第6項の API 応答で判断する
