# Subagent Auto-Selection Policy

## Mission

Automatically select and spawn specialized subagents during pipeline execution based on evidence from the task, repository, and affected files. Selection is deterministic, evidence-based, and supplementary to core pipeline agents.

This policy is consulted by the orchestrator and by core agents (developer.md, panel agents) at specific points during phase execution. Subagents run in the background and are advisory — the orchestrator or calling agent owns the final decision.

---

## When This Policy Is Consulted

| Phase | Trigger | Who Reads This | Purpose |
|-------|---------|----------------|---------|
| feasibility | After `/repo-scan` completes | Orchestrator | Collect signals, write `## Subagent Signals` into feasibility.md |
| fast-implementation | Before spawning developer.md | Orchestrator | Optionally spawn 1 language specialist (background, non-blocking) |
| implementation | Before spawning developer.md | Orchestrator | Spawn language + domain specialists (background, advisory) |
| design | Before panel invocation | Orchestrator | Spawn domain specialist for pre-design input |
| code-review | After reading artifacts | Orchestrator | Spawn specialized reviewers in parallel |
| (any agent work) | When agent detects domain-specific need | developer.md, panel agents | Agent-to-agent delegation |

---

## Signal Collection (Feasibility Phase)

After `/repo-scan` completes, extract signals from three sources and write them into the feasibility artifact as a `## Subagent Signals` section.

### Source 1: Repo-scan output

- `Languages` field → language specialist candidates
- `Frameworks` / `Dependencies` fields → framework specialist candidates
- `Test frameworks`, `CI/CD`, `Linters` → tooling signals

### Source 2: Task description and feasibility observations

- Domain keywords (security, payments, ML, infrastructure, etc.)
- Affected subsystems and their nature

### Source 3: File paths in scope

- File extensions of files likely to be changed
- Directory patterns (`infra/`, `terraform/`, `k8s/`, `ml/`, `auth/`, etc.)

### Output format

Write into `feasibility.md`:

```markdown
## Subagent Signals

- **Primary language**: <language> (<confidence>)
- **Framework**: <framework> (<confidence>)
- **Domain signals**: <keyword list from task/paths>
- **Recommended subagents**:
  - <agent-name> (<role>: language|framework|domain, <confidence>)
  - <agent-name> (<role>, <confidence>)
- **Subagent mode**: full | minimal
```

Set `subagent mode` to `minimal` if fast-path-check routes to fast path, `full` otherwise.

---

## Selection Rules

### Language Specialist Mapping

| Signal | Subagent | Confidence |
|--------|----------|------------|
| Python (.py), pyproject.toml, setup.py | `python-pro` | high |
| TypeScript (.ts, .tsx), tsconfig.json | `typescript-pro` | high |
| JavaScript (.js, .jsx) without TypeScript | `javascript-pro` | high |
| Rust (.rs), Cargo.toml | `rust-engineer` | high |
| Go (.go), go.mod | `golang-pro` | high |
| Java (.java), pom.xml, build.gradle | `java-architect` | high |
| C++ (.cpp, .cc, .h), CMakeLists.txt | `cpp-pro` | high |
| C# (.cs), *.csproj | `csharp-developer` | high |
| PHP (.php), composer.json | `php-pro` | high |
| Ruby (.rb), Gemfile | `rails-expert` | medium |
| Swift (.swift), Package.swift | `swift-expert` | high |
| Kotlin (.kt), build.gradle.kts | `kotlin-specialist` | high |
| Elixir (.ex, .exs), mix.exs | `elixir-expert` | high |
| SQL (.sql) as primary change surface | `sql-pro` | medium |
| PowerShell (.ps1, .psm1) | `powershell-7-expert` | high |

### Framework Specialist Mapping

| Signal | Subagent | Confidence |
|--------|----------|------------|
| React / react-dom in dependencies | `react-specialist` | high |
| Next.js / next in dependencies | `nextjs-developer` | high |
| Vue / vue in dependencies | `vue-expert` | high |
| Angular / @angular/core | `angular-architect` | high |
| Django in dependencies | `django-developer` | high |
| FastAPI in dependencies | `fastapi-developer` | high |
| Rails in Gemfile | `rails-expert` | high |
| Spring Boot in dependencies | `spring-boot-engineer` | high |
| Laravel in composer.json | `laravel-specialist` | high |
| Flutter / pubspec.yaml | `flutter-expert` | high |
| React Native + Expo | `expo-react-native-expert` | high |
| Electron in dependencies | `electron-pro` | high |
| Symfony in composer.json | `symfony-specialist` | high |
| .NET Core / Microsoft.NET.Sdk | `dotnet-core-expert` | high |
| Svelte / SvelteKit | `svelte-developer` | medium |

### Domain Specialist Mapping

| Signal Pattern (keywords in task, paths, feasibility) | Subagent | When to use |
|-------------------------------------------------------|----------|-------------|
| terraform/, .tf files, "infrastructure as code" | `terraform-engineer` | Infra changes |
| Dockerfile, docker-compose, container | `docker-expert` | Container work |
| k8s/, kubernetes, helm charts | `kubernetes-specialist` | K8s orchestration |
| CI/CD, pipeline, GitHub Actions, Jenkins | `devops-engineer` | Pipeline changes |
| AWS, CloudFormation, CDK | `cloud-architect` | Cloud architecture |
| Azure, Bicep, Entra | `azure-infra-engineer` | Azure infra |
| "security", "auth", RBAC, OAuth, JWT | `security-auditor` | Security-sensitive code |
| "performance", "latency", "throughput" | `performance-engineer` | Performance work |
| "accessibility", "a11y", WCAG | `accessibility-tester` | A11y changes |
| "machine learning", "model training", ML | `ml-engineer` | ML pipeline code |
| "LLM", "prompt", "embedding", "RAG" | `llm-architect` | LLM/AI systems |
| "data pipeline", ETL, "data warehouse" | `data-engineer` | Data infrastructure |
| PostgreSQL specifically | `postgres-pro` | Postgres-specific work |
| "database", "migration", "schema" | `database-administrator` | DB schema changes |
| "API design", "REST", "OpenAPI" | `api-designer` | API surface changes |
| GraphQL schema changes | `graphql-architect` | GraphQL work |
| "microservice", "service mesh" | `microservices-architect` | Service boundaries |
| "WebSocket", "real-time", "streaming" | `websocket-engineer` | Real-time features |
| "blockchain", "smart contract", "web3" | `blockchain-developer` | Web3 work |
| "payment", "stripe", "billing", PCI | `payment-integration` | Payment integration |
| "CLI", "command-line tool" | `cli-developer` | CLI development |
| "refactor", "legacy", "modernize" | `refactoring-specialist` | Large refactors |
| "documentation", "docs site" | `documentation-engineer` | Docs overhaul |
| MCP, "model context protocol" | `mcp-developer` | MCP tool development |
| Game engine, Unity, rendering | `game-developer` | Game development |
| IoT, edge computing, firmware | `iot-engineer` | IoT/embedded work |
| "fintech", financial compliance | `fintech-engineer` | Financial systems |

---

## Composition Rules

### Advisory Mode (implementation, fast-implementation)

Used when subagents provide recommendations alongside the primary developer agent.

1. Orchestrator reads `## Subagent Signals` from feasibility.md
2. Applies mapping rules to select subagent(s)
3. Spawns `developer.md` (primary, foreground)
4. Spawns selected subagent(s) in **background** with advisory prompt:

```
You are being invoked as an advisory specialist during implementation.
Review the design and implementation constraints below. Provide
language/domain-specific recommendations focusing on:
- Idiomatic patterns and conventions for [language/framework]
- Common pitfalls and anti-patterns to avoid
- Performance patterns specific to this stack
- Framework-specific best practices

Return findings as a structured list under these headings:
## Recommendations, ## Pitfalls to Avoid, ## Patterns to Follow

Design context:
[design slice]

Files in scope:
[file list]
```

5. Developer.md proceeds immediately — **not blocked** by subagent
6. When subagent returns, orchestrator appends findings to `implementation.md` under `## Specialist Advisory`
7. If subagent findings conflict with developer output, orchestrator notes the conflict but does NOT automatically re-implement — logs it for code-review consideration

### Parallel Review Mode (code-review)

Used when specialist reviewers run alongside the main code review.

1. Orchestrator reads `## Subagent Signals` from feasibility.md
2. Selects 0-2 review-oriented subagents based on domain signals:
   - Security-sensitive code → `security-auditor`
   - Performance-sensitive code → `performance-engineer`
   - Accessibility changes → `accessibility-tester`
   - Infrastructure changes → `security-engineer`
3. Spawns them in **background** simultaneously with main `/diff-review`
4. Main code-review proceeds normally — specialist reviews do NOT block
5. When specialist returns, findings appended to review artifact under `## Specialist Review Findings`
6. If any specialist finding is severity `high` or `critical`, it is flagged in the main review verdict — but the main review verdict still controls the transition

### Pre-Design Input Mode (design)

Used when domain expertise should inform the design before panel review.

1. Orchestrator reads `## Subagent Signals` from feasibility.md
2. If a domain specialist is indicated with high confidence, spawn it **before** the design panel with a focused prompt:

```
Review the feasibility analysis and provide domain-specific input for
the design. Focus on: architectural constraints, technology choices,
integration patterns, and risks specific to [domain].

Feasibility context:
[feasibility.md content]
```

3. Specialist output is integrated into `design.md` under `## Domain Specialist Input` before panel review begins
4. Panel reviewers see the specialist input alongside the design

### Agent-to-Agent Delegation

Core agents (`developer.md`, panel agents) can spawn subagents themselves when they encounter domain-specific complexity during their work.

**Rules for agent-to-agent delegation:**

1. The calling agent detects a need it cannot handle optimally (e.g., developer hits complex Rust lifetime issues, or encounters unfamiliar framework patterns)
2. The calling agent reads `.claude/phases/subagent-selection.md` mapping tables to identify the right specialist
3. The calling agent spawns the subagent in **background** with a focused, bounded prompt describing the specific problem
4. The calling agent continues its work — does NOT block on the subagent
5. When the subagent returns, the calling agent integrates findings into its own output
6. The calling agent logs the delegation: `action=agent-delegate source=<calling-agent> target=<subagent> note="<specific problem>"`

**Constraints on agent-to-agent delegation:**

- Maximum 1 subagent spawn per calling agent per phase
- Subagent must come from the mapping tables (no ad-hoc selection)
- Calling agent must include the subagent's findings in its output (not silently discard)
- If subagent contradicts the calling agent, both perspectives are reported to the orchestrator

---

## Fast Path vs Full Path

### Fast path (`subagent-mode: minimal`)

- Signal collection happens in feasibility (zero extra cost)
- During fast-implementation: spawn **at most 1** language specialist
  - Only if confidence is `high`
  - Only if the language matches the primary language of changed files
  - Runs in **background** (non-blocking)
  - If fast-implementation finishes before specialist returns, **proceed without waiting**
- No domain specialists on fast path
- No review specialists on fast path (fast path has no separate code-review phase)
- Developer.md can still use agent-to-agent delegation (1 spawn max)

### Full path (`subagent-mode: full`)

- Up to 2 subagents per phase (typically 1 language + 1 domain)
- Implementation: language specialist + domain specialist (both background, advisory)
- Code-review: up to 2 review specialists in parallel with main review
- Design: up to 1 domain specialist as pre-design input (foreground, focused scope)
- Developer.md can use agent-to-agent delegation (1 spawn max)

---

## Budget Constraints

- Subagent spawns count against the iteration budget
- Each subagent spawn adds estimated cost to `cost_used` in state.json
- Model routing from subagent frontmatter determines cost tier (opus > sonnet > haiku)
- **If `budget_remaining` < 3, skip all subagent auto-selection** — preserve budget for core work
- Maximum 2 orchestrator-spawned subagents per phase invocation
- Maximum 1 agent-to-agent delegation per calling agent per phase
- Total subagent spawns tracked in `state.json.counters.subagent_spawns`

---

## Audit Logging

Every auto-selected subagent must be logged in `audit.log`:

```
action=auto-select target=<subagent-path> phase=<phase> signals="<evidence>" confidence=<high|medium> mode=<advisory|review|input>
action=agent-delegate source=<calling-agent> target=<subagent-path> note="<specific problem>"
action=integrate-subagent target=<subagent-path> result=<integrated|conflict|skipped>
action=skip-subagent phase=<phase> reason="<why not selected>"
```

The `skip-subagent` entry is logged only when signals existed but selection was suppressed (budget, confidence threshold, mode constraint).

---

## Override

- Set `state.json.pipeline.subagent_auto_select` to `false` to disable all auto-selection
- The user can also say "skip subagents" or "no subagents" during a `/work` session
- Manual `/subagent invoke` always works regardless of this setting

---

## Conflict Resolution

If a subagent finding contradicts the primary agent or orchestrator:

1. Log the conflict in `audit.log`
2. Include both perspectives in the phase artifact (under `## Specialist Advisory` or `## Specialist Review Findings`)
3. The orchestrator or calling agent (not the subagent) decides which perspective to follow
4. Record the resolution rationale in the artifact

Subagents are advisory. They enhance quality but never override the primary workflow.
