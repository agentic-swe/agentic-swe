# /lint

Detect and run the target repository's linter(s) and formatter check(s) with structured result reporting.

## Prompt

You are running lint and format checks for the target repository. Detect the tools, execute them, and return structured results.

Arguments: `$ARGUMENTS`

- If arguments are provided, treat them as a scope filter (e.g., file path, directory, or glob pattern).
- If no arguments, run against the full codebase using the project's default configuration.

### Procedure

1. **Detect linting tools**:
   - Check for tool indicators in order:
     - `package.json` → scripts.lint, scripts."lint:fix", devDependencies (eslint, biome, oxlint)
     - `.eslintrc*`, `eslint.config.*` → ESLint
     - `biome.json`, `biome.jsonc` → Biome
     - `pyproject.toml` [tool.ruff], `ruff.toml` → Ruff
     - `pyproject.toml` [tool.flake8], `.flake8` → Flake8
     - `pyproject.toml` [tool.mypy], `mypy.ini` → mypy (typecheck)
     - `.golangci.yml` → golangci-lint
     - `Cargo.toml` → `cargo clippy`
     - `.rubocop.yml` → RuboCop
     - `Makefile` / `Justfile` → lint targets
   - Collect all applicable tools; run each separately.

2. **Detect formatters** (check mode only):
   - `.prettierrc*`, `prettier.config.*` → `prettier --check`
   - `pyproject.toml` [tool.black], `pyproject.toml` [tool.ruff.format] → `ruff format --check` or `black --check`
   - `rustfmt.toml` → `cargo fmt --check`
   - `gofmt` / `goimports` → check mode
   - `biome.json` → `biome check` (covers both lint and format)

3. **Pre-flight checks**:
   - Verify each tool is available.
   - If a tool is missing, report it as a blocker rather than installing it.

4. **Execute each tool**:
   - Run in check/report mode — do NOT auto-fix.
   - Apply scope filter if provided.
   - Capture stdout and stderr.
   - Set a 3-minute timeout per tool.

5. **Parse results**:
   - For each tool: extract total issues, errors, warnings, fixable count.
   - For each issue: file, line, rule/code, severity, message.
   - Cap detailed issue listing at 50 items; note if truncated.

### Output Format

```markdown
# Lint Results

## Summary
- **Status**: CLEAN | ISSUES | ERROR | BLOCKED
- **Scope**: <full codebase | scoped to: X>

## Tools Run

### <Tool Name>
- **Command**: `<exact command>`
- **Exit code**: <code>
- **Issues**: <count> (<errors> errors, <warnings> warnings)
- **Fixable**: <count>

| File | Line | Rule | Severity | Message |
|------|------|------|----------|---------|
| ... | ... | ... | ... | ... |

<!-- Repeat for each tool -->

## Aggregate
| Tool | Errors | Warnings | Fixable |
|------|--------|----------|---------|
| ... | ... | ... | ... |
| **Total** | ... | ... | ... |
```

### Failure Protocol

- If no linting tool is detected, report `BLOCKED` with reason "no linter configured".
- If a tool is missing or not installed, report `BLOCKED` for that tool and continue with others.
- Do not auto-fix, install packages, or modify configuration. Report findings only.
