# /test-runner

Discover and execute the target repository's test suite with structured result reporting.

## Prompt

You are running tests for the target repository. Detect the test framework, execute tests, and return structured results.

Arguments: `$ARGUMENTS`

- If arguments are provided, treat them as a test scope filter (e.g., file path, test name pattern, or directory).
- If no arguments, run the full default test suite.

### Procedure

1. **Detect test framework and command**:
   - Check for framework indicators in order:
     - `package.json` → scripts.test, scripts."test:unit", scripts."test:integration"
     - `Makefile` / `Justfile` → test targets
     - `pyproject.toml` / `setup.cfg` / `pytest.ini` → pytest configuration
     - `go.mod` → `go test ./...`
     - `Cargo.toml` → `cargo test`
     - `Gemfile` → `bundle exec rspec` or `bundle exec rake test`
     - `.github/workflows/*.yml` → extract test commands from CI
   - If multiple test commands exist, prefer the most specific match for the scope requested.

2. **Pre-flight checks**:
   - Verify the test command is available (e.g., `npx jest --version`, `pytest --version`).
   - If dependencies appear uninstalled, report that as a blocker rather than installing them silently.
   - Check for required environment setup (`.env.test`, database fixtures, docker-compose test services).

3. **Execute tests**:
   - Run the detected command with the scope filter applied.
   - If scoped to a specific file or pattern, pass it as an argument to the test runner.
   - Capture both stdout and stderr.
   - Set a reasonable timeout (5 minutes for full suite, 2 minutes for scoped).

4. **Parse results**:
   - Extract: total tests, passed, failed, skipped, errored.
   - For failures: capture test name, assertion message, and file location.
   - Note execution time.

### Output Format

```markdown
# Test Results

## Summary
- **Framework**: <name>
- **Command**: `<exact command run>`
- **Scope**: <full suite | scoped to: X>
- **Status**: PASS | FAIL | ERROR | BLOCKED

## Counts
| Total | Passed | Failed | Skipped | Errored |
|-------|--------|--------|---------|---------|
| ... | ... | ... | ... | ... |

## Failures
<!-- Only if failures exist -->
| Test | Location | Message |
|------|----------|---------|
| ... | ... | ... |

## Execution
- **Duration**: <time>
- **Exit code**: <code>

## Raw Output
<details>
<summary>Full output</summary>

```
<stdout + stderr>
```

</details>
```

### Failure Protocol

- If no test framework is detected, report `BLOCKED` with reason "no test framework found".
- If dependencies are missing, report `BLOCKED` with the missing dependency.
- If tests timeout, report `ERROR` with partial results if available.
- Do not install packages, start services, or modify configuration. Report blockers instead.
