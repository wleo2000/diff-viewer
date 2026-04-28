(function () {
  "use strict";

  const FIXED_SPREADSHEET_ID = "1QkeLcwHvBhhOOm_n7zA7wNliuDbKSOtRCjvYiCbDV2M";
  /** Prefer these tab names in order; if none match, use the first tab in the file. */
  const PREFERRED_SHEET_TABS = ["Sheet1", "Sheet 1", "Data", "Tasks", "Export", "Query"];

  /** @type {string} */
  let resolvedSheetTitle = "";

  /** @type {Array<Record<string, string>>} */
  let tasks = [];

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
    btnTaskPrev: document.getElementById("btn-task-prev"),
    btnTaskNext: document.getElementById("btn-task-next"),
    datasetAnalysis: document.getElementById("dataset-analysis"),
    datasetAnalysisBody: document.getElementById("dataset-analysis-body"),
    contributorAnalysis: document.getElementById("contributor-analysis"),
    contributorAnalysisBody: document.getElementById("contributor-analysis-body"),
    contributorAnalysisLead: document.getElementById("contributor-analysis-lead"),
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

  /** Column G (1-based) = index 6 — contributor name for each row. */
  const CONTRIBUTOR_COLUMN_INDEX = 6;

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
        contributor: get(CONTRIBUTOR_COLUMN_INDEX),
        review_date: get(ix.review_date),
      });
    }
    return rows;
  }

  function quoteSheetTab(tabName) {
    const t = String(tabName || "").trim();
    if (!t) return "Sheet1";
    const needsQuote = /[^a-zA-Z0-9_]/.test(t) || /^\d/.test(t);
    return needsQuote ? "'" + t.replace(/'/g, "''") + "'" : t;
  }

  /** All used data in columns A–ZZ (unbounded rows); avoids some “parse range” edge cases. */
  function a1RangeForTab(tabName) {
    return quoteSheetTab(tabName) + "!A:ZZ";
  }

  /** @param {string} spreadsheetId @param {string} apiKey @returns {Promise<string[]>} */
  async function fetchSpreadsheetTabTitles(spreadsheetId, apiKey) {
    const url =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(spreadsheetId) +
      "?fields=sheets.properties.title&key=" +
      encodeURIComponent(apiKey);
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
      const msg =
        data && data.error && data.error.message ? data.error.message : res.statusText;
      throw new Error(msg + " (" + res.status + ")");
    }
    const sheets = data.sheets || [];
    const titles = [];
    for (let i = 0; i < sheets.length; i++) {
      const t = sheets[i] && sheets[i].properties && sheets[i].properties.title;
      if (t) titles.push(String(t));
    }
    return titles;
  }

  /** @param {string[]} titles */
  function pickSheetTitle(titles) {
    if (!titles || titles.length === 0) {
      throw new Error("Spreadsheet has no tabs.");
    }
    const lower = titles.map(function (t) {
      return t.toLowerCase();
    });
    for (let p = 0; p < PREFERRED_SHEET_TABS.length; p++) {
      const want = PREFERRED_SHEET_TABS[p].toLowerCase();
      const idx = lower.indexOf(want);
      if (idx !== -1) return titles[idx];
    }
    return titles[0];
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
  /**
   * Word-diff volume vs “before” length (same basis as per-task summaries).
   * @returns {{ vol: number, startLen: number, pct: number | null }}
   */
  function diffVolumePct(beforeText, afterText) {
    const before = beforeText || "";
    const after = afterText || "";
    if (typeof Diff === "undefined" || typeof Diff.diffWordsWithSpace !== "function") {
      return { vol: 0, startLen: before.length, pct: null };
    }
    const parts = Diff.diffWordsWithSpace(before, after);
    let removedChars = 0;
    let addedChars = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.added) addedChars += p.value.length;
      else if (p.removed) removedChars += p.value.length;
    }
    const vol = removedChars + addedChars;
    const startLen = before.length;
    if (startLen === 0) {
      return { vol, startLen, pct: addedChars > 0 ? null : 0 };
    }
    return { vol, startLen, pct: (100 * vol) / startLen };
  }

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

  /** Contributor / date only from the sheet row (column G + optional header date). No JSON fallback. */
  /** @param {Record<string, string>|null} t */
  function reviewerInfo(t) {
    if (!t) return null;
    if (typeof t.contributor === "string" && t.contributor.trim()) {
      return {
        contributor: t.contributor.trim(),
        review_date: String(t.review_date || "").trim(),
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

  function formatPctOrDash(x) {
    if (x === null || typeof x !== "number" || Number.isNaN(x)) return "—";
    return x.toFixed(1) + "%";
  }

  /**
   * @param {Array<Record<string, string>>} list
   * @returns {{
   *   n: number,
   *   promptEdits: number,
   *   rubricEdits: number,
   *   pctPromptTasks: number,
   *   pctRubricTasks: number,
   *   avgPrompt: number | null,
   *   avgRubric: number | null,
   *   cntPromptPct: number,
   *   cntRubricPct: number
   * }}
   */
  function computeMetricsForTaskList(list) {
    const n = list.length;
    if (n === 0) {
      return {
        n: 0,
        promptEdits: 0,
        rubricEdits: 0,
        pctPromptTasks: 0,
        pctRubricTasks: 0,
        avgPrompt: null,
        avgRubric: null,
        cntPromptPct: 0,
        cntRubricPct: 0,
      };
    }
    let promptEdits = 0;
    let rubricEdits = 0;
    let sumPromptPct = 0;
    let cntPromptPct = 0;
    let sumRubricPct = 0;
    let cntRubricPct = 0;

    for (let i = 0; i < n; i++) {
      const t = list[i];
      const pBefore = t.previous_prompt || "";
      const pAfter = t.latest_prompt || "";
      if (pBefore !== pAfter) promptEdits++;

      const rBefore = rubricToPlaintext(t.previous_rubric || "");
      const rAfter = rubricToPlaintext(t.latest_rubric || "");
      if (rBefore !== rAfter) rubricEdits++;

      const dp = diffVolumePct(pBefore, pAfter);
      if (dp.pct !== null) {
        sumPromptPct += dp.pct;
        cntPromptPct++;
      }
      const dr = diffVolumePct(rBefore, rAfter);
      if (dr.pct !== null) {
        sumRubricPct += dr.pct;
        cntRubricPct++;
      }
    }

    return {
      n,
      promptEdits,
      rubricEdits,
      pctPromptTasks: (100 * promptEdits) / n,
      pctRubricTasks: (100 * rubricEdits) / n,
      avgPrompt: cntPromptPct ? sumPromptPct / cntPromptPct : null,
      avgRubric: cntRubricPct ? sumRubricPct / cntRubricPct : null,
      cntPromptPct,
      cntRubricPct,
    };
  }

  /**
   * @param {HTMLElement} grid
   * @param {object} m metrics from computeMetricsForTaskList
   * @param {{ tasksLabel?: string, tasksCardTitle?: string }} [opts]
   */
  function appendMetricCards(grid, m, opts) {
    const tasksLabel = (opts && opts.tasksLabel) || "Data rows in this sheet load";
    const tasksCardTitle = (opts && opts.tasksCardTitle) || "Tasks";

    /**
     * @param {string} label
     * @param {string} value
     * @param {string} [sub]
     */
    function card(label, value, sub) {
      const c = document.createElement("div");
      c.className = "analysis-card";
      const h = document.createElement("div");
      h.className = "analysis-card-label";
      h.textContent = label;
      const v = document.createElement("div");
      v.className = "analysis-card-value";
      v.textContent = value;
      c.appendChild(h);
      c.appendChild(v);
      if (sub) {
        const s = document.createElement("div");
        s.className = "analysis-card-sub";
        s.textContent = sub;
        c.appendChild(s);
      }
      grid.appendChild(c);
    }

    if (m.n === 0) {
      card(tasksCardTitle, "0", "No tasks in this slice");
      return;
    }

    card(tasksCardTitle, String(m.n), tasksLabel);
    card(
      "Prompt edits",
      m.promptEdits + " (" + m.pctPromptTasks.toFixed(1) + "%)",
      "Share of these tasks where previous prompt ≠ latest (raw text)"
    );
    card(
      "Rubric edits",
      m.rubricEdits + " (" + m.pctRubricTasks.toFixed(1) + "%)",
      "Share of these tasks where plaintext rubric (before) ≠ (after)"
    );
    card(
      "Avg prompt change depth",
      formatPctOrDash(m.avgPrompt),
      m.cntPromptPct
        ? "Mean of (removed+added chars) ÷ prior prompt length · " + m.cntPromptPct + " task(s) with non-empty prior"
        : "No tasks with a non-empty prior prompt"
    );
    card(
      "Avg rubric change depth",
      formatPctOrDash(m.avgRubric),
      m.cntRubricPct
        ? "Same metric on plaintext rubrics · " + m.cntRubricPct + " task(s) with non-empty prior rubric"
        : "No tasks with a non-empty prior rubric"
    );
  }

  /** @returns {Map<string, { displayName: string, tasks: Array<Record<string, string>> }>} */
  function groupTasksByContributor() {
    const map = new Map();
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const raw = typeof t.contributor === "string" ? t.contributor.trim() : "";
      const groupKey = raw || "__empty__";
      const displayName = raw || "(no name in column G)";
      if (!map.has(groupKey)) {
        map.set(groupKey, { displayName: displayName, tasks: [] });
      }
      map.get(groupKey).tasks.push(t);
    }
    return map;
  }

  function updateDatasetAnalysis() {
    const section = els.datasetAnalysis;
    const body = els.datasetAnalysisBody;
    const contribSection = els.contributorAnalysis;
    const contribBody = els.contributorAnalysisBody;
    if (!section || !body) return;
    const n = tasks.length;
    if (n === 0) {
      section.hidden = true;
      body.textContent = "";
      if (contribSection) contribSection.hidden = true;
      if (contribBody) contribBody.textContent = "";
      if (els.contributorAnalysisLead) els.contributorAnalysisLead.textContent = "";
      return;
    }
    section.hidden = false;
    body.textContent = "";

    const overall = computeMetricsForTaskList(tasks);
    const grid = document.createElement("div");
    grid.className = "analysis-metrics";
    appendMetricCards(grid, overall, {
      tasksLabel: "All loaded rows",
      tasksCardTitle: "Tasks loaded",
    });
    body.appendChild(grid);

    if (contribSection && contribBody) {
      contribSection.hidden = false;
      contribBody.textContent = "";
      const grouped = groupTasksByContributor();
      if (els.contributorAnalysisLead) {
        const uniq = grouped.size;
        els.contributorAnalysisLead.textContent =
          "Same metrics as the dataset overview, scoped to each unique value in column G. " +
          uniq +
          " unique contributor" +
          (uniq === 1 ? "" : "s") +
          " (including 'no name' if column G is blank).";
      }
      const entries = Array.from(grouped.entries());
      entries.sort(function (a, b) {
        if (a[0] === "__empty__") return 1;
        if (b[0] === "__empty__") return -1;
        return a[1].displayName.localeCompare(b[1].displayName, undefined, { sensitivity: "base" });
      });
      for (let e = 0; e < entries.length; e++) {
        const info = entries[e][1];
        const block = document.createElement("div");
        block.className = "contributor-block";
        const h = document.createElement("h3");
        h.className = "contributor-block-title";
        h.textContent = info.displayName;
        block.appendChild(h);
        const inner = document.createElement("div");
        inner.className = "analysis-metrics";
        const m = computeMetricsForTaskList(info.tasks);
        appendMetricCards(inner, m, {
          tasksLabel: "This contributor’s tasks (column G)",
        });
        block.appendChild(inner);
        contribBody.appendChild(block);
      }
    }
  }

  function syncTaskNavButtons() {
    const empty = tasks.length === 0;
    els.btnTaskPrev.disabled = empty;
    els.btnTaskNext.disabled = empty;
  }

  /** @param {number} delta +1 next, -1 previous; wraps at ends */
  function goTaskByOffset(delta) {
    const n = tasks.length;
    if (n === 0) return;
    let i = Number(els.taskSelect.value);
    if (Number.isNaN(i) || i < 0 || i >= n) i = 0;
    i = (i + delta + n) % n;
    els.taskSelect.value = String(i);
    refreshDiffs();
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
      syncTaskNavButtons();
      updateDatasetAnalysis();
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
    syncTaskNavButtons();
    updateDatasetAnalysis();
  }

  function showError(msg) {
    els.loadError.hidden = false;
    els.loadError.innerHTML = "<strong>" + escapeHtml(msg) + "</strong>";
  }

  function clearError() {
    els.loadError.hidden = true;
    els.loadError.textContent = "";
  }

  async function loadSheetData() {
    clearError();
    const apiKey = getApiKey();
    if (!apiKey) {
      els.sheetStatus.textContent = "Missing API key.";
      els.loadError.hidden = false;
      els.loadError.innerHTML =
        "<strong>API key is missing in the files this deployment is serving.</strong>" +
        "<p style=\"margin:0.5rem 0 0;font-weight:normal\">On Vercel the key is written at <strong>build</strong> time into <code>js/config.generated.js</code> from the environment variable <code>SHEETS_API_KEY</code> (or <code>GOOGLE_SHEETS_API_KEY</code>).</p>" +
        "<ul style=\"margin:0.5rem 0 0;padding-left:1.2rem;font-weight:normal\">" +
        "<li>Name must match exactly (common mistake: spaces or wrong name).</li>" +
        "<li>Turn on <strong>Production</strong> (and <strong>Preview</strong> if you use preview URLs) for that variable.</li>" +
        "<li>After saving env vars, trigger a <strong>new deployment</strong> (Redeploy) — existing deployments keep the old file.</li>" +
        "<li>In the deployment <strong>Build</strong> log, look for <code>[gen-config] key length=…</code> — length should be &gt; 0.</li>" +
        "</ul>" +
        "<p style=\"margin:0.5rem 0 0;font-weight:normal\">Local: run <code>npm run build</code> with <code>SHEETS_API_KEY</code> set, or add a one-line <code>.sheets-key</code> file in the project root, then build again.</p>";
      tasks = [];
      populateSelect();
      refreshDiffs();
      return;
    }

    els.sheetStatus.textContent = "Loading sheet…";
    els.btnReload.disabled = true;
    const prevTasks = tasks.slice();
    try {
      const tabTitles = await fetchSpreadsheetTabTitles(FIXED_SPREADSHEET_ID, apiKey);
      const tabName = pickSheetTitle(tabTitles);
      resolvedSheetTitle = tabName;
      const values = await fetchGoogleSheetValues(FIXED_SPREADSHEET_ID, tabName, apiKey);
      tasks = rowsToTasks(values);
      if (tasks.length === 0) {
        throw new Error("No data rows after the header.");
      }
      populateSelect();
      refreshDiffs();
      els.sheetStatus.textContent =
        "Loaded " +
        tasks.length +
        " row(s) · tab “" +
        tabName +
        "” · " +
        FIXED_SPREADSHEET_ID.slice(0, 8) +
        "…";
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
  els.btnTaskPrev.addEventListener("click", function () {
    goTaskByOffset(-1);
  });
  els.btnTaskNext.addEventListener("click", function () {
    goTaskByOffset(1);
  });

  els.tabPrompt.addEventListener("click", function () {
    setTab("prompt");
  });
  els.tabRubric.addEventListener("click", function () {
    setTab("rubric");
  });
  els.tabSplit.addEventListener("click", function () {
    setTab("split");
  });

  syncTaskNavButtons();
  updateDatasetAnalysis();
  loadSheetData();
})();
