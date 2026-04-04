# Release checklist (maintainers)

Use before tagging a release or after changing **`hooks/`**, **`.cursor-plugin/`**, **`.opencode/`**, **`GEMINI.md`**, **`.codex/`**, or **`package.json` `files`**.

## Automated (CI / local)

Run from repo root (after **`npm ci`** at root, **`npm ci --prefix site`**, and **`npm ci --prefix tools/brainstorm-server`** — same as **GitHub Actions**):

```bash
npm run verify
npm run version:check
npm run lint --prefix site
npm run build --prefix site
npm test
```

Or the single aggregate (expects site **`node_modules`** already installed):

```bash
npm run ci
```

When the **Claude CLI** is on **`PATH`**, the same suite also runs **`claude plugin validate`** inside **`test/install-platform-stubs.test.js`** (skipped automatically if `claude` is missing — e.g. some CI images).

`npm test` includes **`test/install-platform-stubs.test.js`**, which automates **per-platform wiring** (not host UI):

| Area | What the tests assert |
|------|------------------------|
| **Claude Code** | **`plugin.json` / `marketplace.json` / `package.json`** versions match; **`hooks/hooks.json`** SessionStart targets **`hooks/session-start`**; **`CLAUDE.md`** + **`references/session-routing-hint.md`** exist; **`claude plugin validate`** when CLI available |
| **Cursor** | **`.cursor-plugin/plugin.json`** paths, version vs **`package.json`**, **`commands/`** / **`agents/`** contain markdown; every **`hooks-cursor.json`** hook resolves a real script |
| **Gemini** | **`gemini-extension.json`** version + **`GEMINI.md`** content signals |
| **Codex** | **`.codex/INSTALL.md`** mentions **AGENTS** / **CLAUDE**; **`AGENTS.md`** present |
| **OpenCode** | **`.opencode/INSTALL.md`**, **`node --check`** on the plugin, **dynamic `import()`** of **`config`** + **`experimental.chat.messages.transform`** and resolved **`paths`** |
| **Packaging** | **`package.json` `files[]`** includes each host bundle path |

These checks **do not** open Cursor, Codex, OpenCode, or Gemini — use **Manual smoke** below for real host runtime.

## Manual smoke (host runtime)

GitHub-hosted CI cannot install Cursor, Codex, OpenCode, or Gemini for you. Use a **scratch target repo** (small app or empty git project) and this pack as submodule, **`claude --plugin-dir`**, or copy/symlink per platform docs.

| Platform | Minimal check | Pass criteria |
|----------|----------------|---------------|
| **Claude Code** | Marketplace or `--plugin-dir`; **`/install`** in target; trivial **`/work`** | Slash commands visible; **`CLAUDE.md`** merge / **`.worklogs/`** as expected |
| **Cursor** | Install/configure **`.cursor-plugin/`** per current Cursor docs; open target project | Plugin or session hook loads; commands/agents discoverable per UI |
| **Codex** | [`.codex/INSTALL.md`](../../.codex/INSTALL.md): **`AGENTS.md`**, merged **`CLAUDE.md`**, pack paths | Assistant follows orchestration / cites policy |
| **OpenCode** | [`.opencode/INSTALL.md`](../../.opencode/INSTALL.md) + [OpenCode](README.opencode.md) | First turn includes Hypervisor / injected policy |
| **Gemini CLI** | `gemini extensions install` from repo root (per current Gemini docs) | Extension loads; **`GEMINI.md`** context in session |

## Record verification (optional but recommended)

After the **automated** bar passes and you have run **any** manual smoke you care about for this cut:

1. Note **`git rev-parse --short HEAD`** (or the **tag** you are shipping, e.g. **`v3.0.0`**).
2. Use **UTC** for the date (`date -u +%Y-%m-%d` or equivalent).
3. Record **who** ran the checks (initials or handle).
4. Mark **✓** only for hosts you actually exercised; use **—** for not run this cycle.
5. In **Notes**, put **app versions** (Cursor build, Claude Code / desktop version, Gemini CLI version, etc.) and optionally a link to the **release PR**, **GitHub Release**, or **CI run**.
6. Spot-check the **public docs site** once per release (e.g. open [Installation](installation.md) and one other `/docs/*` page on **GitHub Pages** and, if you still use it, the **CloudFront** mirror) — mark **✓** under **Public docs** when done.

**Where to keep this row:** paste into the **release PR** description, the **GitHub Release** body, a **tag annotation** (`git tag -a …`), or your team’s internal runbook — whichever you use for audit trail.

| Date (UTC) | Commit / tag | Verifier | Public docs | Claude Code | Cursor | Codex | OpenCode | Gemini | Notes |
|------------|--------------|----------|-------------|-------------|--------|-------|----------|--------|-------|
| _YYYY-MM-DD_ | _abc1234 or vX.Y.Z_ | _name_ | ✓/— | ✓/— | ✓/— | ✓/— | ✓/— | ✓/— | _PR #…, host versions, mirror URL if checked_ |

Keep one row per **release** (or per **candidate SHA** if you verify before tagging). Link out for long prose instead of growing the table.
