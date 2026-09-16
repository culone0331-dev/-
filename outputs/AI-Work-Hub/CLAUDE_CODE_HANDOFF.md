# AI Work Hub｜Claude Code 引き継ぎメモ

作成日: 2026-09-16

## これは何か

もともと culone-server（自宅LAN上のローカル環境、`http://192.168.0.7:8787/`）で
別セッションが育ててきた「AI Work Hub」を、GitHubで Codex / Claude Code と
同期して共同作業できるようにするため、この `outputs/AI-Work-Hub/` に
会話履歴の説明をもとに一から実装し直したものです。

culone-server側の実データ（保存済みの会話、引き継ぎコードなど）はこのリポジトリからは
見えないため、機能・画面構成のみを再現しています。実データを引き継ぐ場合は、
culone-server側の `data/store.json`（または相当するファイル）をこの実装の
`data/store.json` 形式に合わせて移行してください。

## 目的（culone-server側での経緯）

- 最初は「分類を先に決める」画面で、スマホから思いつきを残すには不便だった。
- 会話中心の画面に作り直し、話す／書く→「これを残す」だけで受信箱に残るようにした。
- 次に「送信したらどこへ行くのか分からない」という声を受け、
  culone-server内に自動保存し、「今日はここまで」で次の検証先（ローカルLLM／Codex／Claude Code／ChatGPT）を
  記録できるようにした。
- 次に「送り方が分からない」という声を受け、「この会話を渡す」ボタンで
  会話履歴＋次の依頼をまとめた「引き継ぎ文」を自動生成し、コピーできるようにした。
- 最後に「アカウントにつなげたい」という要望を受け、ChatGPT・Claude・Codexの
  ログイン済みURLを登録し、コピー後にそのまま開けるようにした。
- ローカルLLM（culone-server／サブPC AI2）だけは、コピー・貼り付けなしで直接チャットできる想定。

## 今の実装（この outputs/AI-Work-Hub/ での再実装）

- `server.py`：Python標準ライブラリのみのHTTPサーバー。会話の保存、
  「今日はここまで」の次予定保存、「この会話を渡す」の引き継ぎ文生成、
  ローカルLLM（Ollama互換API想定）への直接呼び出しを提供。
- `index.html` / `app.js` / `style.css`：スマホ最優先の会話中心UI。
- 外部AI（Codex / ChatGPT / Claude / Claude Code）への自動送信は行わない。
  常に「引き継ぎ文をコピー→送り先を開く→貼り付けて送信」という手動確認ステップを挟む。

## 未確認・未実装のこと

1. culone-server側の実データ（既存の会話・引き継ぎコード）の移行。
2. ローカルLLM（culone-server／AI2）の実際の接続先URL・モデル名の確認（`server.py` の
   `DEFAULT_STORE["local_llm_targets"]` は仮のOllama想定値）。
3. Codexの普段使う開き先URLの登録（ユーザー自身が「設定」画面で入力する想定）。
4. 実際の作業を一件選び、記録→今日はここまで→引き継ぎ→検証、までを通しで動作確認すること。
5. 「今日はここまで」後にローカルLLMでの検証を自動実行する導線（現状は会話を開き直す形）。
6. Codex／ChatGPT／Claude／Claude Codeでの検証結果をAI Work Hubへ書き戻し、
   比較・相互検証の履歴として保存する機能。

## 作業前に確認すること

1. このファイルと `README.md` を読む。
2. `git status` と `git log -5 --oneline -- outputs/AI-Work-Hub` を確認する。
3. `python3 outputs/AI-Work-Hub/server.py` を起動し、受信箱→新規会話→これを残す→
   今日はここまで→この会話を渡す、の流れをスマホ幅のブラウザで確認する。
4. 保存データの構造（`data/store.json`）を変える場合は、先に相談する。

## ブランチ運用

- 基準ブランチ: このリポジトリの既定ブランチ
- Claude Codeが作業する場合は `claude/` で始まる作業ブランチを使う。
- Codexが作業する場合は `codex/` で始まる作業ブランチを使う。
- `main` へ直接変更しない。
