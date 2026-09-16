#!/usr/bin/env python3
"""AI Work Hub — 会話中心の作業記録・引き継ぎサーバー。

依存ライブラリなし（Python標準ライブラリのみ）で動作する。
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

DEFAULT_STORE = {
    "conversations": {},
    "destinations": {
        "chatgpt": "https://chatgpt.com/",
        "claude_code": "https://claude.ai/code",
        "codex": "",
    },
    "local_llm_targets": {
        "culone-server": {
            "label": "ローカルLLM：culone-server",
            "url": "http://localhost:11434/api/generate",
            "model": "llama3",
        },
        "ai2": {
            "label": "ローカルLLM：AI2",
            "url": "http://ai2.local:11434/api/generate",
            "model": "llama3",
        },
    },
}

PARTNER_LABELS = {
    "local_llm_culone-server": "ローカルLLM：culone-server",
    "local_llm_ai2": "ローカルLLM：AI2",
    "codex": "Codex",
    "claude_code": "Claude Code",
    "chatgpt": "ChatGPT",
    "claude": "Claude",
    "other": "未定",
}

_lock = threading.Lock()


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_store():
    if not STORE_PATH.exists():
        save_store(json.loads(json.dumps(DEFAULT_STORE)))
    with open(STORE_PATH, "r", encoding="utf-8") as f:
        store = json.load(f)
    for key, value in DEFAULT_STORE.items():
        store.setdefault(key, value)
    return store


def save_store(store):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = STORE_PATH.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, indent=2)
    tmp_path.replace(STORE_PATH)


def conversation_summary(conv):
    return {
        "id": conv["id"],
        "title": conv["title"],
        "partner": conv["partner"],
        "partner_label": conv.get("partner_label", conv["partner"]),
        "status": conv["status"],
        "created_at": conv["created_at"],
        "updated_at": conv["updated_at"],
        "message_count": len(conv["messages"]),
        "pending_next": conv.get("pending_next"),
    }


def build_handoff_text(conv, target_label):
    lines = [
        f"# 引き継ぎ: {conv['title']}",
        "",
        "AI Work Hub からの引き継ぎです。",
        f"- これまでの相手: {conv.get('partner_label', conv.get('partner', ''))}",
        f"- 渡す先: {target_label}",
        f"- 作成日時: {_now()}",
        "",
        "## これまでの会話・メモ",
    ]
    if not conv["messages"]:
        lines.append("(まだ記録がありません)")
    for m in conv["messages"]:
        role = {"user": "自分", "ai": "AI", "system": "システム"}.get(m["role"], m["role"])
        lines.append(f"- [{role}] {m['text']}")

    pending = conv.get("pending_next")
    lines.append("")
    lines.append("## 次にやってほしいこと")
    if pending and pending.get("note"):
        lines.append(pending["note"])
    elif pending:
        lines.append(
            f"（{PARTNER_LABELS.get(pending.get('target'), pending.get('target'))}での検証予定として保留中）"
        )
    else:
        lines.append("上記の会話・メモを踏まえて、続きを進めてください。")
    lines.append("")
    lines.append("不明な点は推測せず、現状を確認してから安全に進めてください。")
    return "\n".join(lines)


def call_local_llm(target, conv):
    prompt_lines = [
        f"[{m['role']}] {m['text']}" for m in conv["messages"] if m["role"] in ("user", "ai")
    ]
    prompt = "\n".join(prompt_lines)
    payload = json.dumps(
        {"model": target.get("model", "llama3"), "prompt": prompt, "stream": False}
    ).encode("utf-8")
    req = urllib.request.Request(
        target["url"], data=payload, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            reply = (data.get("response") or "").strip()
            return (reply or None), None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return None, str(exc)


class Handler(BaseHTTPRequestHandler):
    server_version = "AIWorkHub/0.1"

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

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            self._send_file(BASE_DIR / "index.html", "text/html; charset=utf-8")
        elif path == "/app.js":
            self._send_file(BASE_DIR / "app.js", "text/javascript; charset=utf-8")
        elif path == "/style.css":
            self._send_file(BASE_DIR / "style.css", "text/css; charset=utf-8")
        elif path == "/api/conversations":
            with _lock:
                store = load_store()
            convs = sorted(
                store["conversations"].values(), key=lambda c: c["updated_at"], reverse=True
            )
            self._send_json({"conversations": [conversation_summary(c) for c in convs]})
        elif path.startswith("/api/conversations/"):
            conv_id = path.split("/")[3]
            with _lock:
                store = load_store()
            conv = store["conversations"].get(conv_id)
            if not conv:
                self._send_json({"error": "会話が見つかりません。"}, 404)
                return
            self._send_json({"conversation": conv})
        elif path == "/api/destinations":
            with _lock:
                store = load_store()
            self._send_json(
                {
                    "destinations": store["destinations"],
                    "local_llm_targets": store["local_llm_targets"],
                }
            )
        else:
            self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        path = urlparse(self.path).path
        segments = [s for s in path.split("/") if s]

        if path == "/api/conversations":
            body = self._read_json()
            title = (body.get("title") or "").strip() or f"無題の会話 {_now()}"
            partner = (body.get("partner") or "other").strip()
            with _lock:
                store = load_store()
                conv_id = uuid.uuid4().hex[:12]
                now = _now()
                store["conversations"][conv_id] = {
                    "id": conv_id,
                    "title": title,
                    "partner": partner,
                    "partner_label": PARTNER_LABELS.get(partner, partner),
                    "status": "active",
                    "created_at": now,
                    "updated_at": now,
                    "messages": [],
                    "pending_next": None,
                    "last_handoff": None,
                }
                save_store(store)
                conv = store["conversations"][conv_id]
            self._send_json({"conversation": conv}, 201)
            return

        if len(segments) >= 3 and segments[0] == "api" and segments[1] == "conversations":
            conv_id = segments[2]
            action = segments[3] if len(segments) > 3 else None
            with _lock:
                store = load_store()
                conv = store["conversations"].get(conv_id)
                if not conv:
                    self._send_json({"error": "会話が見つかりません。"}, 404)
                    return

                if action == "messages":
                    body = self._read_json()
                    text = (body.get("text") or "").strip()
                    role = body.get("role") or "user"
                    if role not in ("user", "ai", "system"):
                        role = "user"
                    if not text:
                        self._send_json({"error": "本文を入力してください。"}, 400)
                        return
                    conv["messages"].append({"role": role, "text": text, "at": _now()})
                    conv["status"] = "active"
                    conv["updated_at"] = _now()
                    save_store(store)
                    if role == "user" and conv["partner"].startswith("local_llm_"):
                        target_key = conv["partner"][len("local_llm_"):]
                        target = store["local_llm_targets"].get(target_key)
                        if target:
                            reply, error = call_local_llm(target, conv)
                            if reply:
                                conv["messages"].append({"role": "ai", "text": reply, "at": _now()})
                            elif error:
                                conv["messages"].append(
                                    {
                                        "role": "system",
                                        "text": f"(ローカルLLMに接続できませんでした: {error})",
                                        "at": _now(),
                                    }
                                )
                            conv["updated_at"] = _now()
                            save_store(store)
                    self._send_json({"conversation": conv})
                    return

                if action == "finish":
                    body = self._read_json()
                    target = body.get("target")
                    note = (body.get("note") or "").strip()
                    conv["pending_next"] = (
                        {"target": target, "note": note, "at": _now()} if target else None
                    )
                    conv["status"] = "paused"
                    conv["updated_at"] = _now()
                    save_store(store)
                    self._send_json({"conversation": conv})
                    return

                if action == "handoff":
                    body = self._read_json()
                    target = body.get("target", "")
                    target_label = PARTNER_LABELS.get(target, target)
                    text = build_handoff_text(conv, target_label)
                    conv["last_handoff"] = {"target": target, "text": text, "at": _now()}
                    conv["updated_at"] = _now()
                    save_store(store)
                    self._send_json({"text": text})
                    return

                if action == "resume":
                    conv["status"] = "active"
                    conv["updated_at"] = _now()
                    save_store(store)
                    self._send_json({"conversation": conv})
                    return

            self._send_json({"error": "not found"}, 404)
            return

        if path == "/api/destinations":
            body = self._read_json()
            with _lock:
                store = load_store()
                for key in ("chatgpt", "claude_code", "codex"):
                    if key in body:
                        store["destinations"][key] = str(body[key]).strip()
                save_store(store)
                destinations = store["destinations"]
            self._send_json({"destinations": destinations})
            return

        self._send_json({"error": "not found"}, 404)


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
