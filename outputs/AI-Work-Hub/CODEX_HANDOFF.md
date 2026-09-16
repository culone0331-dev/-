# AI Work Hub｜Codex 引き継ぎメモ

作成日: 2026-09-16
ブランチ: `claude/beautiful-knuth-4u6y8n`（このリポジトリ `culone0331-dev/-` の `outputs/AI-Work-Hub/`）

## 今回Claude Codeが行ったこと

1. `outputs/AI-Work-Hub/` に、依存ライブラリなし（Python標準ライブラリのみ）で
   会話の記録・引き継ぎを行うアプリを新規実装（`server.py` / `index.html` / `app.js` / `style.css`）。
2. 「この会話を渡す」を、送り先ボタンをタップするだけで
   「引き継ぎ文のコピー＋該当アプリを開く」が一度に終わるワンタップ操作に変更。
3. 会話の**取り込み元**を4通り（Codex／Claude Code／Claude／ChatGPT）から選べる
   「＋ 他のAIから取り込む」画面を追加。貼り付けた内容は`role: "ai"`として保存される。
4. **渡す先**はCodexとClaude Codeの2通りだけに絞った（Claude・ChatGPTは渡す先から除外）。
   理由：実際にコードを触れるのはこの2つだけで、チャット専用のClaude/ChatGPTへ
   渡す意味がないため。設定画面の開き先URL登録も、この2つのみに整理済み。

## 確認・お願いしたいこと

1. **Codexの開き先URL登録**：`data/store.json` の `destinations.codex` は空文字のままです。
   普段Codexを開いているURL（Sites/プロジェクトのURLなど）を、実機の「⚙ 設定」画面から
   登録してください（コード上のデフォルト値では決め打ちできないため）。
2. **実際の動作確認**：`python3 outputs/AI-Work-Hub/server.py` で起動し、
   「＋ 他のAIから取り込む」→ Codexを選んで何か貼り付け → 「この会話を渡す」→
   「→ Codexへ」をタップして、実際に登録したURLが開き、クリップボードに
   引き継ぎ文が入っているかを確認してください。
3. **コードレビュー**：`server.py` はスレッド安全性のために単純な`threading.Lock`で
   JSONファイル全体を読み書きしています。想定同時アクセス数が増える場合は
   見直しが必要かもしれません。

## 未着手（次にやると良いこと）

- culone-server側（`192.168.0.7:8787`）に残っている実データの移行。
- ローカルLLM（culone-server／AI2）の実際の接続先URL・モデル名の確認
  （`server.py` の `DEFAULT_STORE["local_llm_targets"]` は仮のOllama想定値）。
- Codex／Claude Codeでの検証結果をAI Work Hubへ書き戻す機能（今は一方向の引き継ぎのみ）。

## 作業前に

1. このファイル、`README.md`、`CLAUDE_CODE_HANDOFF.md` を読む。
2. `git log --oneline -6 -- outputs/AI-Work-Hub` で今回の変更点を確認する。
3. 作業ブランチは `codex/` で始める（`main` へ直接変更しない）。
