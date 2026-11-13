# 第2段階：再構築計画（下書き）

> 現状調査（report.txt）を受ける前の下書き。`【要調査】` の箇所は調査結果で確定させる。
> ここに書いたコマンドはまだ **一切実行していない**。各ステップはユーザー承認後に実行する。

## 1. 目標構成

```
 Xiaomi 17 Ultra
      │  Tailscale (WireGuard 暗号化 / tailnet 内のみ)
      ▼
 ┌─────────────── MS-02 Ultra (Windows 11) ───────────────┐
 │ tailscale serve (HTTPS, tailnet 限定・funnel 無効)       │
 │   :443  → 127.0.0.1:3000  Open WebUI   (Docker)          │
 │   :8443 → 127.0.0.1:5678  n8n          (Docker)          │
 │   :9443 → 127.0.0.1:8765  管理画面     (Windows ネイティブ)│
 │                                                          │
 │ Ollama  127.0.0.1:11434   (ネイティブ / RTX PRO 4000)    │
 │ Strata  【要調査】ポート・API 形式                         │
 │                                                          │
 │ Windows ファイアウォール: LAN/インターネットからの受信は  │
 │   SMB 等の既存必要分以外すべて遮断                         │
 └──────────────────────────┬───────────────────────────────┘
                            │ SMB (LAN)
                            ▼
                UGREEN DXP4800 Plus  \\NAS\backup\ms02-ultra\ （新規フォルダのみ使用）
```

| 役割 | 採用 | 実行方式 | 理由 |
|---|---|---|---|
| LLM 実行 | Ollama | Windows ネイティブ | GPU ドライバを直接使える。WSL 経由より安定 |
| LLM 実行 | Strata | 【要調査】 | API が OpenAI 互換なら Open WebUI に「OpenAI 接続」として追加 |
| チャット画面 | Open WebUI | Docker | 更新・バックアップがボリューム単位で簡単 |
| 自動化 | n8n | Docker | 同上。暗号化キーを .env で固定管理 |
| 遠隔アクセス | Tailscale serve | ネイティブ | ポートを外部公開せずに HTTPS 化。証明書自動 |
| 保存 | NAS | SMB | バックアップ・n8n の出力先（専用サブフォルダ） |
| 管理画面 | 新規作成（後述） | ネイティブ | モデル起動/停止 + CPU/GPU/RAM 監視 |

## 2. 想定される問題点（調査で確認）

| 区分 | 確認内容 |
|---|---|
| 重複 | Open WebUI / n8n が Docker とネイティブ（pip / npm）の両方に入っていないか |
| 重複 | Ollama が Windows 版と Docker 版（または WSL 内）で二重起動していないか（11434 の取り合い） |
| 公開範囲 | 3000 / 5678 / 11434 が `0.0.0.0`（全IF）で待ち受けていないか → 127.0.0.1 に限定 |
| 公開範囲 | Tailscale funnel（インターネット公開）が有効になっていないか |
| 公開範囲 | Docker API 2375 が TLS なしで開いていないか |
| Tailscale | MS-02 がどのデバイス名で登録されているか（現在オフラインの `culone*` のどれか / 未登録か） |
| Tailscale | 売却済み AI X1 Pro 2台の登録が残っていないか（**売却済み端末のキーは失効させるべき**） |
| n8n | 暗号化キーの所在（`.n8n/config` か環境変数か）。ワークフローに平文のキーが書かれていないか |
| 自動起動 | Windows 再起動後、サインインなしで各サービスが起動するか / スリープが無効か |
| WSL | `.wslconfig` のメモリ上限（224GB 中どれだけ WSL に渡すか） |

## 3. バックアップ対象（優先度順）

| 優先 | 対象 | 方法 | 復元できないと |
|---|---|---|---|
| ★★★ | n8n 暗号化キー | `config` / `.env` をコピー | 全認証情報を再入力 |
| ★★★ | n8n ワークフロー・認証情報 | `n8n export:* --backup` | ワークフロー消失 |
| ★★★ | Open WebUI データ（webui.db・アップロード・RAG） | ボリュームを tar.gz | ユーザー・会話履歴消失 |
| ★★ | compose 定義・`.env`・コンテナ定義 | ファイルコピー / `docker inspect` | 再構築に時間 |
| ★★ | Strata 設定 | フォルダコピー（モデル除く） | 再設定 |
| ★ | Ollama 自作 Modelfile | `ollama show --modelfile` | 再作成 |
| ★ | Ollama / Strata モデル本体 | robocopy（任意） | 再ダウンロード（時間のみ） |

スクリプト: [`../backup/Backup-AiServer.ps1`](../backup/Backup-AiServer.ps1)（既定は確認モード）

## 4. 実行予定の手順（すべて承認後）

### Step 1 バックアップ
```powershell
# まず確認モードで対象と容量を表示（何も書き込まない）
.\Backup-AiServer.ps1 -Destination '\\<NAS>\<共有>\ms02-ultra'
# 承認後に実行
.\Backup-AiServer.ps1 -Destination '\\<NAS>\<共有>\ms02-ultra' -Execute
```

### Step 2 復元テスト（既存環境には触れない）
別名の検証用コンテナを 127.0.0.1 の別ポートで起動し、バックアップから復元できるか確認する。
```powershell
docker volume create n8n-restore-test
docker run --rm -d --name n8n-restore-test -p 127.0.0.1:15678:5678 `
  -e N8N_ENCRYPTION_KEY=<バックアップのキー> -v n8n-restore-test:/home/node/.n8n docker.n8n.io/n8nio/n8n:<同バージョン>
docker cp <バックアップ>\workflows   n8n-restore-test:/tmp/wf
docker cp <バックアップ>\credentials n8n-restore-test:/tmp/cr
docker exec n8n-restore-test n8n import:workflow --separate --input=/tmp/wf
docker exec n8n-restore-test n8n import:credentials --separate --input=/tmp/cr
# → http://127.0.0.1:15678 でワークフローと認証情報が開けることを確認後、検証用コンテナとボリュームを削除
```
Open WebUI も同様に `open-webui-restore-test` ボリュームへ tar を展開し、127.0.0.1:13000 でログインできるか確認する。

### Step 3 整理（復元確認後）
調査結果で特定した重複インストール・停止中の古いコンテナ・未使用ボリューム/イメージを **1件ずつ一覧で提示して承認を得てから** 削除する。`docker system prune` のような一括削除は使わない。

### Step 4 新構成の起動
```powershell
cd home-ai-server\compose
copy .env.example .env   # 値を設定（暗号化キーは既存のもの）
docker compose up -d
```
Ollama を 127.0.0.1 限定にする（コンテナからは host.docker.internal 経由で届くことを検証。届かない場合は
`OLLAMA_HOST=0.0.0.0` + ファイアウォールで受信を 127.0.0.1 / Docker 内部ネットワークのみに制限）。

### Step 5 Tailscale serve（tailnet 内のみ HTTPS 公開）
```powershell
tailscale serve --bg --https=443  http://127.0.0.1:3000
tailscale serve --bg --https=8443 http://127.0.0.1:5678
tailscale serve --bg --https=9443 http://127.0.0.1:8765
tailscale funnel status   # 「インターネット公開なし」を確認
```
スマホから `https://<MS-02 の MagicDNS 名>/` でアクセス。

### Step 6 自動起動
- Docker Desktop: 「Windows サインイン時に起動」+ 各コンテナ `restart: unless-stopped`
- Ollama: スタートアップ登録（既定）。サインイン不要で起動させたい場合はタスクスケジューラ「起動時」に登録
- Tailscale: Windows サービス（「Run unattended」を有効にしてサインイン前から接続）
- 電源: スリープ無効・停電復帰後に自動起動（BIOS 設定）
- 自動サインインが必要になる場合はセキュリティとのトレードオフを別途相談

### Step 7 Tailscale の古いデバイス整理
MS-02 / スマホ / NAS を特定した後、売却済み端末と不明端末を **一覧で提示して承認を得てから** 管理画面で削除する。

## 5. 管理画面（モデル起動・停止・監視）

Open WebUI の管理画面でもモデルの取得・削除はできるが、**ロード中モデルの停止**と **GPU/CPU/RAM の監視**は無い。
そこで小さな管理画面を Windows ネイティブで作る案を推奨する。

| 機能 | 実装 |
|---|---|
| Ollama モデル一覧 / ロード中 | `GET /api/tags`, `GET /api/ps` |
| 起動（プリロード） | `POST /api/generate {model, keep_alive:"30m"}` |
| 停止（アンロード） | `POST /api/generate {model, keep_alive:0}` |
| Strata の起動/停止/切替 | 【要調査】API または CLI |
| GPU 監視 | `nvidia-smi --query-gpu=... --format=csv`（VRAM / 使用率 / 温度 / 電力） |
| CPU / RAM 監視 | Windows パフォーマンスカウンタ |
| サービス状態 | Docker コンテナ / Tailscale / NAS 接続 |
| 認証 | 127.0.0.1 のみで待受 + Tailscale serve 経由 + ログイン（パスワード or Tailscale ID ヘッダー） |

## 6. リスクと復旧方法

| 変更 | リスク | 復旧 |
|---|---|---|
| コンテナ再作成 | データ消失 | 名前付きボリュームは残る。消えた場合は tar.gz から展開 |
| n8n の暗号化キー変更 | 認証情報が全て復号不能 | キーは変えない。バックアップの `config` / `.env` から戻す |
| Open WebUI / n8n のバージョン更新 | DB マイグレーション後に旧版へ戻せない | 更新前に Step 1 を実施。同バージョンで一度移行してから更新 |
| ポートを 127.0.0.1 に限定 | LAN 内の他端末から使えなくなる | Tailscale 経由で使う。必要なら compose の ports を戻す |
| ファイアウォール規則変更 | 必要な通信まで遮断 | 変更前に `netsh advfirewall export` で規則を保存し、`import` で戻す |
| Tailscale デバイス削除 | 使用中端末を誤削除 | 再ログインで再登録可能（IP は変わる） |
| Ollama の OLLAMA_HOST 変更 | コンテナから届かない | 環境変数を元に戻して Ollama 再起動 |
