#!/usr/bin/env python3
"""AI Work Hub — 案件ごとの共有作業台帳サーバー。

依存ライブラリなし（Python標準ライブラリのみ）で動作する。

このファイルは「会話を記録するツール」ではなく、ChatGPT・Codex・Claude・
Claude Code・ローカルLLMが同じ案件の目的・原文・判断・未確認点・回答を
共有するための台帳を提供する（outputs/AI-Work-Hub/AI_WORK_HUB_SHARED_WORKSPACE_SPEC.md
を参照）。
"""
import json
import os
import threading
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
STORE_PATH = DATA_DIR / "store.json"
PORT = int(os.environ.get("AI_WORK_HUB_PORT", "8787"))

# Codexはculone-server上のデスクトップアプリで、スマホから開く固定URLがない。
# そのためcodexだけは空URLを正常状態として扱う（設定不足エラーにしない）。
DEFAULT_STORE = {
    "cases": {},
    # ローカルLLMへの依頼は案件と分けて保持する。これにより、応答待ちの間も
    # 画面操作や別のAI2/culone-serverへの依頼を止めない。
    "jobs": {},
    "destinations": {
        "chatgpt": "https://chatgpt.com/",
        "claude_code": "https://claude.ai/code",
        "codex": "",
    },
    # 接続先・モデル名は仮値を決め打ちしない。空のまま提供し、
    # 実環境の値は「設定」画面から利用者・Codexが入力する。
    "local_llm_targets": {
        "culone-server": {"label": "ローカルLLM：culone-server", "url": "", "model": ""},
        "ai2": {"label": "ローカルLLM：AI2", "url": "", "model": ""},
    },
}

SOURCE_LABELS = {
    "user": "利用者",
    "chatgpt": "ChatGPT",
    "codex": "Codex",
    "claude": "Claude",
    "claude_code": "Claude Code",
}

HANDOFF_TARGETS = ("codex", "claude_code", "chatgpt")

_lock = threading.Lock()
_target_locks = {}
_target_locks_guard = threading.Lock()


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _short_id():
    return uuid.uuid4().hex[:8]


def load_store():
    if not STORE_PATH.exists():
        save_store(json.loads(json.dumps(DEFAULT_STORE)))
    with open(STORE_PATH, "r", encoding="utf-8") as f:
        store = json.load(f)
    for key, value in DEFAULT_STORE.items():
        store.setdefault(key, value)
    return store


def target_lock(target_key):
    """同じ推論機には一件ずつ、別の推論機どうしは並列で実行する。"""
    with _target_locks_guard:
        if target_key not in _target_locks:
            _target_locks[target_key] = threading.Lock()
        return _target_locks[target_key]


def job_summary(job):
    return {
        "id": job["id"], "case_id": job["case_id"], "target_key": job["target_key"],
        "target_label": job["target_label"], "status": job["status"],
        "created_at": job["created_at"], "started_at": job.get("started_at"),
        "completed_at": job.get("completed_at"), "error": job.get("error"),
    }


def jobs_for_case(store, case_id):
    jobs = [job_summary(job) for job in store.get("jobs", {}).values() if job["case_id"] == case_id]
    return sorted(jobs, key=lambda job: job["created_at"], reverse=True)


def save_store(store):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = STORE_PATH.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, indent=2)
    tmp_path.replace(STORE_PATH)


def source_label(key, store):
    if key.startswith("local_llm_"):
        target_key = key[len("local_llm_"):]
        target = store.get("local_llm_targets", {}).get(target_key)
        return target["label"] if target else key
    return SOURCE_LABELS.get(key, key)


def new_case(title, purpose):
    now = _now()
    return {
        "id": uuid.uuid4().hex[:12],
        "title": title,
        "purpose": purpose,
        "status_note": "",
        "next_owner": None,
        "raw_entries": [],
        "ai_entries": [],
        "decisions": [],
        "open_questions": [],
        "handoffs": [],
        "created_at": now,
        "updated_at": now,
    }


def case_summary(case):
    last_raw = case["raw_entries"][-1] if case["raw_entries"] else None
    last_ai = case["ai_entries"][-1] if case["ai_entries"] else None
    return {
        "id": case["id"],
        "title": case["title"],
        "purpose": case["purpose"],
        "status_note": case["status_note"],
        "next_owner": case["next_owner"],
        "updated_at": case["updated_at"],
        "raw_count": len(case["raw_entries"]),
        "ai_count": len(case["ai_entries"]),
        "last_raw_text": last_raw["text"] if last_raw else None,
        "last_ai_text": last_ai["text"] if last_ai else None,
    }


def build_handoff_package(case, target_label, version, store):
    lines = [
        f"# 引き継ぎ: {case['title'] or '(無題の案件)'} — v{version}",
        "",
        "AI Work Hub からの引き継ぎパッケージです。",
        f"- 目的: {case['purpose'] or '(未設定)'}",
        f"- 現在地: {case['status_note'] or '(未設定)'}",
        f"- 渡す先: {target_label}",
        f"- 作成日時: {_now()}",
        f"- 版: {version}",
        "",
        "## 利用者の原文",
    ]
    if not case["raw_entries"]:
        lines.append("(まだ記録がありません)")
    for e in case["raw_entries"]:
        lines.append(f"- {e['text']}")

    lines.append("")
    lines.append("## これまでのAI回答")
    if not case["ai_entries"]:
        lines.append("(まだありません)")
    for e in case["ai_entries"]:
        lines.append(f"- [{source_label(e['source'], store)}] {e['text']}")

    lines.append("")
    lines.append("## 決まったこと")
    if not case["decisions"]:
        lines.append("(まだありません)")
    for e in case["decisions"]:
        lines.append(f"- {e['text']}")

    lines.append("")
    lines.append("## 未確認点（推測で進めないこと）")
    open_qs = [e for e in case["open_questions"] if not e["resolved"]]
    if not open_qs:
        lines.append("(現時点でなし)")
    for e in open_qs:
        lines.append(f"- {e['text']}")

    lines.append("")
    lines.append("## 次にやってほしいこと")
    lines.append(case["status_note"] or "上記を踏まえて、続きを進めてください。")
    lines.append("")
    lines.append("不明な点は推測せず、現状を確認してから安全に進めてください。")
    return "\n".join(lines)


def build_local_llm_prompt(case):
    lines = [
        "あなたは案件の独立したローカル検証担当です。日本語で、"
        "(1)結論 (2)見落とし・未確認点 (3)安全な次の一手、の順に短く回答してください。"
    ]
    if case["purpose"]:
        lines.append(f"目的: {case['purpose']}")
    timeline = sorted(
        [("raw", e) for e in case["raw_entries"]] + [("ai", e) for e in case["ai_entries"]],
        key=lambda pair: pair[1]["at"],
    )
    for kind, e in timeline[-20:]:
        tag = "利用者" if kind == "raw" else e["source"]
        lines.append(f"[{tag}] {e['text']}")
    return "\n".join(lines)


def call_local_llm(target, prompt):
    payload = json.dumps(
        {"model": target.get("model") or "", "prompt": prompt, "stream": False}
    ).encode("utf-8")
    req = urllib.request.Request(
        target["url"], data=payload, headers={"Content-Type": "application/json"}
    )
    try:
        # 70B級の初回読込でも、画面や他案件を止めずに待てるようにする。
        with urllib.request.urlopen(req, timeout=900) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            reply = (data.get("response") or "").strip()
            return (reply or None), None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        return None, str(exc)


def run_local_llm_job(job_id):
    """一件のローカルLLM依頼をバックグラウンドで実行する。"""
    with _lock:
        store = load_store()
        job = store.get("jobs", {}).get(job_id)
        if not job:
            return
        target_key = job["target_key"]

    # 同じ推論機でのメモリ競合は避け、AI2とculone-server間は同時に動かす。
    with target_lock(target_key):
        with _lock:
            store = load_store()
            job = store.get("jobs", {}).get(job_id)
            if not job:
                return
            case = store["cases"].get(job["case_id"])
            target = store["local_llm_targets"].get(target_key)
            if not case or not target or not target.get("url") or not target.get("model"):
                job["status"] = "failed"
                job["error"] = "案件またはローカルLLM設定が見つかりません。"
                job["completed_at"] = _now()
                save_store(store)
                return
            job["status"] = "running"
            job["started_at"] = _now()
            save_store(store)
            prompt = build_local_llm_prompt(case)

        reply, error = call_local_llm(target, prompt)

        with _lock:
            store = load_store()
            job = store.get("jobs", {}).get(job_id)
            case = store["cases"].get(job["case_id"]) if job else None
            if not job:
                return
            job["completed_at"] = _now()
            if reply and case:
                case["ai_entries"].append(
                    {"id": _short_id(), "source": f"local_llm_{target_key}", "text": reply, "at": _now()}
                )
                case["updated_at"] = _now()
                job["status"] = "completed"
                job["error"] = None
            else:
                job["status"] = "failed"
                job["error"] = error or "ローカルLLMから応答がありません。"
            save_store(store)


class Handler(BaseHTTPRequestHandler):
    server_version = "AIWorkHub/0.2"

    def _send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path, content_type):
        try:
            body = path.read_bytes()
        except FileNotFoundError:
            self._send_json({"error": "not found"}, 404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def log_message(self, format, *args):
        pass

    # ---------- GET ----------

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/", "/index.html", "/share-target"):
            # /share-target: Androidの共有メニュー（Web Share Target）から遷移してくる先。
            # 送られた内容はクエリ文字列(?title=&text=&url=)に載っているので、
            # 同じSPAを返し、起動時にapp.js側でクエリを読んで取り込み画面へ誘導する。
            self._send_file(BASE_DIR / "index.html", "text/html; charset=utf-8")
        elif path == "/app.js":
            self._send_file(BASE_DIR / "app.js", "text/javascript; charset=utf-8")
        elif path == "/style.css":
            self._send_file(BASE_DIR / "style.css", "text/css; charset=utf-8")
        elif path == "/manifest.json":
            self._send_file(BASE_DIR / "manifest.json", "application/manifest+json; charset=utf-8")
        elif path == "/icons/icon-192.png":
            self._send_file(BASE_DIR / "icons" / "icon-192.png", "image/png")
        elif path == "/icons/icon-512.png":
            self._send_file(BASE_DIR / "icons" / "icon-512.png", "image/png")
        elif path == "/api/cases":
            with _lock:
                store = load_store()
            cases = sorted(store["cases"].values(), key=lambda c: c["updated_at"], reverse=True)
            self._send_json({"cases": [case_summary(c) for c in cases]})
        elif path.startswith("/api/cases/"):
            case_id = path.split("/")[3]
            with _lock:
                store = load_store()
            case = store["cases"].get(case_id)
            if not case:
                self._send_json({"error": "案件が見つかりません。"}, 404)
                return
            payload = dict(case)
            payload["jobs"] = jobs_for_case(store, case_id)
            self._send_json({"case": payload})
        elif path == "/api/jobs":
            with _lock:
                store = load_store()
            jobs = sorted(
                (job_summary(job) for job in store.get("jobs", {}).values()),
                key=lambda job: job["created_at"], reverse=True,
            )
            self._send_json({"jobs": jobs})
        elif path == "/api/destinations":
            with _lock:
                store = load_store()
            self._send_json(
                {"destinations": store["destinations"], "local_llm_targets": store["local_llm_targets"]}
            )
        else:
            self._send_json({"error": "not found"}, 404)

    # ---------- POST ----------

    def do_POST(self):
        path = urlparse(self.path).path
        segments = [s for s in path.split("/") if s]

        if path == "/api/cases":
            self._create_case()
            return

        if len(segments) >= 4 and segments[0] == "api" and segments[1] == "cases":
            self._case_action(segments)
            return

        if path == "/api/destinations":
            self._update_destinations()
            return

        if path == "/api/local-llm-targets":
            self._update_local_llm_targets()
            return

        self._send_json({"error": "not found"}, 404)

    def _create_case(self):
        body = self._read_json()
        title = (body.get("title") or "").strip()
        purpose = (body.get("purpose") or "").strip()
        raw_text = (body.get("raw_text") or "").strip()
        ai_source = (body.get("ai_source") or "").strip()
        ai_text = (body.get("ai_text") or "").strip()
        with _lock:
            store = load_store()
            case = new_case(title, purpose)
            if raw_text:
                case["raw_entries"].append({"id": _short_id(), "text": raw_text, "at": _now()})
            if ai_source and ai_text:
                case["ai_entries"].append(
                    {"id": _short_id(), "source": ai_source, "text": ai_text, "at": _now()}
                )
            store["cases"][case["id"]] = case
            save_store(store)
        self._send_json({"case": case}, 201)

    def _case_action(self, segments):
        case_id = segments[2]
        action = segments[3]

        if action == "raw":
            body = self._read_json()
            text = (body.get("text") or "").strip()
            if not text:
                self._send_json({"error": "本文を入力してください。"}, 400)
                return
            with _lock:
                store = load_store()
                case = store["cases"].get(case_id)
                if not case:
                    self._send_json({"error": "案件が見つかりません。"}, 404)
                    return
                case["raw_entries"].append({"id": _short_id(), "text": text, "at": _now()})
                case["updated_at"] = _now()
                save_store(store)
            self._send_json({"case": case})
            return

        if action == "ai-response":
            body = self._read_json()
            source = (body.get("source") or "").strip()
            text = (body.get("text") or "").strip()
            if not text or not source:
                self._send_json({"error": "出所と本文を入力してください。"}, 400)
                return
            with _lock:
                store = load_store()
                case = store["cases"].get(case_id)
                if not case:
                    self._send_json({"error": "案件が見つかりません。"}, 404)
                    return
                case["ai_entries"].append(
                    {"id": _short_id(), "source": source, "text": text, "at": _now()}
                )
                case["updated_at"] = _now()
                save_store(store)
            self._send_json({"case": case})
            return

        if action == "decision":
            body = self._read_json()
            text = (body.get("text") or "").strip()
            if not text:
                self._send_json({"error": "本文を入力してください。"}, 400)
                return
            with _lock:
                store = load_store()
                case = store["cases"].get(case_id)
                if not case:
                    self._send_json({"error": "案件が見つかりません。"}, 404)
                    return
                case["decisions"].append({"id": _short_id(), "text": text, "at": _now()})
                case["updated_at"] = _now()
                save_store(store)
            self._send_json({"case": case})
            return

        if action == "open-question":
            if len(segments) >= 6 and segments[5] == "resolve":
                question_id = segments[4]
                with _lock:
                    store = load_store()
                    case = store["cases"].get(case_id)
                    if not case:
                        self._send_json({"error": "案件が見つかりません。"}, 404)
                        return
                    for q in case["open_questions"]:
                        if q["id"] == question_id:
                            q["resolved"] = True
                    case["updated_at"] = _now()
                    save_store(store)
                self._send_json({"case": case})
                return
            body = self._read_json()
            text = (body.get("text") or "").strip()
            if not text:
                self._send_json({"error": "本文を入力してください。"}, 400)
                return
            with _lock:
                store = load_store()
                case = store["cases"].get(case_id)
                if not case:
                    self._send_json({"error": "案件が見つかりません。"}, 404)
                    return
                case["open_questions"].append(
                    {"id": _short_id(), "text": text, "resolved": False, "at": _now()}
                )
                case["updated_at"] = _now()
                save_store(store)
            self._send_json({"case": case})
            return

        if action == "status":
            body = self._read_json()
            with _lock:
                store = load_store()
                case = store["cases"].get(case_id)
                if not case:
                    self._send_json({"error": "案件が見つかりません。"}, 404)
                    return
                if "status_note" in body:
                    case["status_note"] = str(body["status_note"]).strip()
                if "next_owner" in body:
                    case["next_owner"] = body["next_owner"] or None
                if "title" in body:
                    case["title"] = str(body["title"]).strip()
                if "purpose" in body:
                    case["purpose"] = str(body["purpose"]).strip()
                case["updated_at"] = _now()
                save_store(store)
            self._send_json({"case": case})
            return

        if action == "handoff":
            body = self._read_json()
            target = body.get("target", "")
            if target not in HANDOFF_TARGETS:
                self._send_json({"error": "渡す先が正しくありません。"}, 400)
                return
            with _lock:
                store = load_store()
                case = store["cases"].get(case_id)
                if not case:
                    self._send_json({"error": "案件が見つかりません。"}, 404)
                    return
                version = len(case["handoffs"]) + 1
                target_label = source_label(target, store)
                text = build_handoff_package(case, target_label, version, store)
                case["handoffs"].append(
                    {"version": version, "target": target, "text": text, "at": _now()}
                )
                case["next_owner"] = target
                case["updated_at"] = _now()
                save_store(store)
            self._send_json({"text": text, "version": version})
            return

        if action == "local-llm":
            self._queue_local_llm(case_id)
            return

        self._send_json({"error": "not found"}, 404)

    def _queue_local_llm(self, case_id):
        body = self._read_json()
        target_key = (body.get("target_key") or "").strip()

        with _lock:
            store = load_store()
            case = store["cases"].get(case_id)
            if not case:
                self._send_json({"error": "案件が見つかりません。"}, 404)
                return
            target = store["local_llm_targets"].get(target_key)
            if not target or not target.get("url") or not target.get("model"):
                self._send_json(
                    {"error": "このローカルLLMの接続先またはモデル名が未設定です。「設定」で登録してください。"}, 400
                )
                return
            job = {
                "id": uuid.uuid4().hex[:12],
                "case_id": case_id,
                "target_key": target_key,
                "target_label": target.get("label") or target_key,
                "status": "queued",
                "created_at": _now(),
                "started_at": None,
                "completed_at": None,
                "error": None,
            }
            store.setdefault("jobs", {})[job["id"]] = job
            save_store(store)
        threading.Thread(target=run_local_llm_job, args=(job["id"],), daemon=True).start()
        self._send_json({"job": job}, 202)

    def _update_destinations(self):
        body = self._read_json()
        with _lock:
            store = load_store()
            for key in ("chatgpt", "claude_code", "codex"):
                if key in body:
                    store["destinations"][key] = str(body[key]).strip()
            save_store(store)
            destinations = store["destinations"]
        self._send_json({"destinations": destinations})

    def _update_local_llm_targets(self):
        body = self._read_json()
        with _lock:
            store = load_store()
            for key, values in body.items():
                if key not in store["local_llm_targets"]:
                    continue
                if not isinstance(values, dict):
                    continue
                if "url" in values:
                    store["local_llm_targets"][key]["url"] = str(values["url"]).strip()
                if "model" in values:
                    store["local_llm_targets"][key]["model"] = str(values["model"]).strip()
            save_store(store)
            targets = store["local_llm_targets"]
        self._send_json({"local_llm_targets": targets})


def main():
    load_store()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"AI Work Hub: http://0.0.0.0:{PORT}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
