# Demo script (about 2–3 minutes)

Use with **[Golden path](https://agentic-swe.github.io/agentic-swe/docs/golden-path)**. Adjust wording for your audience (team chat, conference, social). This is also the clip script for the launch demo in `docs/launch-week-1.md`.

## 0:00–0:20 — Problem

> “Agent chats are free-form. I want **phased software engineering**: feasibility, implementation, validation, PR — with **saved state**, **gates** so nobody merges by accident, and a **receipt** of what the AI decided.”

## 0:20–0:45 — Install

In the target repo (the git root), run:

```bash
curl -fsSL https://raw.githubusercontent.com/agentic-swe/agentic-swe/main/install.sh | bash
agentic-swe setup
```

`setup` shows the planned changes and asks before writing. Claude Code users can use the plugin instead:

```text
/plugin marketplace add agentic-swe/agentic-swe
/plugin install agentic-swe@agentic-swe-catalog
```

## 0:45–1:30 — One command

```text
/work Fix countItems in src/counter.js so npm test passes; show .worklogs when done
```

Narrate briefly: `lean-track-check` picks the track (lean is the default from 3.4.0); watch **`progress.md`** or the transcript.

## 1:30–2:10 — Evidence

Open **`.worklogs/<id>/`**:

- **`state.json`** — where you are in the machine.
- **`progress.md`** — human-readable trail.
- Stop at **`approval-wait`** — emphasize you still review the PR.

## 2:10–2:35 — Receipt

After you approve and the item reaches `completed`:

```text
/receipt
```

Show the rendered markdown: decisions, cost per transition, the human gate you resolved. Say it is computed from `.worklogs/`, not written by the model.

## 2:35–2:45 — CTA

> “Everything is markdown in the pack; the runtime is your IDE + repo. Start at the golden path doc.”

Link: `https://agentic-swe.github.io/agentic-swe/docs/golden-path`
