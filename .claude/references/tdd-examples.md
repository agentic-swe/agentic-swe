# TDD examples

Concrete patterns showing the difference between disciplined TDD and common shortcuts. Pseudocode is language-agnostic — adapt to the repo's actual stack.

## Tests-after vs tests-first (epistemic difference)

### Tests-after (weak)

```
# 1. Write the function
def calculate_discount(price, tier):
    if tier == "gold":
        return price * 0.8
    return price

# 2. Write a test that mirrors what you just wrote
def test_discount():
    assert calculate_discount(100, "gold") == 80
    assert calculate_discount(100, "silver") == 100
```

The test only proves the code matches itself. If the requirement was "gold gets 25% off," this test would pass while the code is wrong. Nobody catches it because both were written from the same mental model.

### Tests-first (strong)

```
# 1. Write the test from the REQUIREMENT, not from code
def test_gold_tier_gets_20_percent_discount():
    assert calculate_discount(100, "gold") == 80

# 2. Run it — it fails (function doesn't exist yet). Record the error.
# ERROR: NameError: name 'calculate_discount' is not defined

# 3. Write minimum code to pass
def calculate_discount(price, tier):
    if tier == "gold":
        return price * 0.8
    return price

# 4. Run test — passes. Record output.
# 5. Next behavior: unknown tier raises ValueError — write that test first.
```

The test is anchored to the requirement. The failing step proves the test is actually checking something new.

## What a proper red step looks like

A valid red step:

```
$ pytest tests/test_discount.py::test_gold_tier -v
FAILED test_gold_tier - NameError: name 'calculate_discount' is not defined
```

The failure message tells you the test is wired correctly and the behavior genuinely doesn't exist yet.

An **invalid** red step:

```
# "I wrote the test and the implementation at the same time,
#  but I know it would have failed"
```

This is narration, not evidence. The red step must be **executed and recorded**.

## Green-first shortcut (what to avoid)

```
# Agent writes implementation
def parse_config(path):
    with open(path) as f:
        return json.load(f)

# Agent writes test afterward
def test_parse_config(tmp_path):
    p = tmp_path / "config.json"
    p.write_text('{"key": "value"}')
    assert parse_config(str(p)) == {"key": "value"}
```

This test will never fail. It was designed to match the code, not to specify behavior. Missing: what happens with invalid JSON? Missing file? Empty file? The green-first shortcut skips these because the agent never had to think about failure modes.

## When to delete code written before tests

If you realize you wrote production code before a test:

1. **Stash or revert** the production code.
2. Write the test. Run it. Confirm it fails for the right reason.
3. **Reapply** the production code (or rewrite from the stash).
4. Run the test. Confirm it passes.

This recovers the epistemic value. The key: you must see the test fail against absence of the code, not just pass with the code present.

## Example: fixing a bug with TDD vs without

**Bug**: `format_name("", "Smith")` returns `" Smith"` (leading space) instead of `"Smith"`.

### Without TDD

```
# Agent reads the bug report, finds the function, adds a strip()
def format_name(first, last):
    return f"{first} {last}".strip()

# Agent writes test
def test_empty_first_name():
    assert format_name("", "Smith") == "Smith"   # passes
```

Looks fine. But `.strip()` also hides bugs with trailing spaces in `last`. And what about `format_name("", "")` — should that return `""` or raise? The agent never thought about it because the test was written to confirm, not to specify.

### With TDD

```
# 1. Red: specify the exact expected behavior
def test_empty_first_name_returns_last_only():
    assert format_name("", "Smith") == "Smith"

def test_both_empty_returns_empty():
    assert format_name("", "") == ""

def test_whitespace_first_name_treated_as_empty():
    assert format_name("   ", "Smith") == "Smith"

# 2. Run — all three fail (current code returns " Smith", " ", "    Smith")
# 3. Green: fix with intent
def format_name(first, last):
    parts = [p for p in [first.strip(), last.strip()] if p]
    return " ".join(parts)

# 4. Run — all pass
# 5. Refactor — already clean, no changes needed
```

The TDD version forced the agent to think about three edge cases before writing a single line of fix.

## Summary

| Aspect | Tests-after | Tests-first |
|--------|-------------|-------------|
| Proves | Code matches itself | Code matches requirement |
| Edge cases | Discovered in production | Discovered during red step |
| Failing evidence | None | Recorded in artifact |
| Rework cost | High (bugs found late) | Low (bugs found immediately) |

Related: `.claude/references/tdd-discipline.md`, `.claude/references/testing-anti-patterns.md`
