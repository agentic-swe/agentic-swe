# Demo script (about 2–3 minutes)

Use with **[Golden path](https://surajSFDC.github.io/agentic-swe/docs/golden-path)**. Adjust wording for your audience (team chat, conference, social).

## 0:00–0:20 — Problem

> “Agent chats are free-form. I want **phased software engineering**: feasibility, implementation, validation, PR — with **saved state** and **gates** so nobody merges by accident.”

## 0:20–0:50 — Install

Show Claude Code (or your host) and run:

```text
/plugin marketplace add surajSFDC/agentic-swe
/plugin install agentic-swe@agentic-swe-catalog
```

Then **`/install`** in the target repo if prompted.

## 0:50–1:40 — One command

```text
/work Fix countItems in src/counter.js so npm test passes; show .worklogs when done
```

Narrate briefly: lean vs rigorous is automatic; watch **`progress.md`** or the transcript.

## 1:40–2:30 — Evidence

Open **`.worklogs/<id>/`**:

- **`state.json`** — where you are in the machine.
- **`progress.md`** — human-readable trail.
- Stop at **`approval-wait`** — emphasize you still review the PR.

## 2:30–2:45 — CTA

> “Everything is markdown in the pack; the runtime is your IDE + repo. Start at the golden path doc.”

Link: `https://surajSFDC.github.io/agentic-swe/docs/golden-path`
