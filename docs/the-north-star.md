---

## **The North Star**
**Every Claude, Cursor, and IDE agent user must be able to automate complex workflows with granular cost control and verifiable output quality.**

To achieve this, the following gaps must be closed across four strategic pillars.

---

### **1. Universal Integration & Protocol (The "Any IDE" Pillar)**
* **Unified Runtime:** Currently, the "story" is fragmented across Claude Code, Cursor, and others. We lack a **single-command experience** that runs the same pipeline identically on any surface.
* **The Protocol Gap:** There is no stable **JSON/API contract** (e.g., `start_work`, `attach_evidence`) that agents can call without re-implementing chat logic.
* **Native Extensions:** We lack first-class IDE extensions (VS Code/JetBrains) to drive the state machine and automate `.worklogs/` without manual user discipline.
* **Hook Fragmentation:** No cross-validated hook package exists; hooks currently differ by host (Claude vs. Cursor).

### **2. Enforcement, Harness, & Trust**
* **Hard State Machines:** Transitions are currently "policy" (written in markdown) rather than **enforced code**. Sessions can drift from `CLAUDE.md` without technical failure.
* **Mandatory Gatekeeping:** Approvals are file-based and informal. We need **attested steps** (identity-stamped, non-repudiable clicks) for human-in-the-loop triggers.
* **Execution Sandboxing:** No "one-command" headless runner or standard container (VM) to clone, test, and PR independently of a user’s local machine.
* **Environment Matrices:** No native support for multi-version validation (e.g., testing on Node 20 vs. 22) within the orchestration layer.

### **3. Cost & Quality Optimization**
* **Global Cost Modeling:** Budget fields in `state.json` are cosmetic; they aren't wired to real-time API spend or aggregate team limits.
* **Smart Model Routing:** We lack a policy engine that dynamically routes tasks to specific models (Haiku vs. Sonnet vs. GPT-4o) based on phase-specific **cost-vs-quality** trade-offs.
* **Context Compaction:** While we document progress in `progress.md`, there is no automated service for **token-aware retrieval** or summarizing logs to keep context windows lean.
* **Verification Benchmarking:** No standard "Gold Corpus" or eval suite to score pipeline adherence or prevent regression during pack updates.

### **4. Enterprise & Workflow Scalability**
* **Operational Observability:** No privacy-preserving telemetry to track "time-in-phase," rework counts, or failure points across a team’s projects.
* **Beyond "One Task":** Limited support for **Epics**, dependency queues, or two-way sync with Jira/Linear.
* **Automated Triggers:** No native event-driven automation (e.g., "On GitHub label → Open Work Item → Run Validation").
* **Compliance & Security:** No built-in redaction for sensitive data in logs, nor pre-built mappings to SOC2/ISO controls for change management.

### **5. Subagent & Author DX**
* **Heuristic Selection:** Subagent routing is prompt-driven and "vibes-based" rather than data-driven (e.g., "This agent historically succeeds on Rails tasks").
* **Catalog Drift:** With 135+ agents, maintenance is manual. We need automated linting, deduping, and deprecation workflows.
* **Visual Authoring:** No visual state machine editor or "diff-safe" merge tool for pushing upstream pack updates to customer repositories.

---

## **The Path Forward**
To become the default workflow layer for the AI era, the transition must follow this hierarchy:

| Priority | Focus Area | Goal |
| :--- | :--- | :--- |
| **P0** | **Universal Protocol** | Unblock "Any IDE" with a thin adapter layer and stable API. |
| **P1** | **Execution & Cost** | Build the headless runner, cost routing, and token compaction. |
| **P2** | **Proof & Enterprise** | Add gate attestation, telemetry, and Jira/Linear integration. |

**Would you like to move these P0 items into a formal `ROADMAP.md` or prioritize a specific pillar for a deeper technical spec?**
