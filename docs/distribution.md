# Distribution model

How the package and documentation reach users, and how that relates to **source hosting** (e.g. GitHub).

## Channels

| Channel | Role |
|---------|------|
| **[npm](https://www.npmjs.com/package/agentic-swe)** | Install the CLI and pipeline files into a project (`npx agentic-swe`, `npm install -g agentic-swe`) |
| **Source hosting** | Development, issues, and contributions—separate from installing the published package |
| **Marketing / docs site** | Landing page and markdown docs (e.g. CloudFront); links to npm for install |

A **private** source repo and a **public** npm package can coexist; discovery is typically npm plus your site.

## Marketing and documentation site

- **S3 + CloudFront** — This repo can deploy the static content under `docs/` (including `index.html`) with [infra/deploy-static-site.sh](../infra/deploy-static-site.sh). See [infra/README.md](../infra/README.md) for env setup and custom-domain notes.  
- **GitHub Pages (free)** — Works well with a **public** repo. For a **private** repo on a free GitHub plan, Pages behavior may be limited; do not rely on `*.github.io` as the only brochure if you need private code + public marketing without upgrading GitHub.  
- **Custom domain** — Point DNS at CloudFront (or Pages) for a professional URL; HTTPS via ACM where applicable.

**Separation:** You can keep **source** private while serving a **public** landing page from AWS (or a paid host with password protection if you need a semi-private demo).

## What gets deployed

The deploy script syncs **`docs/`** to S3. That includes the landing page and these markdown files if you want them linked from the site (today the main entry is `docs/index.html`).

## Alignment with product

- README and the public site describe install via **npm** and link to the [installation guide](installation.md).  
- **Private repo + public npm** is a common setup.

Update the hero CTAs on [index.html](index.html) if your distribution model changes.
