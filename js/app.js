(function () {
  "use strict";

  /** @type {Array<Record<string, string>>} */
  let tasks = [];

  /** @type {Record<string, { contributor?: string, review_date?: string }>} */
  let reviewerByTaskId = {};

  const LS_KEY = "promptDiff_sheetApiKey";
  const LS_URL = "promptDiff_sheetUrl";
  const LS_TAB = "promptDiff_sheetTab";
  const LS_REM = "promptDiff_rememberKey";

  const els = {
    sheetUrl: document.getElementById("sheet-url"),
    sheetTab: document.getElementById("sheet-tab"),
    sheetApiKey: document.getElementById("sheet-api-key"),
    rememberKey: document.getElementById("remember-key"),
    btnLoadSheet: document.getElementById("btn-load-sheet"),
    btnLoadLocal: document.getElementById("btn-load-local"),
    taskSelect: document.getElementById("task-select"),
    taskMeta: document.getElementById("task-meta"),
    loadError: document.getElementById("load-error"),
    diffPrompt: document.getElementById("diff-host-prompt"),
    diffRubric: document.getElementById("diff-host-rubric"),
    promptSummary: document.getElementById("prompt-diff-summary"),
    splitPrompt: document.getElementById("split-prompt"),
    splitRubric: document.getElementById("split-rubric"),
    tabPrompt: document.getElementById("tab-prompt"),
    tabRubric: document.getElementById("tab-rubric"),
    tabSplit: document.getElementById("tab-split"),
    panelPrompt: document.getElementById("panel-prompt"),
    panelRubric: document.getElementById("panel-rubric"),
    panelSplit: document.getElementById("panel-split"),
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normHeader(h) {
    return String(h ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
  }

  /** @param {string} s */
  function tryPrettyJsonCell(s) {
    const t = String(s || "").trim();
    if (!t || t[0] !== "{") return s;
    try {
      const o = JSON.parse(t);
      const inner = o && typeof o === "object" && "_value" in o ? o._value : o;
      return JSON.stringify(inner, null, 2);
    } catch {
      return s;
    }
  }

  /** @param {string[][]} values */
  function rowsToTasks(values) {
    if (!values || values.length < 2) {
      throw new Error("Sheet needs a header row and at least one data row.");
    }
    const headers = values[0].map(function (h) {
      return normHeader(String(h).replace(/^\uFEFF/, ""));
    });
    const col = (/** @type {string[]} */ aliases) => {
      for (let k = 0; k < aliases.length; k++) {
        const target = normHeader(aliases[k]);
        const i = headers.indexOf(target);
        if (i !== -1) return i;
      }
      return -1;
    };
    const ix = {
      task_id: col(["task_id", "task id", "taskid", "id"]),
      task_url: col(["task_url", "task url", "taskurl", "url"]),
      previous_prompt: col([
        "previous_prompt",
        "previousprompt",
        "old_prompt",
        "start_prompt",
        "prompt_before",
      ]),
      latest_prompt: col(["latest_prompt", "latestprompt", "new_prompt", "prompt_after"]),
      previous_rubric: col(["previous_rubric", "previousrubric"]),
      latest_rubric: col(["latest_rubric", "latestrubric", "rubric"]),
      contributor: col(["contributor", "reviewer", "reviewed_by", "owner", "author"]),
      review_date: col(["review_date", "date", "reviewed", "batch"]),
    };
    if (ix.previous_prompt < 0 && ix.latest_prompt < 0) {
      throw new Error(
        'No prompt columns found. Name columns "previous_prompt" and "latest_prompt" (or similar) in the first row.'
      );
    }
    const rows = [];
    for (let r = 1; r < values.length; r++) {
      const row = values[r] || [];
      const get = (i) => (i >= 0 && i < row.length && row[i] != null ? String(row[i]) : "");
      const prev = get(ix.previous_prompt);
      const latest = get(ix.latest_prompt);
      const tid = get(ix.task_id);
      if (!prev && !latest && !tid) continue;
      rows.push({
        task_id: tid,
        task_url: get(ix.task_url),
        previous_prompt: prev,
        latest_prompt: latest,
        previous_rubric: tryPrettyJsonCell(get(ix.previous_rubric)),
        latest_rubric: tryPrettyJsonCell(get(ix.latest_rubric)),
        contributor: get(ix.contributor),
        review_date: get(ix.review_date),
      });
    }
    return rows;
  }

  function quoteSheetTab(tabName) {
    const t = (tabName || "Sheet1").trim() || "Sheet1";
    const needsQuote = /[^a-zA-Z0-9_]/.test(t) || /^\d/.test(t);
    return needsQuote ? "'" + t.replace(/'/g, "''") + "'" : t;
  }

  function a1RangeForTab(tabName) {
    return quoteSheetTab(tabName) + "!A1:ZZ5000";
  }

  function extractSpreadsheetId(text) {
    const s = String(text).trim();
    const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9-_]{12,120}$/.test(s)) return s;
    return null;
  }

  /** @param {string} spreadsheetId @param {string} tabName @param {string} apiKey */
  async function fetchGoogleSheetValues(spreadsheetId, tabName, apiKey) {
    const range = a1RangeForTab(tabName);
    const path =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(spreadsheetId) +
      "/values/" +
      encodeURIComponent(range) +
      "?key=" +
      encodeURIComponent(apiKey);
    const res = await fetch(path);
    const data = await res.json();
    if (!res.ok) {
      const msg =
        data && data.error && data.error.message ? data.error.message : res.statusText;
      throw new Error(msg + " (" + res.status + ")");
    }
    const values = data.values;
    if (!values || values.length === 0) {
      throw new Error("No values returned for that tab or range.");
    }
    return values;
  }

  function restoreFormFromStorage() {
    try {
      if (localStorage.getItem(LS_REM) === "1") {
        els.rememberKey.checked = true;
        const k = localStorage.getItem(LS_KEY);
        const u = localStorage.getItem(LS_URL);
        const t = localStorage.getItem(LS_TAB);
        if (k) els.sheetApiKey.value = k;
        if (u) els.sheetUrl.value = u;
        if (t) els.sheetTab.value = t;
      }
    } catch {
      /* ignore */
    }
  }

  function persistFormIfNeeded() {
    try {
      if (els.rememberKey.checked) {
        localStorage.setItem(LS_REM, "1");
        localStorage.setItem(LS_KEY, els.sheetApiKey.value.trim());
        localStorage.setItem(LS_URL, els.sheetUrl.value.trim());
        localStorage.setItem(LS_TAB, els.sheetTab.value.trim() || "Sheet1");
      } else {
        localStorage.removeItem(LS_REM);
        localStorage.removeItem(LS_KEY);
        localStorage.removeItem(LS_URL);
        localStorage.removeItem(LS_TAB);
      }
    } catch {
      /* ignore */
    }
  }

  /** @param {HTMLElement} host @param {string} oldStr @param {string} newStr */
  function renderPromptWordDiff(host, oldStr, newStr) {
    host.textContent = "";
    if (typeof Diff === "undefined" || typeof Diff.diffWordsWithSpace !== "function") {
      host.textContent = "Diff library failed to load.";
      return;
    }
    const parts = Diff.diffWordsWithSpace(oldStr || "", newStr || "");
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p.value) continue;
      if (p.added) {
        const s = document.createElement("span");
        s.className = "diff-word diff-add";
        s.textContent = p.value;
        s.title = "Added";
        host.appendChild(s);
      } else if (p.removed) {
        const s = document.createElement("span");
        s.className = "diff-word diff-del";
        s.textContent = p.value;
        s.title = "Removed";
        host.appendChild(s);
      } else {
        host.appendChild(document.createTextNode(p.value));
      }
    }
  }

  /** @param {HTMLElement} el @param {string} oldStr @param {string} newStr */
  function fillPromptSummary(el, oldStr, newStr) {
    el.textContent = "";
    if (typeof Diff === "undefined" || typeof Diff.diffWordsWithSpace !== "function") {
      el.hidden = true;
      return;
    }
    const parts = Diff.diffWordsWithSpace(oldStr || "", newStr || "");
    let removedChars = 0;
    let addedChars = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.added) addedChars += p.value.length;
      else if (p.removed) removedChars += p.value.length;
    }
    const vol = removedChars + addedChars;
    const startLen = (oldStr || "").length;

    const pctStr =
      startLen === 0
        ? addedChars > 0
          ? "N/A (starting prompt empty)"
          : "0%"
        : ((100 * vol) / startLen).toFixed(2) + "%";

    const line1 = document.createElement("div");
    line1.appendChild(document.createTextNode("Diff size vs starting prompt: "));
    const s1 = document.createElement("strong");
    s1.textContent = pctStr;
    line1.appendChild(s1);
    line1.appendChild(
      document.createTextNode(
        " — character-weighted change volume (removed + added) divided by starting prompt length."
      )
    );
    el.appendChild(line1);

    const line2 = document.createElement("div");
    line2.style.marginTop = "0.35rem";
    line2.style.color = "var(--muted)";
    line2.appendChild(
      document.createTextNode(
        "Removed " +
          removedChars.toLocaleString() +
          " chars · Added " +
          addedChars.toLocaleString() +
          " chars · Combined change " +
          vol.toLocaleString() +
          " chars · Starting length " +
          startLen.toLocaleString() +
          " chars."
      )
    );
    el.appendChild(line2);
    el.hidden = false;
  }

  /**
   * @param {HTMLElement} host
   * @param {string} oldStr
   * @param {string} newStr
   * @param {string} oldLabel
   * @param {string} newLabel
   */
  function renderPatchToHost(host, oldStr, newStr, oldLabel, newLabel) {
    host.innerHTML = "";
    if (typeof Diff === "undefined" || typeof Diff.createTwoFilesPatch !== "function") {
      host.textContent = "Diff library failed to load.";
      return;
    }
    const patch = Diff.createTwoFilesPatch(oldLabel, newLabel, oldStr, newStr, "", "", {
      context: 5,
    });
    if (typeof Diff2Html !== "undefined" && typeof Diff2Html.html === "function") {
      host.innerHTML = Diff2Html.html(patch, {
        drawFileList: false,
        matching: "lines",
        outputFormat: "side-by-side",
        synchronisedScroll: true,
        highlight: true,
      });
      return;
    }
    host.textContent = patch;
  }

  function setTab(which) {
    const map = [
      ["prompt", els.tabPrompt, els.panelPrompt],
      ["rubric", els.tabRubric, els.panelRubric],
      ["split", els.tabSplit, els.panelSplit],
    ];
    for (let i = 0; i < map.length; i++) {
      const tab = map[i][1];
      const panel = map[i][2];
      const on = tab.id === "tab-" + which;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      panel.hidden = !on;
    }
  }

  function currentTask() {
    const i = Number(els.taskSelect.value);
    return tasks[i] || null;
  }

  /** @param {Record<string, string>|null} t */
  function reviewerInfo(t) {
    if (!t) return null;
    if (typeof t.contributor === "string" && t.contributor.trim()) {
      return {
        contributor: t.contributor.trim(),
        review_date: String(t.review_date || "").trim(),
      };
    }
    const id = t.task_id ? String(t.task_id) : "";
    const r = reviewerByTaskId[id];
    if (r && typeof r.contributor === "string" && r.contributor.trim()) {
      return {
        contributor: r.contributor.trim(),
        review_date: typeof r.review_date === "string" ? r.review_date.trim() : "",
      };
    }
    return null;
  }

  function refreshDiffs() {
    const t = currentTask();
    if (!t) {
      els.diffPrompt.textContent = "";
      els.diffRubric.textContent = "";
      els.splitPrompt.textContent = "";
      els.splitRubric.textContent = "";
      els.promptSummary.hidden = true;
      els.taskMeta.textContent = "";
      return;
    }
    const prev = t.previous_prompt || "";
    const latest = t.latest_prompt || "";
    renderPromptWordDiff(els.diffPrompt, prev, latest);
    fillPromptSummary(els.promptSummary, prev, latest);

    renderPatchToHost(
      els.diffRubric,
      t.previous_rubric || "",
      t.latest_rubric || "",
      "previous_rubric",
      "latest_rubric"
    );
    els.splitPrompt.textContent = latest;
    els.splitRubric.textContent = t.latest_rubric || "";

    els.taskMeta.textContent = "";
    const idLine = document.createElement("span");
    idLine.appendChild(document.createTextNode("task_id: "));
    const code = document.createElement("code");
    code.textContent = t.task_id || "";
    idLine.appendChild(code);
    els.taskMeta.appendChild(idLine);
    if (t.task_url && /^https?:\/\//i.test(t.task_url)) {
      els.taskMeta.appendChild(document.createTextNode(" · "));
      const a = document.createElement("a");
      a.href = t.task_url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "Open task";
      els.taskMeta.appendChild(a);
    }

    const rev = reviewerInfo(t);
    if (rev) {
      const badge = document.createElement("span");
      badge.className = "reviewer";
      let label = "Reviewed by " + rev.contributor;
      if (rev.review_date) label += " · " + rev.review_date;
      badge.textContent = label;
      els.taskMeta.appendChild(document.createTextNode(" "));
      els.taskMeta.appendChild(badge);
    }
  }

  function populateSelect() {
    els.taskSelect.innerHTML = "";
    if (tasks.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "— Load sheet or local JSON —";
      opt.disabled = true;
      opt.selected = true;
      els.taskSelect.appendChild(opt);
      return;
    }
    tasks.forEach((t, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      const short = (t.task_id || "row " + i).slice(0, 8);
      const sameP = (t.previous_prompt || "") === (t.latest_prompt || "");
      const sameR = (t.previous_rubric || "") === (t.latest_rubric || "");
      const rev = reviewerInfo(t);
      const who = rev ? rev.contributor + " · " : "";
      opt.textContent =
        who + short + "…" + (sameP ? "" : " · prompt Δ") + (sameR ? "" : " · rubric Δ");
      els.taskSelect.appendChild(opt);
    });
  }

  function showError(msg) {
    els.loadError.hidden = false;
    els.loadError.innerHTML = "<strong>" + escapeHtml(msg) + "</strong>";
  }

  function clearError() {
    els.loadError.hidden = true;
    els.loadError.textContent = "";
  }

  async function loadReviewersOptional() {
    try {
      const revRes = await fetch("data/reviewers.json", { cache: "no-store" });
      if (!revRes.ok) {
        reviewerByTaskId = {};
        return;
      }
      const j = await revRes.json();
      reviewerByTaskId = j && typeof j === "object" && !Array.isArray(j) ? j : {};
    } catch {
      reviewerByTaskId = {};
    }
  }

  async function loadFromGoogleSheet() {
    clearError();
    const id = extractSpreadsheetId(els.sheetUrl.value);
    const apiKey = els.sheetApiKey.value.trim();
    const tab = els.sheetTab.value.trim() || "Sheet1";
    if (!id) {
      showError("Paste a full Google Sheets URL or the spreadsheet ID.");
      return;
    }
    if (!apiKey) {
      showError("Enter a Google API key with the Sheets API enabled.");
      return;
    }
    persistFormIfNeeded();
    els.btnLoadSheet.disabled = true;
    try {
      const values = await fetchGoogleSheetValues(id, tab, apiKey);
      tasks = rowsToTasks(values);
      if (tasks.length === 0) {
        throw new Error("No data rows after the header.");
      }
      await loadReviewersOptional();
      populateSelect();
      refreshDiffs();
    } catch (e) {
      tasks = [];
      populateSelect();
      showError(String(e && e.message ? e.message : e));
    } finally {
      els.btnLoadSheet.disabled = false;
    }
  }

  async function loadLocalJson() {
    clearError();
    els.btnLoadLocal.disabled = true;
    try {
      const tasksRes = await fetch("data/tasks.json", { cache: "no-store" });
      if (!tasksRes.ok) throw new Error(tasksRes.status + " " + tasksRes.statusText);
      tasks = await tasksRes.json();
      if (!Array.isArray(tasks) || tasks.length === 0) throw new Error("No tasks in JSON");
      await loadReviewersOptional();
      populateSelect();
      refreshDiffs();
    } catch (e) {
      reviewerByTaskId = {};
      tasks = [];
      populateSelect();
      showError(
        "Could not load data/tasks.json. " +
          String(e && e.message ? e.message : e) +
          " — use Load sheet or run export_xlsx_to_json.py."
      );
    } finally {
      els.btnLoadLocal.disabled = false;
    }
  }

  els.btnLoadSheet.addEventListener("click", loadFromGoogleSheet);
  els.btnLoadLocal.addEventListener("click", loadLocalJson);
  els.taskSelect.addEventListener("change", refreshDiffs);

  els.tabPrompt.addEventListener("click", function () {
    setTab("prompt");
  });
  els.tabRubric.addEventListener("click", function () {
    setTab("rubric");
  });
  els.tabSplit.addEventListener("click", function () {
    setTab("split");
  });

  els.rememberKey.addEventListener("change", function () {
    if (!els.rememberKey.checked) {
      try {
        localStorage.removeItem(LS_REM);
        localStorage.removeItem(LS_KEY);
        localStorage.removeItem(LS_URL);
        localStorage.removeItem(LS_TAB);
      } catch {
        /* ignore */
      }
    }
  });

  restoreFormFromStorage();
  populateSelect();
})();
