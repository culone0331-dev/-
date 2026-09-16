(function () {
  "use strict";

  var view = document.getElementById("view");
  var state = {
    screen: "list",
    conversations: [],
    current: null,
    destinations: {},
    localLlmTargets: {},
  };

  var PARTNER_OPTIONS = [
    { key: "local_llm_culone-server", label: "ローカルLLM：culone-server" },
    { key: "local_llm_ai2", label: "ローカルLLM：AI2" },
    { key: "codex", label: "Codex" },
    { key: "claude_code", label: "Claude Code" },
    { key: "chatgpt", label: "ChatGPT" },
    { key: "claude", label: "Claude" },
    { key: "other", label: "未定（あとで決める）" },
  ];

  var HANDOFF_TARGETS = [
    { key: "codex", label: "Codex" },
    { key: "claude_code", label: "Claude Code" },
    { key: "chatgpt", label: "ChatGPT" },
    { key: "claude", label: "Claude" },
  ];

  function partnerLabel(key) {
    var found = PARTNER_OPTIONS.filter(function (p) { return p.key === key; })[0];
    return found ? found.label : key;
  }

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || "GET", headers: {} };
    if (opts.body) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    return fetch(path, init).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || "エラーが発生しました。");
        return data;
      });
    });
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === "class") node.className = attrs[k];
      else if (k === "text") node.textContent = attrs[k];
      else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c) node.appendChild(c);
    });
    return node;
  }

  function toast(message) {
    var t = el("div", { class: "toast", text: message });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }

  function clear() {
    view.innerHTML = "";
  }

  // ---------- navigation ----------

  document.querySelectorAll("[data-nav]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var target = btn.getAttribute("data-nav");
      if (target === "list") goList();
      if (target === "settings") goSettings();
    });
  });

  function goList() {
    state.screen = "list";
    loadConversations().then(renderList);
  }

  function goNew() {
    state.screen = "new";
    renderNew();
  }

  function goChat(id) {
    api("/api/conversations/" + id).then(function (data) {
      state.current = data.conversation;
      state.screen = "chat";
      renderChat();
    });
  }

  function goSettings() {
    api("/api/destinations").then(function (data) {
      state.destinations = data.destinations;
      state.localLlmTargets = data.local_llm_targets;
      state.screen = "settings";
      renderSettings();
    });
  }

  function loadConversations() {
    return api("/api/conversations").then(function (data) {
      state.conversations = data.conversations;
    });
  }

  // ---------- list screen ----------

  function renderList() {
    clear();
    view.appendChild(el("button", { class: "btn primary block", text: "＋ 新しい会話をはじめる", onclick: goNew }));

    if (state.conversations.length === 0) {
      view.appendChild(el("div", { class: "empty-state" }, [
        el("p", { text: "まだ会話がありません。まずは「話す／書く」ことから始めましょう。" }),
      ]));
      return;
    }

    var list = el("div", { class: "conv-list" });
    state.conversations.forEach(function (c) {
      var pending = c.pending_next;
      var statusTag;
      if (pending) {
        statusTag = el("span", { class: "tag pending", text: partnerLabel(pending.target) + "で検証待ち" });
      } else if (c.status === "paused") {
        statusTag = el("span", { class: "tag", text: "保留中" });
      } else {
        statusTag = el("span", { class: "tag", text: "進行中" });
      }
      var item = el("button", { class: "conv-item", onclick: function () { goChat(c.id); } }, [
        el("div", { class: "row" }, [
          el("span", { class: "conv-title", text: c.title }),
          statusTag,
        ]),
        el("div", { class: "meta", text: (c.partner_label || c.partner) + " ・ " + c.message_count + "件の記録" }),
      ]);
      list.appendChild(item);
    });
    view.appendChild(list);
  }

  // ---------- new conversation screen ----------

  function renderNew() {
    clear();
    var selected = { partner: "other" };

    var titleInput = el("input", { type: "text", placeholder: "例：夕方の買い出しメモ" });
    var grid = el("div", { class: "partner-grid" });
    PARTNER_OPTIONS.forEach(function (p) {
      var b = el("button", { type: "button", text: p.label, onclick: function () {
        selected.partner = p.key;
        Array.prototype.forEach.call(grid.children, function (child) { child.classList.remove("selected"); });
        b.classList.add("selected");
      }});
      if (p.key === "other") b.classList.add("selected");
      grid.appendChild(b);
    });

    var form = el("form", { class: "stack", onsubmit: function (e) {
      e.preventDefault();
      api("/api/conversations", { method: "POST", body: { title: titleInput.value, partner: selected.partner } })
        .then(function (data) {
          state.current = data.conversation;
          state.screen = "chat";
          renderChat();
        });
    }}, [
      el("div", {}, [el("label", { text: "会話名（あとから変えなくてOK）" }), titleInput]),
      el("div", {}, [el("label", { text: "今回の相手（あとで決めてもOK）" }), grid]),
      el("button", { class: "btn primary block", type: "submit", text: "会話を始める" }),
      el("button", { class: "btn ghost block", type: "button", text: "← 受信箱に戻る", onclick: goList }),
    ]);

    view.appendChild(el("h1", { text: "新しい会話" }));
    view.appendChild(form);
  }

  // ---------- chat screen ----------

  function renderChat() {
    clear();
    var conv = state.current;

    view.appendChild(el("button", { class: "btn ghost", text: "← 受信箱", onclick: goList }));
    view.appendChild(el("h1", { text: conv.title }));
    view.appendChild(el("p", { text: "相手：" + (conv.partner_label || conv.partner) }));

    var log = el("div", { class: "chat-log" });
    conv.messages.forEach(function (m) {
      log.appendChild(el("div", { class: "bubble " + m.role, text: m.text }));
    });
    view.appendChild(log);

    var textarea = el("textarea", { placeholder: "話す／書く…" });
    var sendBtn = el("button", { class: "btn primary block", text: "これを残す", onclick: function () {
      var text = textarea.value.trim();
      if (!text) return;
      sendBtn.disabled = true;
      api("/api/conversations/" + conv.id + "/messages", { method: "POST", body: { text: text } })
        .then(function (data) {
          state.current = data.conversation;
          textarea.value = "";
          renderChat();
        })
        .finally(function () { sendBtn.disabled = false; });
    }});

    var composer = el("div", { class: "composer" }, [
      textarea,
      sendBtn,
      el("div", { class: "btn-row" }, [
        el("button", { class: "btn secondary", text: "今日はここまで", onclick: renderFinishPanel }),
        el("button", { class: "btn secondary", text: "この会話を渡す", onclick: renderHandoffPanel }),
      ]),
    ]);
    view.appendChild(composer);

    if (conv.pending_next) {
      view.appendChild(el("div", { class: "notice", text:
        "次は「" + partnerLabel(conv.pending_next.target) + "」で検証する予定です。" +
        (conv.pending_next.note ? "（メモ：" + conv.pending_next.note + "）" : "") }));
    }
  }

  function renderFinishPanel() {
    var conv = state.current;
    var wrap = el("div", { class: "card stack" });
    var targetSel = el("select", {}, PARTNER_OPTIONS.filter(function (p) { return p.key !== "other"; }).map(function (p) {
      return el("option", { value: p.key, text: p.label });
    }));
    var note = el("textarea", { placeholder: "次にお願いしたいこと（任意）" });

    wrap.appendChild(el("h2", { text: "今日はここまで" }));
    wrap.appendChild(el("p", { text: "次にどのAIで検証するかだけ記録します。送信はしません。" }));
    wrap.appendChild(el("div", {}, [el("label", { text: "次に検証する相手" }), targetSel]));
    wrap.appendChild(el("div", {}, [el("label", { text: "メモ" }), note]));
    wrap.appendChild(el("div", { class: "btn-row" }, [
      el("button", { class: "btn primary", text: "保存する", onclick: function () {
        api("/api/conversations/" + conv.id + "/finish", { method: "POST", body: { target: targetSel.value, note: note.value } })
          .then(function (data) {
            state.current = data.conversation;
            renderChat();
            toast("次の予定を保存しました。");
          });
      }}),
      el("button", { class: "btn ghost", text: "キャンセル", onclick: renderChat }),
    ]));

    view.appendChild(wrap);
  }

  function renderHandoffPanel() {
    var conv = state.current;
    var wrap = el("div", { class: "card stack" });
    var targetSel = el("select", {}, HANDOFF_TARGETS.map(function (p) {
      return el("option", { value: p.key, text: p.label });
    }));
    var textBox = el("div", { class: "handoff-text", text: "「引き継ぎ文を作る」を押すと、ここに文章が表示されます。" });
    var copied = false;

    wrap.appendChild(el("h2", { text: "この会話を渡す" }));
    wrap.appendChild(el("div", {}, [el("label", { text: "送り先" }), targetSel]));
    wrap.appendChild(textBox);
    wrap.appendChild(el("div", { class: "btn-row" }, [
      el("button", { class: "btn primary", text: "引き継ぎ文を作る", onclick: function () {
        api("/api/conversations/" + conv.id + "/handoff", { method: "POST", body: { target: targetSel.value } })
          .then(function (data) {
            textBox.textContent = data.text;
            copied = false;
          });
      }}),
      el("button", { class: "btn secondary", text: "引き継ぎ文をコピー", onclick: function () {
        if (!textBox.textContent || textBox.textContent.indexOf("引き継ぎ文を作る") !== -1) {
          toast("先に「引き継ぎ文を作る」を押してください。");
          return;
        }
        navigator.clipboard.writeText(textBox.textContent).then(function () {
          copied = true;
          toast("コピーしました。");
        }).catch(function () {
          toast("コピーに失敗しました。長押しで手動コピーしてください。");
        });
      }}),
    ]));
    wrap.appendChild(el("div", { class: "btn-row" }, [
      el("button", { class: "btn warn block", text: "コピー後に送り先を開く", onclick: function () {
        api("/api/destinations").then(function (data) {
          var url = data.destinations[targetSel.value];
          if (!url) {
            toast("先に「設定」で開き先URLを登録してください。");
            return;
          }
          window.open(url, "_blank", "noopener");
        });
      }}),
    ]));
    wrap.appendChild(el("p", { text: "URLはログイン済みの各サービスを開くだけです。本文の自動送信や既存チャットの自動選択はできません。開いた先に貼り付けて送信してください。" }));
    wrap.appendChild(el("button", { class: "btn ghost block", text: "閉じる", onclick: renderChat }));

    view.appendChild(wrap);
  }

  // ---------- settings screen ----------

  function renderSettings() {
    clear();
    view.appendChild(el("button", { class: "btn ghost", text: "← 受信箱", onclick: goList }));
    view.appendChild(el("h1", { text: "開き先の登録" }));
    view.appendChild(el("p", { text: "「この会話を渡す」で送り先を開くときに使うURLです。ログイン済みの入口を登録してください。" }));

    var dest = state.destinations;
    var chatgptInput = el("input", { type: "url", value: dest.chatgpt || "", placeholder: "https://chatgpt.com/" });
    var claudeInput = el("input", { type: "url", value: dest.claude || "", placeholder: "https://claude.ai/" });
    var claudeCodeInput = el("input", { type: "url", value: dest.claude_code || "", placeholder: "https://claude.ai/code" });
    var codexInput = el("input", { type: "url", value: dest.codex || "", placeholder: "普段Codexを開いているURL" });

    var form = el("form", { class: "stack", onsubmit: function (e) {
      e.preventDefault();
      api("/api/destinations", { method: "POST", body: {
        chatgpt: chatgptInput.value, claude: claudeInput.value,
        claude_code: claudeCodeInput.value, codex: codexInput.value,
      }}).then(function (data) {
        state.destinations = data.destinations;
        toast("保存しました。");
      });
    }}, [
      el("div", {}, [el("label", { text: "ChatGPT" }), chatgptInput]),
      el("div", {}, [el("label", { text: "Claude" }), claudeInput]),
      el("div", {}, [el("label", { text: "Claude Code" }), claudeCodeInput]),
      el("div", {}, [el("label", { text: "Codex" }), codexInput]),
      el("button", { class: "btn primary block", type: "submit", text: "保存する" }),
    ]);
    view.appendChild(form);

    view.appendChild(el("div", { class: "notice", text:
      "ChatGPTの「共有リンク」はここに登録しないでください。共有リンクは会話の公開用スナップショットで、リンクを知っている人が内容を見られる可能性があります。" }));

    view.appendChild(el("h2", { text: "ローカルLLM" }));
    view.appendChild(el("p", { text: "URL不要で、AI Work Hubから直接呼び出せます（Ollama互換APIを想定）。接続先は server.py の local_llm_targets、または data/store.json で設定してください。" }));
    Object.keys(state.localLlmTargets || {}).forEach(function (key) {
      var t = state.localLlmTargets[key];
      view.appendChild(el("div", { class: "card" }, [
        el("strong", { text: t.label }),
        el("div", { class: "meta", text: t.url + "（model: " + t.model + "）" }),
      ]));
    });
  }

  // ---------- boot ----------

  goList();
})();
