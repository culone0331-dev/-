# AI Work Hub

スマホから「話す／書く」→「これを残す」だけで作業メモを記録し、あとから Codex / Claude Code / ChatGPT / Claude / ローカルLLM へ引き継げるツールです。

依存ライブラリなし（Python標準ライブラリのみ）で動きます。

## 使い方

```bash
cd outputs/AI-Work-Hub
python3 server.py
# もしくはポートを変える場合
AI_WORK_HUB_PORT=8787 python3 server.py
```

起動後、`http://<このPCのIP>:8787/` をスマホなど同じネットワーク内の端末から開きます。

## 基本の流れ

1. 受信箱で「＋ 新しい会話をはじめる」→ 会話名と「今回の相手」を選ぶ（あとで決めてもよい）
2. 「話す／書く」→「これを残す」で発言ごとに自動保存
3. 「今日はここまで」で、次にどのAIで検証するかだけを記録（送信はしない）
4. 続きは受信箱から会話を開いて再開
5. 「この会話を渡す」で、送り先（Codex / Claude Code / ChatGPT / Claude）を選び、
   「引き継ぎ文を作る」→「引き継ぎ文をコピー」→「コピー後に送り先を開く」で、
   開いた先に貼り付けて送信する

外部AIへの自動送信は行いません（各サービスが自動投稿APIを提供していないため）。
「今回の相手」がローカルLLM（culone-server / AI2）の場合のみ、コピー・貼り付けなしで直接チャットできます（Ollama互換APIを想定）。

## 設定

「⚙ 設定」画面で、ChatGPT / Claude / Claude Code / Codex を開くURLを登録します。
ChatGPTの「共有リンク」は登録しないでください（会話の公開用スナップショットのため）。

ローカルLLMの接続先（URL・モデル名）は `server.py` の `DEFAULT_STORE["local_llm_targets"]`、
または起動後に生成される `data/store.json` を直接編集して変更します。

## データの保存先

`data/store.json`（Git管理外）に、会話・メッセージ・設定をまとめて保存します。
バックアップする場合はこのファイルをコピーしてください。

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `server.py` | APIサーバー（会話の保存・引き継ぎ文生成・ローカルLLM呼び出し） |
| `index.html` / `app.js` / `style.css` | フロントエンド（会話中心のスマホ向けUI） |
| `data/store.json` | 実行時に作成される保存データ（Git管理外） |
| `CLAUDE_CODE_HANDOFF.md` | Claude Code向けの引き継ぎメモ |

## Codex / Claude Code との共同作業

- 基準ブランチ・ブランチ命名は、このリポジトリ直下の `CLAUDE_CODE_DESIGN_AND_REVIEW.md`（他プロジェクト向け）と同様に、
  Claude Codeは `claude/` で始まる作業ブランチ、Codexは `codex/` で始まる作業ブランチを使います。
- 変更後は `python3 server.py` を起動し、受信箱→新規会話→これを残す→今日はここまで→この会話を渡す、の一連の流れを手動確認してください。
- 大きな仕様変更（保存データの構造、認証の追加など）は、先に相談してから進めてください。
