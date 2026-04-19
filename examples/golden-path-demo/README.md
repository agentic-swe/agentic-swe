# Golden path demo (scratch target repo)

Minimal project for trying **[Golden path](https://agentic-swe.github.io/agentic-swe-site/docs/golden-path)** in Claude Code (or any host following the same policy). Copy this folder into a new git repository or merge **`src/counter.js`** into your existing app and point **`/work`** at it.

## What is here

| File | Purpose |
| :--- | :--- |
| **`src/counter.js`** | Intentional **off-by-one** — `countItems` returns `arr.length - 1`. Lean-track demo fixes it to `arr.length`. |
| **`DEMO_SCRIPT.md`** | Bullet outline for a **2–3 minute** screen share or social clip. |
| **`package.json`** | Tiny `npm test` that fails until the bug is fixed (optional signal for validation phases). |

## Quick use

```bash
git init
git add .
git commit -m "chore: golden-path-demo scaffold"
```

**Note:** `npm test` is intentionally **red** until `countItems` returns `arr.length` (that is the lean-track fix the agent should make).

Open the folder in **Claude Code** with **agentic-swe** installed, then:

```text
/work Fix countItems in src/counter.js so it returns the correct number of elements; run npm test and keep evidence in .worklogs
```

Do **not** commit **`.worklogs/`** to public forks if your policy forbids it — use a private scratch repo or add **`.worklogs/`** to **`.gitignore`**.

## Public link

This demo ships inside **[agentic-swe](https://github.com/agentic-swe/agentic-swe)** at **`examples/golden-path-demo/`**. Link that path when you post install instructions.
