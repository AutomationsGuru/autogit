# autogit

<!-- Short-form README kept focused on the MVP flow. -->

Your AI coding agent writes the code. **autogit ships it.**

When your agent finishes a turn, autogit stages, commits, and pushes — automatically.

## Quick start

```bash
# 1. Install (once per machine)
npm install -g @davidondrej/autogit
autogit setup

# 2. Enable it per repo
cd your-project
autogit on
```

Done. Every agent turn now ends with: **stage → secrets scan → commit → push.**

> Not on npm yet? From source: `git clone https://github.com/davidondrej/autogit && cd autogit && npm link`

## Supported agents

| Agent | After `autogit setup` |
| --- | --- |
| **Claude Code** | works immediately |
| **Cursor** | works immediately — local + worktree agents (cloud agents don't fire stop hooks yet) |
| **Pi** | works immediately |
| **Codex** | one-time approval: open `codex`, run `/hooks`, trust autogit (needs ≥ 0.124) |

## Commands

```
autogit setup     Wire up agent hooks (once per machine)
autogit on        Enable auto-push in this repo
autogit off       Disable auto-push in this repo
autogit ship      Stage, scan, commit, push (what the hooks run)
autogit status    Show hooks + repo state
```

`autogit ship -m "message"` uses your message; without `-m` it writes one from the changed files.

## Safety

- **Opt-in per repo** — repos without `autogit on` are never touched.
- **Secrets scan** — blocks pushes containing API keys, private key blocks, `.env` files, or JWTs, and unstages everything. Override with `--force-secrets`.
- **No noise** — nothing changed means nothing shipped. Aborted or errored Cursor turns never ship.

## Roadmap

- **agent mode** — an LLM reviews the diff before push, for more serious repos.
- **human mode** — terminal y/n prompt on the diff, for production repos.
- More agents (Hermes next).

MIT
