(function () {
  "use strict";

  var view = document.getElementById("view");
  var state = {
    screen: "list",
    cases: [],
    current: null,
    destinations: {},
    localLlmTargets: {},
  };

  var AI_SOURCES = [
    { key: "codex", label: "Codex" },
    { key: "claude_code", label: "Claude Code" },
    { key: "claude", label: "Claude" },
    { key: "chatgpt", label: "ChatGPT" },
  ];

  var HANDOFF_TARGETS = [
    { key: "codex", label: "Codex" },
    { key: "claude_code", label: "Claude Code" },
    { key: "chatgpt", label: "ChatGPT" },
  ];

  function sourceLabel(key) {
    if (!key) return "";
    if (key.indexOf("local_llm_") === 0) {
      var t = state.localLlmTargets[key.slice("local_llm_".length)];
      return t ? t.label : key;
    }
    var found = AI_SOURCES.filter(function (s) { return s.key === key; })[0];
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
    setTimeout(function () { t.remove(); }, 2600);
  }

  function clear() {
    view.innerHTML = "";
  }

  // 手動コピー用: クリップボードAPIが使えない環境（HTTP経由のLANなど）でも
  // 長押し選択で確実にコピーできるよう、readonlyのtextareaで表示する。
  function copyableText(text) {
    return el("textarea", { class: "handoff-text", readonly: "readonly", rows: "10", text: text || "" });
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
    loadCases().then(renderList);
  }

  function goNew() {
    state.screen = "new";
    renderNew();
  }

  function goImport() {
    state.screen = "import";
    renderImport();
  }

  function goCase(id) {
    api("/api/cases/" + id).then(function (data) {
      state.current = data.case;
      state.screen = "case";
      renderCase();
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

  function loadCases() {
    return api("/api/cases").then(function (data) {
      state.cases = data.cases;
    });
  }

  function refreshCurrent() {
    return api("/api/cases/" + state.current.id).then(function (data) {
      state.current = data.case;
    });
  }

  // ---------- list screen ----------

  function renderList() {
    clear();

    var quickText = el("textarea", { placeholder: "ふと思ったことを話す／書く…", rows: "3" });
    var quickBtn = el("button", { class: "btn primary block", text: "これを残す（新しい案件）", onclick: function () {
      var text = quickText.value.trim();
      if (!text) return;
      quickBtn.disabled = true;
      api("/api/cases", { method: "POST", body: { raw_text: text } })
        .then(function (data) {
          state.current = data.case;
          state.screen = "case";
          renderCase();
        })
        .finally(function () { quickBtn.disabled = false; });
    }});
    view.appendChild(el("div", { class: "card stack" }, [quickText, quickBtn]));

    view.appendChild(el("button", { class: "btn secondary block", text: "＋ 他のAIから取り込む", onclick: goImport }));

    if (state.cases.length === 0) {
      view.appendChild(el("div", { class: "empty-state" }, [
        el("p", { text: "まだ案件がありません。上の欄に話しかけると新しい案件が始まります。" }),
      ]));
      return;
    }

    var list = el("div", { class: "conv-list" });
    state.cases.forEach(function (c) {
      var statusTag = c.next_owner
        ? el("span", { class: "tag pending", text: "次: " + sourceLabel(c.next_owner) })
        : el("span", { class: "tag", text: "進行中" });
      var titleText = c.title || c.purpose || c.last_raw_text || "(無題の案件)";
      var item = el("button", { class: "conv-item", onclick: function () { goCase(c.id); } }, [
        el("div", { class: "row" }, [
          el("span", { class: "conv-title", text: titleText }),
          statusTag,
        ]),
        el("div", { class: "meta", text: (c.status_note || "現在地未設定") + " ・ 原文" + c.raw_count + "件 / 回答" + c.ai_count + "件" }),
      ]);
      list.appendChild(item);
    });
    view.appendChild(list);
  }

  // ---------- new case (purpose-first) screen ----------

  function renderNew() {
    clear();
    var titleInput = el("input", { type: "text", placeholder: "例：買い出しアプリのバグ修正" });
    var purposeInput = el("input", { type: "text", placeholder: "例：一覧画面が真っ白になる不具合を直す" });
    var submitBtn = el("button", { class: "btn primary block", type: "submit", text: "案件を始める" });

    var form = el("form", { class: "stack", onsubmit: function (e) {
      e.preventDefault();
      submitBtn.disabled = true;
      api("/api/cases", { method: "POST", body: { title: titleInput.value, purpose: purposeInput.value } })
        .then(function (data) {
          state.current = data.case;
          state.screen = "case";
          renderCase();
        })
        .finally(function () { submitBtn.disabled = false; });
    }}, [
      el("div", {}, [el("label", { text: "案件名（あとからでOK）" }), titleInput]),
      el("div", {}, [el("label", { text: "目的（あとからでOK）" }), purposeInput]),
      submitBtn,
      el("button", { class: "btn ghost block", type: "button", text: "← 受信箱に戻る", onclick: goList }),
    ]);

    view.appendChild(el("h1", { text: "案件を始める" }));
    view.appendChild(el("p", { text: "案件名・目的は空でも始められます。まず「受信箱」の入力欄から話しかける方が早い場合が多いです。" }));
    view.appendChild(form);
  }

  // ---------- import from another AI screen ----------

  function renderImport() {
    clear();
    var selected = { source: AI_SOURCES[0].key };

    var titleInput = el("input", { type: "text", placeholder: "例：買い出しアプリのバグ修正" });
    var sourceGrid = el("div", { class: "partner-grid" });
    AI_SOURCES.forEach(function (s) {
      var b = el("button", { type: "button", text: s.label, onclick: function () {
        selected.source = s.key;
        Array.prototype.forEach.call(sourceGrid.children, function (child) { child.classList.remove("selected"); });
        b.classList.add("selected");
      }});
      if (s.key === selected.source) b.classList.add("selected");
      sourceGrid.appendChild(b);
    });

    var pasteArea = el("textarea", { placeholder: "話した内容や、まとめてもらった回答をここに貼り付け（原文のまま）", rows: "10" });
    var submitBtn = el("button", { class: "btn primary block", type: "submit", text: "取り込んで新しい案件にする" });

    var form = el("form", { class: "stack", onsubmit: function (e) {
      e.preventDefault();
      var text = pasteArea.value.trim();
      if (!text) { toast("貼り付ける内容を入力してください。"); return; }
      submitBtn.disabled = true;
      api("/api/cases", { method: "POST", body: { title: titleInput.value, ai_source: selected.source, ai_text: text } })
        .then(function (data) {
          state.current = data.case;
          state.screen = "case";
          renderCase();
        })
        .finally(function () { submitBtn.disabled = false; });
    }}, [
      el("div", {}, [el("label", { text: "案件名（あとからでOK）" }), titleInput]),
      el("div", {}, [el("label", { text: "どこで話した内容か" }), sourceGrid]),
      el("div", {}, [el("label", { text: "内容（原文のまま。要約し直さない）" }), pasteArea]),
      submitBtn,
      el("button", { class: "btn ghost block", type: "button", text: "← 受信箱に戻る", onclick: goList }),
    ]);

    view.appendChild(el("h1", { text: "他のAIから取り込む" }));
    view.appendChild(el("p", { text: "コピーした内容をそのまま貼り付けてください。要約し直さないことで、ニュアンスのずれを防ぎます。" }));
    view.appendChild(form);
  }

  // ---------- case screen ----------

  function renderCase() {
    clear();
    var c = state.current;

    view.appendChild(el("button", { class: "btn ghost", text: "← 受信箱", onclick: goList }));

    // 1. 今の目的と現在地
    view.appendChild(el("h1", { text: c.title || "(無題の案件)" }));
    view.appendChild(el("div", { class: "card stack" }, [
      el("div", {}, [el("label", { text: "目的" }), el("p", { text: c.purpose || "(未設定)" })]),
      el("div", {}, [el("label", { text: "現在地" }), el("p", { text: c.status_note || "(未設定)" })]),
      el("button", { class: "btn ghost", text: "目的・現在地を編集", onclick: renderStatusEditor }),
    ]));

    // 2. 最後の利用者発言と最後のAI回答
    var lastRaw = c.raw_entries[c.raw_entries.length - 1];
    var lastAi = c.ai_entries[c.ai_entries.length - 1];
    view.appendChild(el("div", { class: "card stack" }, [
      el("div", {}, [el("label", { text: "最後の原文" }), el("p", { text: lastRaw ? lastRaw.text : "(まだありません)" })]),
      el("div", {}, [el("label", { text: "最後のAI回答" }), el("p", { text: lastAi ? ("[" + sourceLabel(lastAi.source) + "] " + lastAi.text) : "(まだありません)" })]),
    ]));

    // 思いつきを残す（追記）
    var rawInput = el("textarea", { placeholder: "話す／書く…", rows: "3" });
    var rawBtn = el("button", { class: "btn primary block", text: "これを残す", onclick: function () {
      var text = rawInput.value.trim();
      if (!text) return;
      rawBtn.disabled = true;
      api("/api/cases/" + c.id + "/raw", { method: "POST", body: { text: text } })
        .then(function () { return refreshCurrent(); })
        .then(renderCase)
        .finally(function () { rawBtn.disabled = false; });
    }});
    view.appendChild(el("div", { class: "stack" }, [rawInput, rawBtn]));

    // 3. 次の操作ボタン
    view.appendChild(el("h2", { text: "次の操作" }));
    var actionGrid = el("div", { class: "btn-row" });
    view.appendChild(actionGrid);

    HANDOFF_TARGETS.forEach(function (t) {
      var url = state.destinations[t.key];
      var btn = el("button", { class: "btn primary", text: "→ " + t.label + "へ渡す", onclick: function () {
        oneTapHandoff(t, url, btn);
      }});
      actionGrid.appendChild(btn);
    });
    Object.keys(state.localLlmTargets || {}).forEach(function (key) {
      var target = state.localLlmTargets[key];
      var btn = el("button", { class: "btn secondary", text: "→ " + target.label + "で確認", onclick: function () {
        callLocalLlm(key, btn);
      }});
      actionGrid.appendChild(btn);
    });

    var handoffPreview = copyableText(c.handoffs.length ? c.handoffs[c.handoffs.length - 1].text : "「渡す」を押すと、ここに引き継ぎパッケージが表示されます。長押しで手動コピーもできます。");
    view.appendChild(el("div", {}, [el("label", { text: "直近の引き継ぎパッケージ（長押しで手動コピー可）" }), handoffPreview]));

    function oneTapHandoff(target, url, btn) {
      // codexは固定URLがないため、開かずにコピーだけで完了とする。
      var win = url ? window.open(url, "_blank", "noopener") : null;
      btn.disabled = true;
      api("/api/cases/" + c.id + "/handoff", { method: "POST", body: { target: target.key } })
        .then(function (data) {
          handoffPreview.value = data.text;
          return navigator.clipboard.writeText(data.text).catch(function () { return null; });
        })
        .then(function (copied) {
          if (target.key === "codex") {
            toast("Codexへの引き継ぎ文を用意しました。CodexをPCで開いて貼り付けてください。");
          } else if (!url) {
            toast(target.label + "の開き先URLが未登録です。文章は下に表示しています。");
          } else if (copied === null) {
            toast(target.label + "を開きました。コピーに失敗した場合は下の欄を長押しでコピーしてください。");
          } else {
            toast(target.label + "を開き、引き継ぎ文をコピーしました。");
          }
          return refreshCurrent();
        })
        .then(renderCase)
        .catch(function () { toast("引き継ぎパッケージの作成に失敗しました。"); })
        .finally(function () { btn.disabled = false; });
    }

    function callLocalLlm(key, btn) {
      btn.disabled = true;
      api("/api/cases/" + c.id + "/local-llm", { method: "POST", body: { target_key: key } })
        .then(function () { return refreshCurrent(); })
        .then(renderCase)
        .catch(function (err) { toast(err.message); })
        .finally(function () { btn.disabled = false; });
    }

    // 詳細（決まったこと・未確認点・全履歴・引き継ぎ履歴）は二次領域にまとめる
    var detailsOpen = false;
    var detailsWrap = el("div", {});
    var detailsToggle = el("button", { class: "btn ghost block", text: "詳細を見る（決まったこと・未確認点・履歴）", onclick: function () {
      detailsOpen = !detailsOpen;
      detailsToggle.textContent = detailsOpen ? "詳細を閉じる" : "詳細を見る（決まったこと・未確認点・履歴）";
      detailsWrap.innerHTML = "";
      if (detailsOpen) detailsWrap.appendChild(renderDetails(c));
    }});
    view.appendChild(detailsToggle);
    view.appendChild(detailsWrap);

    function renderStatusEditor() {
      clear();
      var titleInput = el("input", { type: "text", value: c.title || "" });
      var purposeInput = el("input", { type: "text", value: c.purpose || "" });
      var statusInput = el("textarea", { rows: "3", text: c.status_note || "" });
      var ownerSel = el("select", {}, [el("option", { value: "", text: "(未設定)" })].concat(
        HANDOFF_TARGETS.map(function (t) { return el("option", { value: t.key, text: t.label }); })
      ));
      ownerSel.value = c.next_owner || "";

      var saveBtn = el("button", { class: "btn primary block", text: "保存する", onclick: function () {
        saveBtn.disabled = true;
        api("/api/cases/" + c.id + "/status", { method: "POST", body: {
          title: titleInput.value, purpose: purposeInput.value,
          status_note: statusInput.value, next_owner: ownerSel.value,
        }})
          .then(function () { return refreshCurrent(); })
          .then(renderCase)
          .finally(function () { saveBtn.disabled = false; });
      }});

      view.appendChild(el("button", { class: "btn ghost", text: "← 案件に戻る", onclick: renderCase }));
      view.appendChild(el("h1", { text: "目的・現在地の編集" }));
      view.appendChild(el("div", { class: "stack" }, [
        el("div", {}, [el("label", { text: "案件名" }), titleInput]),
        el("div", {}, [el("label", { text: "目的" }), purposeInput]),
        el("div", {}, [el("label", { text: "現在地" }), statusInput]),
        el("div", {}, [el("label", { text: "次の担当" }), ownerSel]),
        saveBtn,
      ]));
    }
  }

  function renderDetails(c) {
    var wrap = el("div", { class: "stack" });

    // 決まったこと
    var decisionInput = el("input", { type: "text", placeholder: "採用した方針" });
    var decisionBtn = el("button", { class: "btn secondary", text: "追加", onclick: function () {
      var text = decisionInput.value.trim();
      if (!text) return;
      api("/api/cases/" + c.id + "/decision", { method: "POST", body: { text: text } })
        .then(function () { return refreshCurrent(); })
        .then(renderCase);
    }});
    wrap.appendChild(el("div", { class: "card stack" }, [
      el("h2", { text: "決まったこと" }),
    ].concat(c.decisions.map(function (d) { return el("p", { text: "・" + d.text }); }))
      .concat([el("div", { class: "btn-row" }, [decisionInput, decisionBtn])])));

    // 未確認点
    var questionInput = el("input", { type: "text", placeholder: "推測で進めてはいけない点" });
    var questionBtn = el("button", { class: "btn secondary", text: "追加", onclick: function () {
      var text = questionInput.value.trim();
      if (!text) return;
      api("/api/cases/" + c.id + "/open-question", { method: "POST", body: { text: text } })
        .then(function () { return refreshCurrent(); })
        .then(renderCase);
    }});
    var qList = c.open_questions.map(function (q) {
      var row = el("div", { class: "row" }, [
        el("span", { text: (q.resolved ? "✓ " : "・") + q.text }),
      ]);
      if (!q.resolved) {
        row.appendChild(el("button", { class: "btn ghost", text: "解決", onclick: function () {
          api("/api/cases/" + c.id + "/open-question/" + q.id + "/resolve", { method: "POST" })
            .then(function () { return refreshCurrent(); })
            .then(renderCase);
        }}));
      }
      return row;
    });
    wrap.appendChild(el("div", { class: "card stack" }, [el("h2", { text: "未確認点" })].concat(qList)
      .concat([el("div", { class: "btn-row" }, [questionInput, questionBtn])])));

    // 全履歴（時系列）
    var timeline = c.raw_entries.map(function (e) { return { at: e.at, text: "[利用者] " + e.text }; })
      .concat(c.ai_entries.map(function (e) { return { at: e.at, text: "[" + sourceLabel(e.source) + "] " + e.text }; }))
      .sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    wrap.appendChild(el("div", { class: "card stack" }, [el("h2", { text: "全履歴" })]
      .concat(timeline.length ? timeline.map(function (t) { return el("p", { text: t.text }); }) : [el("p", { text: "(まだありません)" })])));

    // 引き継ぎ履歴
    var handoffList = c.handoffs.slice().reverse().map(function (h) {
      return el("p", { text: "v" + h.version + " → " + sourceLabel(h.target) + "（" + h.at + "）" });
    });
    wrap.appendChild(el("div", { class: "card stack" }, [el("h2", { text: "引き継ぎ履歴" })]
      .concat(handoffList.length ? handoffList : [el("p", { text: "(まだありません)" })])));

    return wrap;
  }

  // ---------- settings screen ----------

  function renderSettings() {
    clear();
    view.appendChild(el("button", { class: "btn ghost", text: "← 受信箱", onclick: goList }));
    view.appendChild(el("h1", { text: "開き先・接続先の登録" }));

    var dest = state.destinations;
    var chatgptInput = el("input", { type: "url", value: dest.chatgpt || "", placeholder: "https://chatgpt.com/" });
    var claudeCodeInput = el("input", { type: "url", value: dest.claude_code || "", placeholder: "https://claude.ai/code" });
    var codexInput = el("input", { type: "url", value: dest.codex || "", placeholder: "（任意）Codexを開いているURLがあれば" });

    var destForm = el("form", { class: "stack", onsubmit: function (e) {
      e.preventDefault();
      api("/api/destinations", { method: "POST", body: {
        chatgpt: chatgptInput.value, claude_code: claudeCodeInput.value, codex: codexInput.value,
      }}).then(function (data) {
        state.destinations = data.destinations;
        toast("保存しました。");
      });
    }}, [
      el("div", {}, [el("label", { text: "ChatGPT" }), chatgptInput]),
      el("div", {}, [el("label", { text: "Claude Code" }), claudeCodeInput]),
      el("div", {}, [el("label", { text: "Codex（任意。デスクトップアプリのため未登録でも渡せます）" }), codexInput]),
      el("button", { class: "btn primary block", type: "submit", text: "保存する" }),
    ]);
    view.appendChild(destForm);

    view.appendChild(el("h2", { text: "ローカルLLM" }));
    view.appendChild(el("p", { text: "接続先・モデル名は決め打ちにしていません。実環境の値をここで登録してください。" }));

    var llmInputs = {};
    var llmFields = Object.keys(state.localLlmTargets || {}).map(function (key) {
      var t = state.localLlmTargets[key];
      var urlInput = el("input", { type: "url", value: t.url || "", placeholder: "例：http://10.10.10.2:11434/api/generate" });
      var modelInput = el("input", { type: "text", value: t.model || "", placeholder: "例：llama3" });
      llmInputs[key] = { urlInput: urlInput, modelInput: modelInput };
      return el("div", { class: "card stack" }, [
        el("strong", { text: t.label }),
        el("div", {}, [el("label", { text: "接続先URL" }), urlInput]),
        el("div", {}, [el("label", { text: "モデル名" }), modelInput]),
      ]);
    });
    llmFields.forEach(function (f) { view.appendChild(f); });

    view.appendChild(el("button", { class: "btn primary block", text: "ローカルLLM設定を保存", onclick: function () {
      var body = {};
      Object.keys(llmInputs).forEach(function (key) {
        body[key] = { url: llmInputs[key].urlInput.value, model: llmInputs[key].modelInput.value };
      });
      api("/api/local-llm-targets", { method: "POST", body: body }).then(function (data) {
        state.localLlmTargets = data.local_llm_targets;
        toast("保存しました。");
      });
    }}));
  }

  // ---------- boot ----------

  goList();
})();
