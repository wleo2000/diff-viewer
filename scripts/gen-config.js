/**
 * Writes js/config.generated.js for the browser.
 * Vercel: set SHEETS_API_KEY on the project (Production + Preview), then redeploy.
 * Local: export SHEETS_API_KEY=... or put the key in a one-line .sheets-key file (gitignored).
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function pickKey() {
  const candidates = ["SHEETS_API_KEY", "GOOGLE_SHEETS_API_KEY"];
  for (let i = 0; i < candidates.length; i++) {
    const v = process.env[candidates[i]];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

let key = pickKey();
const keyFile = path.join(root, ".sheets-key");
try {
  if (!key && fs.existsSync(keyFile)) {
    key = fs.readFileSync(keyFile, "utf8").trim();
  }
} catch {
  /* ignore */
}

const onVercel = process.env.VERCEL === "1";

console.log(
  "[gen-config] VERCEL=" +
    (process.env.VERCEL || "") +
    " · key length=" +
    (key ? key.length : 0) +
    " · tried env: SHEETS_API_KEY, GOOGLE_SHEETS_API_KEY"
);

if (onVercel && !key) {
  console.error(
    "[gen-config] ERROR: No API key found during Vercel build.\n" +
      "  → Vercel → Project → Settings → Environment Variables\n" +
      "  → Add SHEETS_API_KEY (exact name), enable for Production (and Preview if needed)\n" +
      "  → Save, then Redeploy (old deployments still contain the empty key)."
  );
  process.exit(1);
}

const out =
  "// Generated at build — do not edit by hand\n" +
  "window.__SHEETS_API_KEY__ = " +
  JSON.stringify(key) +
  ";\n";

fs.writeFileSync(path.join(root, "js", "config.generated.js"), out, "utf8");
console.log("[gen-config] Wrote js/config.generated.js (" + (key ? "key present" : "empty key (local only)") + ")");
