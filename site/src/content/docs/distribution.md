# Distribution model

How users get **agentic-swe**, and how that relates to **source hosting** (e.g. GitHub).

## Channels

| Channel | Role |
|---------|------|
| **Claude Code plugin marketplace** | **Primary.** Git-hosted catalog ([`.claude-plugin/marketplace.json`](../../.claude-plugin/marketplace.json)); users add the repo then **`/plugin install`** — see [claude-code-plugin.md](claude-code-plugin.md) |
| **Source hosting** | Development, issues, contributions, and **`claude --plugin-dir`** local dev |
| **Marketing / docs site** | Landing page and markdown docs (**[GitHub Pages](https://surajSFDC.github.io/agentic-swe/)** canonical, CloudFront mirror); describes plugin install |

## Marketing and documentation site

- **GitHub Pages (canonical public URL)** — [`.github/workflows/pages.yml`](../../.github/workflows/pages.yml): on push to **`main`**, build with **`VITE_BASE=/<repo>/`** and publish **`site/dist/`**. **Settings → Pages → Source: GitHub Actions**. Example: **`https://surajSFDC.github.io/agentic-swe/`** (adjust for forks). README and **`package.json` `homepage`** point here first; CloudFront stays a mirror.
- **S3 + CloudFront (mirror)** — Deploy **`site/dist/`** with [infra/deploy-static-site.sh](../../infra/deploy-static-site.sh). See [infra/README.md](../../infra/README.md).
- **Custom domain** — Point DNS at CloudFront (or Pages); HTTPS via ACM where applicable.

## What gets deployed

The deploy script runs **`npm run build:site`** (Vite app in `site/`) then syncs **`site/dist/`** to S3. Documentation pages are bundled from **`site/src/content/docs/*.md`** into the app (routes under **`/docs/*`**).

## Alignment with product

- README and the public site describe install via the **Claude Code plugin** and link to the [installation](installation.md) doc.
- Hero CTAs in **`site/src/`** should point users at **plugin marketplace** flows only.

## Release verification (maintainers)

Automated stub tests and manual per-host smoke before tags are on the [Release checklist](release-checklist.md) page.
