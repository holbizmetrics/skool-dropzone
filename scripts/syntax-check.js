// skool-dropzone — syntax gate
//
// Walks the source trees and runs `node --check` on every .js file. This
// catches parse errors in files the unit tests only read as TEXT (panel.js,
// whiteboard.js, service-worker.js) rather than execute. Auto-discovering, so
// new files are covered without editing this list. Zero dependencies.
//
// Run:  node scripts/syntax-check.js   (or: npm run check)

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOTS = ["extension", "signaling", "scripts"];
const SKIP_DIRS = new Set(["node_modules", ".git"]);

const files = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith(".js")) files.push(p);
  }
}
ROOTS.forEach((r) => walk(path.join(__dirname, "..", r)));

let failed = 0;
for (const f of files) {
  const rel = path.relative(path.join(__dirname, ".."), f);
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
    console.log("  ok   " + rel);
  } catch (e) {
    failed++;
    console.error("  FAIL " + rel + "\n" + (e.stderr || e).toString());
  }
}

console.log(`\n=== syntax: ${files.length - failed}/${files.length} files OK ===`);
process.exit(failed ? 1 : 0);
