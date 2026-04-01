# Distribution model

## End users (required)

Everyone who **installs** Agentic SWE into a project should use **npm** only: `npx agentic-swe` or `npm install -g agentic-swe`. **Do not** instruct customers to clone a source repository as an install method.

## Source hosting (not an install path)

Source may live on GitHub (or elsewhere) for development and contributions; that is **separate** from product delivery. End-user delivery is the **package on the npm registry**.

| Mode | Role |
|------|------|
| **[npm](https://www.npmjs.com/package/agentic-swe)** | **Only** supported distribution for installing the pipeline into a codebase |
| **Source repo (e.g. GitHub)** | Maintainer/contributor workflow—not how end users install |
| **Marketing site (e.g. CloudFront)** | Docs and landing; still points to **npm** for install |

If the source repo is **private**, npm can still publish the public package; discovery is npm + your site, not “clone from GitHub.”

## Marketing and documentation site

- **S3 + CloudFront** — This repo can deploy the static content under `docs/` (including `index.html`) with [infra/deploy-static-site.sh](../infra/deploy-static-site.sh). See [infra/README.md](../infra/README.md) for bucket, distribution ID, and custom-domain notes.  
- **GitHub Pages (free)** — Works well with a **public** repo. For a **private** repo on a free GitHub plan, Pages behavior may be limited; do not rely on `*.github.io` as the only brochure if you need private code + public marketing without upgrading GitHub.  
- **Custom domain** — Point DNS at CloudFront (or Pages) for a professional URL; HTTPS via ACM where applicable.

**Separation:** You can keep the **code private** while serving a **public** landing page from AWS (or a paid host with password protection if you need a semi-private demo).

## What gets deployed

The deploy script syncs **`docs/`** to S3. That includes the landing page and these markdown files if you want them linked from the site (today the main entry is `docs/index.html`).

## Alignment with product

- README, npm readme, and the public site should **never** present “clone the repo” as the install path for end users.  
- **Private repo + public npm:** Normal; users install from npm only.

Update the hero CTAs on [index.html](index.html) if your distribution model changes.
