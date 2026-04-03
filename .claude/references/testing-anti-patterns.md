# Testing anti-patterns

Catalog of common testing pitfalls. Each pattern includes a gate question that reviewers and self-review checklists can use to catch the problem before it ships.

## 1. Mock abuse

**Description**: Mocking a dependency without understanding its real interface or contract. The mock becomes a fiction that the test validates against, proving nothing about real behavior.

**Gate question**: "Can I describe the real dependency's error modes and edge-case responses without looking at docs?" If no, the mock is speculative.

**Remedy**: Read the real interface first. Mock only I/O boundaries (network, filesystem, clock). For internal logic, use the real implementation. If the real dependency is too slow, extract a thin adapter and mock that.

## 2. Test-only production methods

**Description**: Adding public methods, accessors, or flags to production code solely to make a test assertion possible. These pollute the API surface and create maintenance burden.

**Gate question**: "Would this method exist if the test didn't need it?" If no, the test is testing internals, not behavior.

**Remedy**: Test through the public interface. If the assertion requires internal state, the design needs a better boundary — not a backdoor.

## 3. Incomplete mocks that silently pass

**Description**: A mock that returns a canned success response for every call. The test passes, but any deviation from the happy path (errors, timeouts, partial responses, unexpected shapes) is invisible.

**Gate question**: "Does this mock cover at least one error case and one edge case?" If no, it's a happy-path mirror.

**Remedy**: Every mock must model at minimum: one success, one expected error, and one boundary value (empty collection, null field, maximum size). Use parameterized tests to cover these.

## 4. Integration-as-afterthought

**Description**: Writing only unit tests during development and planning to "add integration tests later." Later never comes, or the integration tests are bolted on without verifying the actual component boundaries.

**Gate question**: "Does any test in this change exercise a real component boundary (DB, API, service call)?" If no, and the change involves boundaries, integration coverage is missing.

**Remedy**: Include at least one integration-level test per component boundary touched. It can be a narrow integration test — it doesn't have to spin up the full system.

## 5. Over-testing implementation details

**Description**: Tests that assert on internal method calls, private state, call order, or specific log messages rather than observable behavior. These tests break on every refactor without catching real bugs.

**Gate question**: "Would this test break if I refactored internals without changing external behavior?" If yes, it's testing implementation, not behavior.

**Remedy**: Assert on outputs, side effects, and observable state changes. If you need to verify a call was made, test the effect of that call (e.g., data was written) rather than the call itself.

## 6. Flaky test tolerance

**Description**: Accepting tests that intermittently fail as "known flaky" and ignoring their results. Flaky tests erode trust in the entire suite and mask real failures.

**Gate question**: "Has this test failed in the last 5 runs without a code change?" If yes, it's flaky and must be fixed or quarantined — not ignored.

**Remedy**: Fix the root cause (race condition, time dependency, shared state, network call). If unfixable quickly, quarantine the test in a separate suite with a tracking issue. Never mark flaky tests as expected-fail in the main suite.

## Quick-reference checklist

Use during self-review and code-review phases:

- [ ] No mocks for dependencies I haven't read the interface of
- [ ] No production methods that exist solely for test access
- [ ] Every mock covers at least one error path
- [ ] Integration boundaries are tested, not just units
- [ ] Tests assert on behavior, not implementation details
- [ ] No known-flaky tests in the change

Related: `.claude/references/tdd-discipline.md`, `.claude/references/tdd-examples.md`
