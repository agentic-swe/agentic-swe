# Publishing & installation channels

This repo ships **one markdown pack** with multiple install surfaces: Claude Code (Git marketplace), optional **npm** tarball (**scoped** package), Cursor local plugins, and other hosts.

## Claude Code — custom Git marketplace

The canonical catalog lives in **`.claude-plugin/marketplace.json`** on **`main`** in **`agentic-swe/agentic-swe`**. Consumers add:

```text
/plugin marketplace add agentic-swe/agentic-swe
/plugin install agentic-swe@agentic-swe-catalog
```

**To publish an update:** merge **`main`**, keep **`package.json`** and marketplace/plugin versions in sync (**`npm run version:bump`** / **`bash scripts/bump-version.sh bump <semver>`**), run **`npm test`**, push. Users refresh the marketplace and reinstall or pin **`agentic-swe@<version>`**.

Optional **git tag** for humans and docs (not required for Git marketplace discovery):

```bash
git tag -a vX.Y.Z -m "agentic-swe vX.Y.Z"
git push origin vX.Y.Z
```

## Claude Code — Anthropic plugin directory (optional)

Listing in Anthropic’s directory is separate from the Git marketplace. Follow current submission guidance: [Plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces) and your Claude Code **Settings → Plugins → Submissions** flow.

## GitHub tool — primary distribution

The public repository is the source for both platform installers:

```bash
curl -fsSL https://raw.githubusercontent.com/agentic-swe/agentic-swe/main/install.sh | bash
```

```powershell
irm https://raw.githubusercontent.com/agentic-swe/agentic-swe/main/install.ps1 | iex
```

The installers download the requested Git ref, install production dependencies under the user's home directory, and create a durable `agentic-swe` command. Publishing requires only merging the verified changes to `main`; it does not require npm credentials. Before merging, run `npm run verify`, `npm test`, and the installer tests.

## npm — `@agentic-swe/agentic-swe` (optional mirror)

**New maintainers — read this first:** [First time on npm: create the scope](#first-time-on-npm-create-the-scope). The **`@agentic-swe`** org must exist on [npmjs.com](https://www.npmjs.com/) before the first **`npm publish`**; otherwise you get **`404 Scope not found`**.

The **unscoped** name **`agentic-swe`** on the public npm registry is **not** this project (different publisher). This pack publishes as:

```bash
npm install -g @agentic-swe/agentic-swe --registry=https://registry.npmjs.org/
```

**Maintainers:** create/use an npm account with publish rights to the **`@agentic-swe`** scope (npm org must match or scope ownership must allow your user).

```bash
npm login --registry=https://registry.npmjs.org/
npm publish --registry=https://registry.npmjs.org/
```

**`prepublishOnly`** runs **`version:check`** + **`verify`** (does not run the full **`npm test`** suite — run **`npm test`** locally before publishing).

### First time on npm: create the scope

A **scope** like **`@agentic-swe`** is backed by an **npm org** (or a user scope). Pushing a scoped package only works if that scope **already exists** and your account may **publish** to it.

1. Log in: [npmjs.com](https://www.npmjs.com/) (same account as **`npm whoami`**).
2. **Create an organization** named **`agentic-swe`** (or use [npm’s org docs](https://docs.npmjs.com/creating-an-organization) if the name is taken — then you would need a different scope and a package rename; see below).
3. Under the org **Members** / **Teams**, grant your user **publish** access (or publish with an automation token scoped to that org, per npm settings).

Until step 2 succeeds, **`npm publish`** fails with:

```text
404 Scope not found — PUT ... /@agentic-swe%2fagentic-swe
```

That is **not** a bug in this repo; the registry had no **`@agentic-swe`** scope yet. After the org exists and your user can publish, **`npm publish`** succeeds.

**If you cannot get the `agentic-swe` org name on npm:** choose another available scope (e.g. tied to your npm username), bump **`package.json`** **`name`** to **`@your-scope/agentic-swe`**, run **`scripts/bump-version.sh`** only if needed (name change does not affect version files), update **`README`** / **`docs/PUBLISHING.md`** install lines, and publish under that scope.

The packed tarball **excludes** **`agents/plugin-runtime/brainstorm-server/node_modules`** (see **`package.json`** **`files`**). Install brainstorm deps when needed: **`npm ci --prefix agents/plugin-runtime/brainstorm-server`**.

After install, **`agentic-swe path`** prints the absolute pack root (same layout as a Git checkout). Use:

```bash
claude --plugin-dir "$(agentic-swe path)"
```

## Cursor — local plugin symlink

**Preferred:** install script clones or symlinks into **`~/.cursor/plugins/local/agentic-swe`**:

```bash
curl -fsSL https://raw.githubusercontent.com/agentic-swe/agentic-swe/main/scripts/install-cursor-plugin.sh | bash
```

**After npm global install**, point the script at the same tree:

```bash
export AGENTIC_SWE_PACK_ROOT="$(agentic-swe path)"
curl -fsSL https://raw.githubusercontent.com/agentic-swe/agentic-swe/main/scripts/install-cursor-plugin.sh | bash
```

See the site doc [Cursor plugin](https://agentic-swe.github.io/agentic-swe-site/docs/cursor-plugin) for **`CLAUDE.md`** merge options.

## Version sync

All of these must match **`package.json`** **`version`**:

- **`.claude-plugin/plugin.json`**
- **`.claude-plugin/marketplace.json`** (`plugins[0].version`)
- **`.cursor-plugin/plugin.json`**
- **`gemini-extension.json`**

Run **`npm run version:check`** after edits.
