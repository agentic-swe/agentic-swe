# Plugin privacy (agentic-swe)

This page describes how the **agentic-swe** Claude Code plugin relates to personal data and third-party services. It is provided for transparency (for example, when listing the plugin in a public directory). **It is not legal advice.**

## What agentic-swe is

**agentic-swe** is an open-source **markdown workflow pack** (commands, phases, agents, templates, hooks, and related files) that runs **inside [Claude Code](https://docs.anthropic.com/en/docs/claude-code)** on **your machine** in **your** git projects. There is **no separate cloud service or backend** operated by this project that receives your code or conversations.

## Data processing when you use Claude Code

When you use Claude Code with this plugin enabled, **Anthropic** processes prompts, tool use, and model outputs according to **your Claude / Anthropic plan and product terms**. That processing is governed by **Anthropic’s policies**, not by this repository. See Anthropic’s legal pages for details, for example:

- [Anthropic — Legal](https://www.anthropic.com/legal)

The plugin does **not** add its own telemetry product beyond what the host (Claude Code) already does.

## Source code and hosting

The **source repository** is hosted on **GitHub** (`surajSFDC/agentic-swe`). Access to the repo, stars, issues, and your GitHub account are subject to **GitHub’s** privacy practices:

- [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement)

## Files the plugin may write locally

The pipeline stores **per-work state** under **`.worklogs/<id>/`** in **your** project (and may suggest **`.gitignore`** entries). That data stays on your device unless **you** commit it to git or copy it elsewhere. **You** control what is shared.

## Hooks

Optional **session hooks** (for example under **`hooks/`**) run in **your** environment as configured by Claude Code. Review the hook definitions in the repository if you need to know exactly what runs on your system.

## Changes to this page

This document may be updated as the project or listing requirements change. The current version is published at **`/docs/privacy`** on the [project site](https://surajSFDC.github.io/agentic-swe/docs/privacy).

## Contact

Questions about **this open-source project** are best handled via [GitHub issues](https://github.com/surajSFDC/agentic-swe/issues). For **Claude Code or Anthropic accounts**, use Anthropic’s support channels.

---

**Disclaimer:** This summary is for convenience only and may not cover every jurisdiction or use case. For compliance questions, consult a qualified professional.
