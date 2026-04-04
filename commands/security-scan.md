# /security-scan

Run baseline security checks against the target repository with structured findings.

## Prompt

You are performing a security scan of the repository. Execute available checks and report findings with evidence.

Arguments: `$ARGUMENTS`

- If arguments specify a scope (file path, directory, or "dependencies-only"), limit the scan.
- If no arguments, scan the full repository.

### Procedure

1. **Dependency audit**:
   - Detect package manager and run its audit command:
     - `npm`: `npm audit --json`
     - `yarn`: `yarn audit --json`
     - `pnpm`: `pnpm audit --json`
     - `pip`: `pip-audit` (if available) or check `safety` output
     - `cargo`: `cargo audit` (if available)
     - `go`: `govulncheck ./...` (if available)
     - `bundler`: `bundle audit check`
   - If the audit tool is not installed, note it as unavailable rather than installing.
   - Parse: vulnerability count by severity (critical, high, medium, low), affected packages, fix availability.

2. **Secret scanning**:
   - Search for common secret patterns in tracked files (not in `.git/`):
     - API keys: patterns like `AKIA[0-9A-Z]{16}`, `sk-[a-zA-Z0-9]{48}`, `ghp_[a-zA-Z0-9]{36}`
     - Private keys: `-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----`
     - Connection strings: `postgres://`, `mysql://`, `mongodb://`, `redis://` with credentials
     - Generic high-entropy strings in assignment context (be conservative — flag only high-confidence matches)
   - Check `.gitignore` for common exclusions: `.env`, `*.pem`, `*.key`, `credentials.*`
   - Report missing `.gitignore` entries for sensitive patterns.

3. **Configuration review**:
   - Check for overly permissive CORS, disabled security headers, debug modes left on.
   - Check for hardcoded `0.0.0.0` bindings, disabled TLS verification, `NODE_ENV=development` in production configs.
   - Check Dockerfile (if present) for: running as root, using `latest` tag, copying secrets into image.
   - This is a surface-level scan — flag obvious issues, not deep application logic.

4. **Dangerous patterns in code** (scope to changed files when scoped):
   - `eval()`, `exec()`, `subprocess` with shell=True, `child_process.exec` with unsanitized input
   - SQL string concatenation (vs parameterized queries)
   - `dangerouslySetInnerHTML`, `innerHTML` assignments with dynamic content
   - Deserialization of untrusted data (`pickle.loads`, `yaml.load` without SafeLoader, `JSON.parse` on user input passed to eval)

### Output Format

```markdown
# Security Scan

## Summary
- **Status**: CLEAN | FINDINGS | BLOCKED
- **Scope**: <full repo | scoped to: X>
- **Critical**: <count>
- **High**: <count>
- **Medium**: <count>
- **Low**: <count>

## Dependency Audit
- **Tool**: <command run>
- **Vulnerabilities**: <count>

| Package | Severity | CVE/Advisory | Fix Available | Description |
|---------|----------|-------------|---------------|-------------|
| ... | ... | ... | ... | ... |

## Secret Scan
| Pattern | File | Line | Confidence |
|---------|------|------|------------|
| ... | ... | ... | high/medium |

### Missing .gitignore Entries
- <pattern that should be ignored>

## Configuration Issues
| File | Issue | Severity |
|------|-------|----------|
| ... | ... | ... |

## Dangerous Code Patterns
| File | Line | Pattern | Risk |
|------|------|---------|------|
| ... | ... | ... | ... |

## Recommendations
- <prioritized list of actions>
```

### Failure Protocol

- If no package manager is detected, skip dependency audit and note it.
- If audit tools are not installed, report them as unavailable — do not install them.
- Be conservative with secret detection — false positives erode trust. Only flag high-confidence matches.
- Do not modify any files. Report findings only.
- Apply `${CLAUDE_PLUGIN_ROOT}/templates/evidence-standard.md` to all findings.
