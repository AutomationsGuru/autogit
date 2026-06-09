# AGENTS.md

## What this is

**autogit** — auto **stage → commit → push** for agentic engineers: people who use AI coding agents (Claude Code, Codex, etc.) for everything and don't write code by hand. After every agent turn, the work ships to GitHub automatically.

## MVP scope (current — DECIDED 2026-06-10)

One mode, two switches:

- **auto mode only.** Ship immediately, no review gate. Review modes come later (see Roadmap).
- **Install once, globally**: `autogit setup` wires the user's agents' lifecycle hooks — Claude Code `Stop` hook (`~/.claude/settings.json`), Codex `Stop` hook (`~/.codex/hooks.json`, Codex ≥0.124, needs one-time `/hooks` trust), and a Pi extension (`~/.pi/agent/extensions/autogit.ts`, fires on `agent_end`) — so `autogit ship` runs after every agent turn, in every project.
- **Opt-in per repo**: `autogit on` writes `.autogit.json`. In repos without it, `ship` is a silent no-op (exit 0). The per-repo switch is the safety model for the MVP: only enable it where aggressive auto-push is OK.

## How `ship` works

`git add -A` → secrets scan on added lines (AWS/OpenAI/Anthropic/GitHub/Slack/Google keys, private key blocks, `.env` filenames, JWTs; `--force-secrets` overrides) → commit (uses `-m` if given, else auto-generates a message from changed files) → push to `origin`/current branch.

## Architecture

- Single zero-dependency Node.js CLI: `index.js`, ESM, Node ≥18, npm-distributed.
- Commands: `setup`, `on`, `off`, `ship`, `status`.
- Claude `settings.json` and Codex `hooks.json` share the same hook JSON shape — one `wireStopHook()` helper serves both.
- Codex legacy `notify` is NOT used (single-slot, often taken by other tools, deprecated since hooks landed in 0.124). Hook commands run in the session `cwd`, so `ship` needs no payload parsing.

## Fail-safes

- Per-repo opt-in; silent everywhere else.
- Hooks must never disturb the agent: `ship` exits 0 on every no-op path, and never exits 2 (which would block Claude Code's Stop hook).
- Secrets scan blocks the push and fully unstages (`git reset`).
- Nothing staged → no commit, no push, no noise.

## Roadmap (do not build without owner)

- **agent mode** — an LLM reviews the diff before push. Owner decision 2026-06-09: the *currently-running* agent should review (it has task context), not a separate OpenRouter call. Mechanics TBD.
- **human mode** — terminal y/n prompt on the diff, for production repos. (Existed in the pre-MVP prototype, cut for focus.)
- More agents (Hermes, …) in `setup`. (Pi added 2026-06-10. Hermes needs `post_llm_call` shell hook in `~/.hermes/config.yaml` + reading `cwd` from stdin JSON in `ship` + user consent flow.)
- Branch strategy: currently current-branch push only; auto-branch + PR flow considered.
- ~~Package name~~ — DECIDED 2026-06-10: npm name is **`auto-git`** (checked: free; `autogit` and `autogit-cli` are taken). The installed binary stays `autogit`.

## Ground rules

- Keep it minimal: small files, zero dependencies, simplest thing that works.
- Treat the implementation as a reference of product intent, not fixed architecture.
- Confirm any major structural change with the owner before implementing.
