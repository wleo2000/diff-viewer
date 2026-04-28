(function () {
  "use strict";

  const FIXED_SPREADSHEET_ID = "1QkeLcwHvBhhOOm_n7zA7wNliuDbKSOtRCjvYiCbDV2M";
  const FIXED_SHEET_TAB = "Sheet1";

  /** @type {Array<Record<string, string>>} */
  let tasks = [];

  /** @type {Record<string, { contributor?: string, review_date?: string }>} */
  let reviewerByTaskId = {};

  const els = {
    sheetStatus: document.getElementById("sheet-status"),
    btnReload: document.getElementById("btn-reload"),
    taskSelect: document.getElementById("task-select"),
    taskMeta: document.getElementById("task-meta"),
    loadError: document.getElementById("load-error"),
    promptBefore: document.getElementById("prompt-before"),
    promptAfter: document.getElementById("prompt-after"),
    rubricBefore: document.getElementById("rubric-before"),
    rubricAfter: document.getElementById("rubric-after"),
    promptSummary: document.getElementById("prompt-diff-summary"),
    rubricSummary: document.getElementById("rubric-diff-summary"),
    splitPrompt: document.getElementById("split-prompt"),
    splitRubric: document.getElementById("split-rubric"),
    tabPrompt: document.getElementById("tab-prompt"),
    tabRubric: document.getElementById("tab-rubric"),
    tabSplit: document.getElementById("tab-split"),
    panelPrompt: document.getElementById("panel-prompt"),
    panelRubric: document.getElementById("panel-rubric"),
    panelSplit: document.getElementById("panel-split"),
  };

  function getApiKey() {
    if (typeof window !== "undefined" && window.__SHEETS_API_KEY__) {
      return String(window.__SHEETS_API_KEY__).trim();
    }
    return "";
  }

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

  /** Parse rubric JSON (raw or pretty) into { sections } root */
  function parseRubricRoot(str) {
    const t = String(str || "").trim();
    if (!t) return null;
    try {
      const o = JSON.parse(t);
      if (o && typeof o === "object" && Array.isArray(o.sections)) return o;
      if (o && o._value && typeof o._value === "object" && Array.isArray(o._value.sections)) {
        return o._value;
      }
    } catch {
      return null;
    }
    return null;
  }

  /** Human-readable rubric for diffing (no UUIDs) */
  function rubricToPlaintext(str) {
    const root = parseRubricRoot(str);
    if (!root || !Array.isArray(root.sections)) {
      return String(str || "").trim();
    }
    const lines = [];
    root.sections.forEach(function (sec) {
      lines.push("## " + String(sec.name || "Section").trim());
      lines.push("");
      const crit = sec.criteria || [];
      crit.forEach(function (c) {
        const pts = c.points != null && c.points !== "" ? String(c.points) : "?";
        const q = String(c.question || "").trim();
        lines.push("[" + pts + " pts] " + q);
        lines.push("");
      });
    });
    return lines.join("\n").trim();
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

  /**
   * Before column: unchanged + removed (red). After column: unchanged + added (green).
   * @param {HTMLElement} leftHost
   * @param {HTMLElement} rightHost
   * @param {string} oldStr
   * @param {string} newStr
   */
  function fillDualWordDiff(leftHost, rightHost, oldStr, newStr) {
    leftHost.textContent = "";
    rightHost.textContent = "";
    if (typeof Diff === "undefined" || typeof Diff.diffWordsWithSpace !== "function") {
      leftHost.textContent = "Diff library failed to load.";
      return;
    }
    const parts = Diff.diffWordsWithSpace(oldStr || "", newStr || "");
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p.value) continue;
      if (p.removed) {
        const s = document.createElement("span");
        s.className = "diff-word diff-del";
        s.textContent = p.value;
        s.title = "Removed";
        leftHost.appendChild(s);
      } else if (p.added) {
        const s = document.createElement("span");
        s.className = "diff-word diff-add";
        s.textContent = p.value;
        s.title = "Added";
        rightHost.appendChild(s);
      } else {
        leftHost.appendChild(document.createTextNode(p.value));
        rightHost.appendChild(document.createTextNode(p.value));
      }
    }
  }

  /** @param {HTMLElement} el @param {string} oldStr @param {string} newStr */
  function fillDiffSummary(el, oldStr, newStr, titlePrefix) {
    el.textContent = "";
    if (typeof Diff === "undefined" || typeof Diff.diffWordsWithSpace !== "function") {
      el.hidden = true;
      return;
    }
    const parts = Diff.diffWordsWithSpace(oldStr || "", newStr || "");
    let removedChars = 0;
    let addedChars = 0;
    let removedHunks = 0;
    let addedHunks = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.added) {
        addedChars += p.value.length;
        addedHunks++;
      } else if (p.removed) {
        removedChars += p.value.length;
        removedHunks++;
      }
    }
    const vol = removedChars + addedChars;
    const startLen = (oldStr || "").length;

    const pctStr =
      startLen === 0
        ? addedChars > 0
          ? "N/A (empty “before” text)"
          : "0%"
        : ((100 * vol) / startLen).toFixed(2) + "%";

    const line1 = document.createElement("div");
    line1.appendChild(document.createTextNode(titlePrefix + " change volume vs “before”: "));
    const s1 = document.createElement("strong");
    s1.textContent = pctStr;
    line1.appendChild(s1);
    line1.appendChild(
      document.createTextNode(
        " of “before” length — (chars removed + chars added) / length of before."
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
          " chars in " +
          removedHunks +
          " segment(s) · Added " +
          addedChars.toLocaleString() +
          " chars in " +
          addedHunks +
          " segment(s) · Combined " +
          vol.toLocaleString() +
          " chars · Before length " +
          startLen.toLocaleString() +
          " chars."
      )
    );
    el.appendChild(line2);
    el.hidden = false;
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
    if (Number.isNaN(i)) return null;
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
      els.promptBefore.textContent = "";
      els.promptAfter.textContent = "";
      els.rubricBefore.textContent = "";
      els.rubricAfter.textContent = "";
      els.splitPrompt.textContent = "";
      els.splitRubric.textContent = "";
      els.promptSummary.hidden = true;
      els.rubricSummary.hidden = true;
      els.taskMeta.textContent = "";
      return;
    }
    const prev = t.previous_prompt || "";
    const latest = t.latest_prompt || "";
    fillDualWordDiff(els.promptBefore, els.promptAfter, prev, latest);
    fillDiffSummary(els.promptSummary, prev, latest, "Prompt");

    const prevR = rubricToPlaintext(t.previous_rubric || "");
    const latestR = rubricToPlaintext(t.latest_rubric || "");
    fillDualWordDiff(els.rubricBefore, els.rubricAfter, prevR, latestR);
    fillDiffSummary(els.rubricSummary, prevR, latestR, "Rubric (plaintext)");

    els.splitPrompt.textContent = latest;
    els.splitRubric.textContent = latestR;

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
      opt.textContent = "— No rows loaded —";
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
      const sameR = rubricToPlaintext(t.previous_rubric || "") === rubricToPlaintext(t.latest_rubric || "");
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

  async function loadSheetData() {
    clearError();
    const apiKey = getApiKey();
    if (!apiKey) {
      els.sheetStatus.textContent = "Missing API key.";
      showError(
        "No Google API key in js/config.generated.js. Run npm run build with environment variable SHEETS_API_KEY " +
          "(Vercel: Project → Settings → Environment Variables), or create a one-line .sheets-key file in the project root and run npm run build again."
      );
      tasks = [];
      populateSelect();
      refreshDiffs();
      return;
    }

    els.sheetStatus.textContent = "Loading sheet…";
    els.btnReload.disabled = true;
    const prevTasks = tasks.slice();
    try {
      const values = await fetchGoogleSheetValues(FIXED_SPREADSHEET_ID, FIXED_SHEET_TAB, apiKey);
      tasks = rowsToTasks(values);
      if (tasks.length === 0) {
        throw new Error("No data rows after the header.");
      }
      await loadReviewersOptional();
      populateSelect();
      refreshDiffs();
      els.sheetStatus.textContent =
        "Loaded " + tasks.length + " row(s) from Google Sheets · " + FIXED_SPREADSHEET_ID.slice(0, 8) + "…";
    } catch (e) {
      tasks = prevTasks;
      populateSelect();
      refreshDiffs();
      els.sheetStatus.textContent = "Load failed (kept previous data if any).";
      showError(String(e && e.message ? e.message : e));
    } finally {
      els.btnReload.disabled = false;
    }
  }

  els.btnReload.addEventListener("click", loadSheetData);
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

  loadSheetData();
})();
