# Development Workflow

## Roles

- **Product Owner:** priorities, live functional UAT, and every approval to merge, deploy or release. Only the Product Owner authorizes a merge to `main` or a production release.
- **ChatGPT (Technical Lead):** issue specifications, acceptance criteria, independent technical review of each pull request, and exact-SHA UAT merge authorization where the Product Owner has delegated it.
- **Claude Code:** implementation on dedicated branches, automated tests, documentation, pull requests, and review responses.

## Branches

- `main` is stable and is gated separately. Nothing reaches it without the Product Owner's explicit approval.
- `claude/ui-ux-refinement` is the protected development/UAT branch. GitHub Pages serves it for UAT. A repository ruleset requires a pull request and a passing `node-tests` check, and blocks force pushes and deletion. Nobody pushes to it directly.
- Each issue gets its own branch, for example `issue-26-final-regression-docs`, created from the current UAT head. The issue names the base branch.

## Route for every change

1. The issue is specified (scope, acceptance criteria, out-of-scope). Specification alone authorizes nothing.
2. The Product Owner authorizes implementation of that issue in a comment.
3. Claude Code confirms the UAT head has not moved, creates the feature branch, and implements only the authorized scope. Anything outside it is stopped and proposed as a separate issue.
4. Claude Code runs `node --test tests/*.test.mjs`, syntax checks and `git diff --check`, pushes only the feature branch, and opens a pull request into the UAT branch.
5. GitHub Actions runs `node-tests` on the pull request head. It must pass on the exact head being merged.
6. Claude Code reports the pull request URL, exact SHA, test counts and a Product Owner UAT checklist, then **stops**.
7. ChatGPT reviews the code, tests and documents independently and records findings in GitHub. Claude Code fixes findings on the same branch and repeats from step 4.
8. A merge into the UAT branch needs an exact-SHA authorization from ChatGPT under the delegation the Product Owner has given for that issue, or the Product Owner's explicit permission. A delegation for one issue does not extend to the next. No ruleset or protection bypass.
9. After the merge, GitHub Pages deploys the UAT branch. Verify the deployment run and the visible version.
10. The Product Owner performs functional UAT on the deployed build and records PASS, FAIL, PARTIAL, DEFERRED or NOT RUN. Passing tests or a successful Pages build never mark a checkpoint accepted.
11. Promotion to `main` and any production release are separate, explicit Product Owner decisions.

Defects found during a test or documentation task are filed as separate bug issues for Product Owner triage and are not fixed quietly inside that pull request.

## Evidence and status vocabulary

Record automated evidence, live Product Owner evidence, deferred items, unverified items and release status separately (see `07_Regression_Coverage_Matrix.md`). `DEFERRED` and `NOT RUN` are never `PASS`. An automated pass never replaces a live check.

## PR readiness report (informational)

`.github/workflows/pr-readiness.yml` adds one check, `pr-readiness`, to every non-draft pull request into the UAT branch (Issue #36). It is informational. It is **not a required check**, not a review, not a merge or release authorization, and not proof that the tests ran. `node-tests` stays the only required check and `tests.yml` is untouched.

**What it does.** It performs `GET` requests only, with a read-only token (`contents`, `pull-requests` and `checks` read), no secret, no checkout of pull request code and no third-party action. It posts no comment, label or status and pushes nothing. It reads the live pull request, the `node-tests` check run on the **authored head** (`github.event.pull_request.head.sha`, the evidence key; `GITHUB_SHA` is a synthetic merge commit and is labelled as such), the changed-file list (paginated) and the live UAT head.

**Verdicts.** `READY` means every one of these was positively verified at the final read: pull request open, reported by GitHub as explicitly not a draft (a missing or non-boolean draft status is `INCONCLUSIVE`), targeting UAT; live head equals the authored head; `node-tests` completed with `success` from the GitHub Actions app (id 15368) on that head; mergeability is `true` (unknown is retried, then `INCONCLUSIVE`); the full changed-file inventory was read and matches a `changed_files` count that GitHub reported as a non-negative integer (null, missing, negative, fractional or string counts are unknown, so `INCONCLUSIVE`); the live UAT head was read. `NOT READY` means a fact failed (closed, draft, wrong base, superseded or changed head, failed or cancelled CI, conflicts). `INCONCLUSIVE` means a required fact could not be established (API error, CI not finished within the 15 minute window, mergeability unknown, incomplete file list). Only `READY` exits successfully. Even a green run prints `CI/metadata checked — HUMAN REVIEW AND PO APPROVAL REQUIRED`: human review and an exact-head Product Owner approval are still required.

**Where to read it.** The job summary in the Actions UI; annotations on the check; and a parseable log line for tools that can only read logs: `PR_READINESS verdict=… pr=… head=… ci=… mergeable=… files=… files_complete=… workflow_files=…`, followed by one `PR_READINESS_REASON kind=… code=…` line per finding. Re-run the job after any UAT change or retarget.

**Advisories.** Workflow files changed (`.github/workflows/`, `.github/actions/`) are flagged prominently: a pull request can edit its own workflows and the required `node-tests` job, so a green `node-tests` alone does not prove the test program ran; review the workflow diff. Supabase, vendored, config, test and other `.github` changes, a fork head and UAT drift are also flagged. None changes the verdict.

**Limits.** The report cannot show who approved anything: the Product Owner, the Technical Lead and Claude Code act as the same GitHub account, and no comment or approval marker is parsed or trusted. It carries no test counts. A pull request can alter this workflow, so the output is advisory. A pull request retargeted away from UAT keeps an older result on its head commit; re-read the base before merging.

**Rollback.** The check is not in the ruleset, so removing it never needs a ruleset change: disable the workflow in the Actions settings for an immediate stop, or revert the pull request that added `pr-readiness.yml` and `tests/workflowPolicy.test.mjs`. If it is ever made required, remove it from the ruleset first. `tests/workflowPolicy.test.mjs` fails if anyone adds a write scope, a secret, a checkout, an action, a privileged trigger or an unsafe expression to the workflow.

## Database-backed work

Keep schema changes reproducible in source-controlled migrations. Apply and verify an additive migration and its RLS/security behavior before deploying frontend code that depends on it. Reserve manual Supabase actions for settings unsuitable for repository storage, such as account/auth project configuration, secrets, SMTP/provider credentials, and privileged administration; document those steps before deployment. A Supabase schema, RLS or Auth configuration change always needs its own explicit authorization.

## Updating a runtime dependency

Third-party browser code changes only through a reviewed pull request. Never point the application at a floating version (`@2`, `@5`, `latest`) and never edit a vendored file by hand.

1. Read the release notes and security advisories for the exact new version, and check `npm view <package>@<version> dist.integrity` against a tarball you download yourself.
2. Vendored file (Supabase, SheetJS): take the file from the npm tarball (or the vendor's official URL), store it under `vendor/<name>/` with the version in its file name, update that directory's `README.md` and `LICENSE.txt`, and record the new sha256, the sha384 `integrity` value and the size.
3. CDN script (Tesseract.js entry): change the exact version in `index.html` and compute the sha384 `integrity` value from the downloaded bytes. For Tesseract, also move `OCR_ASSET_PATHS` in `services/ocrService.js` (worker, core, language data) to the matching release and re-download and hash each file.
4. Update `vendor/dependency-manifest.json` (version, URL or file, sizes, sha256, sri, license) and the `integrity` attributes in `index.html`. The audit allows an external URL only if it is written out in full in the manifest (or is one of the three exact `ocrAssetPaths` strings, or `supabaseProjectUrl`), so a new Tesseract file or a different Supabase project needs a manifest entry. The manifest drives the audit, but `tests/dependencyIntegrity.test.mjs` also keeps reviewed constants of its own as deliberate baselines (the exact version, size, sha256 and SRI asserted in DEP-2, DEP-3 and DEP-5, the pinned OCR URLs, and the single expected external script). Update those expected values in the same pull request, and say so in it; a failing DEP test after a version change means they were not updated.
5. Run the full suite, then load the app from a static server under a `/FSresibo/`-style sub-path and check: the console shows no integrity, CORS or MIME error; sign-in page; for Tesseract, an OCR scan of a non-sensitive sample and the request list. Say plainly which of these were not run.
6. Rollback is a revert of that pull request (the previous vendored file or pinned URL and its recorded hashes return together).

## New AI sessions

- Read `/docs` and the issue, including every authorization comment.
- Summarize understanding and confirm the base head before coding.
- Treat the repository and GitHub history as the source of truth, not conversation memory.

## History

The earlier workflow, kept for history, was: discuss, update docs, have Codex inspect the repository, approve the plan, test on Synology, commit, push and verify deployment. Pull requests with CI, the protected UAT branch and the Claude Code / ChatGPT roles were established by Issues #17, #18 and #20 and replaced direct pushes to the UAT branch.
