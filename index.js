#!/usr/bin/env node
// Zero-dependency CLI, ESM, Node >=18.
// autogit — auto stage→commit→push for agentic engineers
//   autogit setup     wire agent hooks globally (once per machine)
//   autogit on/off    enable/disable auto-push in current repo
//   autogit ship      stage, scan, commit, push (what the hooks run)
//   autogit status    show hooks + repo state
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const CONFIG_FILE = ".autogit.json";
const DEFAULTS = { mode: "auto", remote: "origin", branch: "current", secretsScan: true };

// ---------- helpers ----------
// Helpers wrap git/fs calls so commands above stay readable.

function git(...args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { ok: r.status === 0, out: ((r.stdout || "") + (r.stderr || "")).trim() };
}

function die(msg, code = 1) { console.error(`✗ autogit: ${msg}`); process.exit(code); }
function ok(msg) { console.log(`✓ autogit: ${msg}`); }

function repoRootOrNull() {
  const r = git("rev-parse", "--show-toplevel");
  return r.ok ? r.out : null;
}

// ---------- secrets scanning ----------

const SECRET_PATTERNS = [
  { name: "AWS access key", re: /AKIA[0-9A-Z]{16}/ },
  { name: "Private key block", re: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: "Generic API key assignment", re: /(api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token)["']?\s*[:=]\s*["'][A-Za-z0-9_\-]{20,}["']/i },
  { name: "OpenAI key", re: /sk-[A-Za-z0-9_\-]{20,}/ },
  { name: "Anthropic key", re: /sk-ant-[A-Za-z0-9_\-]{20,}/ },
  { name: "GitHub token", re: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: "Slack token", re: /xox[baprs]-[A-Za-z0-9\-]{10,}/ },
  { name: "Google API key", re: /AIza[0-9A-Za-z_\-]{35}/ },
  { name: "JWT", re: /eyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/ }
];

const SENSITIVE_FILES = [/^\.env(\..+)?$/, /\.pem$/, /\.key$/, /id_rsa/, /credentials\.json$/];

function scanSecrets() {
  const findings = [];
  const staged = git("diff", "--cached", "--name-only").out.split("\n").filter(Boolean);

  for (const f of staged) {
    if (SENSITIVE_FILES.some(re => re.test(path.basename(f)))) {
      findings.push({ file: f, issue: "sensitive filename" });
    }
  }

  // only scan added lines
  let currentFile = "";
  for (const line of git("diff", "--cached", "--unified=0").out.split("\n")) {
    if (line.startsWith("+++ b/")) { currentFile = line.slice(6); continue; }
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(line)) findings.push({ file: currentFile, issue: name });
    }
  }
  return findings;
}

// ---------- setup: wire agent hooks globally ----------

function setupClaude() {
  const dir = path.join(homedir(), ".claude");
  if (!existsSync(dir)) return "not installed — skipped";
  const file = path.join(dir, "settings.json");

  let settings = {};
  if (existsSync(file)) {
    try { settings = JSON.parse(readFileSync(file, "utf8")); }
    catch { return `could not parse ${file} — skipped, fix it and rerun`; }
  }
  if (JSON.stringify(settings).includes("autogit ship")) return "already wired";

  settings.hooks ??= {};
  settings.hooks.Stop ??= [];
  // cd to the project dir: hooks don't guarantee the working directory
  settings.hooks.Stop.push({
    hooks: [{ type: "command", command: 'cd "${CLAUDE_PROJECT_DIR:-.}" && autogit ship' }]
  });
  writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  return `wired (Stop hook in ${file})`;
}

function setupCodex() {
  const dir = path.join(homedir(), ".codex");
  if (!existsSync(dir)) return "not installed — skipped";
  const file = path.join(dir, "config.toml");
  const toml = existsSync(file) ? readFileSync(file, "utf8") : "";

  if (/^\s*notify\s*=/m.test(toml)) {
    return toml.includes("autogit")
      ? "already wired"
      : `notify already set in ${file} — skipped, point it at "autogit ship" yourself`;
  }
  // top-level TOML keys must come before any [section] — prepend
  writeFileSync(file, `notify = ["autogit", "ship"]\n` + toml);
  return `wired (notify in ${file})`;
}

function cmdSetup() {
  console.log(`Claude Code:  ${setupClaude()}`);
  console.log(`Codex:        ${setupCodex()}`);
  console.log(`\nNow opt in the repos you want auto-pushed:\n  cd <repo> && autogit on`);
}

// ---------- on / off ----------

function cmdOn() {
  const root = repoRootOrNull();
  if (!root) die("not inside a git repository.");
  const p = path.join(root, CONFIG_FILE);
  if (existsSync(p)) { ok("already on."); return; }
  writeFileSync(p, JSON.stringify({ mode: "auto" }, null, 2) + "\n");
  ok(`auto-push ON — every agent turn in this repo now ships to git.`);
}

function cmdOff() {
  const root = repoRootOrNull();
  if (!root) die("not inside a git repository.");
  const p = path.join(root, CONFIG_FILE);
  if (!existsSync(p)) { ok("already off."); return; }
  unlinkSync(p);
  ok("auto-push OFF.");
}

// ---------- ship ----------

function autoMessage(stagedFiles) {
  const names = stagedFiles.map(f => path.basename(f));
  const head = names.slice(0, 3).join(", ");
  const rest = names.length > 3 ? ` (+${names.length - 3} more)` : "";
  return `autogit: update ${head}${rest}`;
}

function cmdShip(args) {
  // Codex notify appends a JSON payload (with cwd) as the last argument
  const last = args[args.length - 1];
  if (last?.startsWith("{")) {
    try { const p = JSON.parse(last); if (p.cwd) process.chdir(p.cwd); } catch {}
  }

  // silent no-op unless we're in a repo that opted in — hooks fire everywhere
  const root = repoRootOrNull();
  if (!root) process.exit(0);
  const cfgPath = path.join(root, CONFIG_FILE);
  if (!existsSync(cfgPath)) process.exit(0);
  process.chdir(root);

  let config;
  try { config = { ...DEFAULTS, ...JSON.parse(readFileSync(cfgPath, "utf8")) }; }
  catch { die(`${CONFIG_FILE} is not valid JSON.`); }
  if (config.mode !== "auto") {
    console.log(`autogit: mode "${config.mode}" not supported yet — skipping.`);
    process.exit(0);
  }

  const mIdx = args.indexOf("-m");
  const message = mIdx !== -1 ? args[mIdx + 1] : null;

  git("add", "-A");
  const staged = git("diff", "--cached", "--name-only").out.split("\n").filter(Boolean);
  if (!staged.length) process.exit(0); // nothing changed — stay quiet

  if (config.secretsScan && !args.includes("--force-secrets")) {
    const findings = scanSecrets();
    if (findings.length) {
      git("reset");
      console.error("✗ autogit: blocked — possible secrets in the diff:");
      for (const f of findings) console.error(`    ${f.file}: ${f.issue}`);
      die("fix these, or rerun with --force-secrets.");
    }
  }

  const branch = config.branch === "current" ? git("rev-parse", "--abbrev-ref", "HEAD").out : config.branch;
  if (branch === "HEAD") { git("reset"); die("detached HEAD — won't auto-push."); }

  const commit = git("commit", "-m", message || autoMessage(staged));
  if (!commit.ok) die(`commit failed:\n${commit.out}`);

  const push = git("push", config.remote, `HEAD:${branch}`);
  if (!push.ok) die(`push failed (commit kept locally):\n${push.out}`);
  ok(`shipped ${staged.length} file(s) → ${config.remote}/${branch}`);
}

// ---------- status ----------

function cmdStatus() {
  const claudeFile = path.join(homedir(), ".claude", "settings.json");
  const claudeWired = existsSync(claudeFile) && readFileSync(claudeFile, "utf8").includes("autogit ship");
  const codexFile = path.join(homedir(), ".codex", "config.toml");
  const codexWired = existsSync(codexFile) && /^\s*notify\s*=.*autogit/m.test(readFileSync(codexFile, "utf8"));
  console.log(`hooks:  Claude Code ${claudeWired ? "wired" : "NOT wired"} · Codex ${codexWired ? "wired" : "NOT wired"}`);

  const root = repoRootOrNull();
  if (!root) { console.log("repo:   not inside a git repository"); return; }
  const on = existsSync(path.join(root, CONFIG_FILE));
  console.log(`repo:   ${root}`);
  console.log(`        auto-push ${on ? "ON" : "OFF — run: autogit on"}`);
}

// ---------- main ----------

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "setup": cmdSetup(); break;
  case "on": cmdOn(); break;
  case "off": cmdOff(); break;
  case "ship": cmdShip(args); break;
  case "status": cmdStatus(); break;
  default:
    console.log(`autogit — auto stage→commit→push for agentic engineers

  autogit setup     Wire up agent hooks: Claude Code + Codex (once per machine)
  autogit on        Enable auto-push in this repo
  autogit off       Disable auto-push in this repo
  autogit ship      Stage, scan, commit, push (hooks run this after every turn)
  autogit status    Show hooks + repo state

ship flags:
  -m "message"      Commit message (auto-generated if omitted)
  --force-secrets   Override a secrets-scan block`);
}
