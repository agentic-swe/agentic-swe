# /repo-scan

Produce a structured snapshot of the target repository for rapid task analysis.

## Prompt

You are scanning the repository to produce a structured overview. This is a read-only operation — do not modify any files.

### Procedure

1. **Language and framework detection**:
   - Inspect root-level config files: `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `Gemfile`, `pom.xml`, `build.gradle`, `Makefile`, `CMakeLists.txt`, etc.
   - Identify primary language(s), framework(s), and package manager(s).
   - Note language version constraints if declared.

2. **Project structure**:
   - List top-level directories with a one-line purpose for each.
   - Identify source roots (e.g., `src/`, `lib/`, `app/`), test roots (e.g., `tests/`, `__tests__/`, `spec/`), and config roots.
   - Note monorepo indicators (workspaces, Lerna, Nx, Turborepo).

3. **Test infrastructure**:
   - Identify test framework(s): jest, pytest, go test, cargo test, rspec, junit, etc.
   - Locate test config files (e.g., `jest.config.*`, `pytest.ini`, `conftest.py`, `.mocharc.*`).
   - Note test commands from `package.json` scripts, `Makefile` targets, or CI config.
   - Report approximate test file count.

4. **CI/CD configuration**:
   - Check for: `.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`, `.circleci/`, `buildkite/`, `.travis.yml`, `azure-pipelines.yml`.
   - Summarize what CI runs: build, test, lint, typecheck, deploy, etc.
   - Note required checks or branch protection indicators.

5. **Linting and formatting**:
   - Identify linter configs: `.eslintrc*`, `ruff.toml`, `.golangci.yml`, `.rubocop.yml`, `biome.json`, `.prettierrc*`, etc.
   - Note lint/format commands from scripts or CI.

6. **Entry points and exports**:
   - Identify main entry points: `main.*`, `index.*`, `app.*`, `server.*`, CLI entry points.
   - Note public API surface if applicable (exports, `__init__.py`, barrel files).

7. **Dependencies overview**:
   - Count direct vs dev dependencies.
   - Flag notable dependencies (ORMs, HTTP frameworks, auth libraries, cloud SDKs).
   - Note lockfile presence and type.

### Output Format

Write output as structured markdown:

```markdown
# Repository Scan

## Identity
- **Languages**: <list>
- **Frameworks**: <list>
- **Package manager**: <name> (lockfile: yes/no)

## Structure
| Directory | Purpose |
|-----------|---------|
| ... | ... |

- **Source root(s)**: <paths>
- **Test root(s)**: <paths>
- **Monorepo**: yes/no (tool: <if applicable>)

## Test Infrastructure
- **Framework(s)**: <list>
- **Config**: <files>
- **Run command**: <command>
- **Approximate test count**: <number>

## CI/CD
- **Platform**: <name>
- **Pipelines**: <summary of what runs>
- **Required checks**: <list or "none detected">

## Linting & Formatting
- **Linter(s)**: <list with config files>
- **Formatter(s)**: <list with config files>
- **Run command**: <command>

## Entry Points
- <path>: <description>

## Notable Dependencies
- <name>: <purpose>

## Observations
- <anything unusual, missing, or noteworthy>
```

### Failure Protocol

- If the repository is empty or has no recognizable structure, report that fact.
- Do not guess framework details — report only what config files and code confirm.
- If a section has no findings, write "None detected" rather than omitting it.
