# Developer Certificate of Origin

Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.

## What sign-off means here

The `Signed-off-by:` trailer is a **contributor attestation** that you agree to
the DCO 1.1 statements below. It is **not** a cryptographic signature: CI only
checks that a trailer exists and that its email matches the commit author
email. Anyone who can set both can satisfy the check. Do not market DCO
pass/fail as signature verification.

### CI scope (this repository)

- DCO runs on **`pull_request`** events inside the required `test (22)` job
  (`node scripts/dco-check.cjs --require-commits base..head`). An empty range
  (0 non-merge commits checked) **fails closed**.
- **Merge Queue / `merge_group`:** not enabled on `agentic-swe/agentic-swe`
  (ruleset `Protect main — PRs, CI, code owners` has no merge-queue rule;
  verified read-only via the GitHub rulesets API). The workflow may list
  `merge_group` as a future trigger, but the DCO step stays PR-scoped until a
  founder enables the queue and wires SHA ranges deliberately. Do not treat
  merge-queue re-checks as in scope today.

## Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.

Source: https://developercertificate.org/
