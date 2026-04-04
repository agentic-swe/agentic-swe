# Defense-in-depth validation

Four layers of validation, each catching a different class of bug. During debugging, knowing which layer should have caught a bug tells you where to add the missing check.

## Layer 1: Entry validation

**Purpose:** Reject bad inputs before any work begins. Catches caller mistakes and malformed data at the boundary.

**What to check:**
- Required fields present and non-null
- Types match expectations (string vs number, array vs object)
- Formats valid (email, URL, date, UUID)
- Values within acceptable ranges (positive, non-empty, bounded length)
- Schema validation for structured input (JSON schema, protobuf, Zod)

**Example:**

```
function createUser(input) {
    assert(input.email, "email is required")
    assert(typeof input.email === "string", "email must be string")
    assert(input.email.includes("@"), "email must contain @")
    assert(input.name.length <= 200, "name too long")
    // ... proceed with valid input
}
```

**Catches:** Null pointer exceptions downstream, type coercion bugs, injection via malformed input.

**Misses:** Logic errors with valid-looking inputs (correct type, wrong value for the business context).

## Layer 2: Business logic validation

**Purpose:** Enforce invariants and state transitions. Catches logic errors where inputs are well-formed but the operation is invalid given current state.

**What to check:**
- State machine transitions are legal (e.g., cannot ship an unconfirmed order)
- Arithmetic invariants hold (totals sum correctly, balances do not go negative)
- Uniqueness constraints (no duplicate keys, no conflicting reservations)
- Referential integrity (the referenced entity exists and is in the right state)

**Example:**

```
function approveExpense(expense, approver) {
    assert(expense.status === "pending", "can only approve pending expenses")
    assert(approver.id !== expense.submitter_id, "cannot self-approve")
    assert(expense.amount <= approver.approval_limit, "exceeds approval authority")
    // ... proceed with approved expense
}
```

**Catches:** Illegal state transitions, violated business rules, data consistency errors.

**Misses:** Infrastructure failures (the database is down, the file is missing).

## Layer 3: Environment checks

**Purpose:** Verify external dependencies are present and functional before relying on them. Catches deployment and configuration issues.

**What to check:**
- Files exist and are readable before opening
- Services are reachable before calling (health check, ping)
- Runtime versions match requirements (Node >= 18, Python >= 3.10)
- Environment variables are set and non-empty
- Disk space, memory, and permissions are sufficient

**Example:**

```
function loadConfig(path) {
    assert(fs.existsSync(path), `config file not found: ${path}`)
    assert(fs.statSync(path).size > 0, `config file is empty: ${path}`)
    const content = fs.readFileSync(path, "utf-8")
    // ... parse and validate content with Layer 1
}
```

**Catches:** "Works on my machine" bugs, missing secrets in CI, version incompatibilities, file permission errors.

**Misses:** Logic errors in correctly-loaded data. Environment checks confirm availability, not correctness.

## Layer 4: Debug assertions

**Purpose:** Guard against "should-never-happen" states. These are not runtime validation — they document assumptions and catch violations during development and testing.

**What to check:**
- Exhaustive switch/match defaults (every enum value handled)
- Post-condition assertions (function output matches contract)
- Invariants that "cannot" be violated if the code is correct
- Unreachable code paths (if reached, a fundamental assumption is broken)

**Example:**

```
function classifyRisk(score) {
    if (score < 30) return "low"
    if (score < 70) return "medium"
    if (score <= 100) return "high"
    // should-never-happen: score outside 0-100 range
    throw new Error(`invariant violation: score ${score} outside [0, 100]`)
}
```

**Catches:** False assumptions about data ranges, missed enum variants after refactoring, impossible states that turn out to be possible.

**Misses:** Nothing specific — these are the last line of defense. If a debug assertion fires, a deeper investigation is needed.

## Which layer to add during debugging

| Symptom | Add checks at |
|---------|---------------|
| Null/undefined crashes | Layer 1 (entry) |
| Wrong business outcome with valid data | Layer 2 (business) |
| "Works locally, fails in CI" | Layer 3 (environment) |
| Impossible state reached | Layer 4 (debug) |
| Not sure | Add at all four layers around the failure point, then remove the ones that don't fire |

When debugging, the first question is not "what is the fix?" but "which layer should have caught this?" If the answer is "none of them," the missing layer is the bug.

## Scope

Consumed by `${CLAUDE_PLUGIN_ROOT}/references/debugging-playbook.md` (defense-in-depth section).

Related: `${CLAUDE_PLUGIN_ROOT}/references/root-cause-tracing.md`, `${CLAUDE_PLUGIN_ROOT}/references/condition-based-waiting.md`
