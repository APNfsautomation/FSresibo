// Issue #36 (Phase 1): the informational, read-only PR readiness workflow. Two kinds of test live here.
// Policy tests read .github/workflows/pr-readiness.yml as text and fail if anyone adds a write scope, a secret, a checkout, a third-party action, a privileged trigger or an
// unsafe expression. Behaviour tests extract the Node script embedded in that workflow and run it, exactly as the runner does (`node --input-type=module -`), against a local mock of
// the GitHub REST API, so every verdict path is exercised without a network and without a real 15 minute wait. They prove the decision logic and that only GET requests are sent.
// They do NOT prove how the real Actions runner, token or GitHub API behave; that evidence comes from the hosted run of the pull request itself and is reported separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFileSync(path.join(repository, relative), 'utf8').replace(/\r/g, '');
const workflow = read('.github/workflows/pr-readiness.yml');
const testsWorkflow = read('.github/workflows/tests.yml');
const docs = read('docs/03_Development_Workflow.md');

const UAT = 'claude/ui-ux-refinement';
const REPO = 'o/r';
const HEAD = 'a'.repeat(40);
const MOVED_HEAD = 'b'.repeat(40);
const BASE = 'c'.repeat(40);
const UAT_NOW = 'd'.repeat(40);
const BANNER = 'CI/metadata checked — HUMAN REVIEW AND PO APPROVAL REQUIRED';

function embeddedScript() {
  const lines = workflow.split('\n');
  const start = lines.findIndex(line => line.trim() === "node --input-type=module - <<'NODE'");
  assert.ok(start > 0, 'the workflow runs the embedded script through node and a quoted heredoc');
  const end = lines.findIndex((line, index) => index > start && line.trim() === 'NODE');
  assert.ok(end > start, 'the heredoc is closed');
  return lines.slice(start + 1, end).map(line => line.slice(10)).join('\n') + '\n';
}
const script = embeddedScript();
const nonComment = text => text.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');

// ---------------------------------------------------------------- policy tests (static)

test('WFP-1: the only trigger is pull_request into the UAT branch, with the authorized activity types', () => {
  const block = workflow.match(/^on:\n((?: {2}.*\n|\n(?= {2}))+)/m)[1];
  assert.deepEqual(block.split('\n').filter(line => /^ {2}\S/.test(line)).map(line => line.trim()), ['pull_request:']);
  assert.equal(block, '  pull_request:\n    branches:\n      - claude/ui-ux-refinement\n    types: [opened, synchronize, reopened, ready_for_review, edited]\n');
  for (const forbidden of ['pull_request_target', 'workflow_run', 'workflow_dispatch', 'issue_comment', 'issues', 'schedule', 'repository_dispatch', 'push', 'check_run', 'status', 'release'])
    assert.ok(!block.includes(forbidden), `no ${forbidden} trigger`);
  for (const forbidden of ['pull_request_target', 'workflow_run', 'workflow_dispatch', 'issue_comment', 'repository_dispatch'])
    assert.ok(!nonComment(workflow).includes(forbidden), `${forbidden} appears nowhere in the workflow`);
});

test('WFP-2: permissions are empty at workflow level and exactly three read scopes on the single job, with no write scope anywhere', () => {
  assert.match(workflow, /^permissions: \{\}$/m);
  const jobBlock = workflow.match(/^ {4}permissions:\n((?: {6}.*\n)+)/m)[1];
  assert.deepEqual(jobBlock.split('\n').filter(Boolean).map(line => line.trim()), ['contents: read', 'pull-requests: read', 'checks: read']);
  assert.equal([...workflow.matchAll(/^\s*permissions:/gm)].length, 2, 'one workflow-level and one job-level permissions block');
  assert.doesNotMatch(nonComment(workflow), /:\s*(write|write-all)\b/);
  assert.doesNotMatch(workflow, /id-token|actions: |statuses: |issues: |deployments: |packages: /);
  const jobs = workflow.slice(workflow.indexOf('\njobs:\n') + 7);
  assert.deepEqual([...jobs.matchAll(/^ {2}([a-z0-9-]+):\s*$/gm)].map(match => match[1]), ['pr-readiness'], 'exactly one job');
});

test('WFP-3: no secret, no environment, no checkout, no third-party or any other action, no continue-on-error', () => {
  const code = nonComment(workflow);
  assert.doesNotMatch(code, /secrets\./);
  assert.doesNotMatch(code, /^\s*environment:/m);
  assert.doesNotMatch(code, /^\s*-?\s*uses:/m);
  assert.doesNotMatch(code, /actions\/checkout|setup-node|github-script/);
  assert.doesNotMatch(code, /continue-on-error/);
  assert.match(workflow, /^ {6}GH_TOKEN: \$\{\{ github\.token \}\}$/m, 'the only credential is the automatic read-scoped job token');
});

test('WFP-4: GitHub expressions appear only in the concurrency key and the env block, never inside the script', () => {
  const expressions = workflow.split('\n').map((line, index) => ({ line, index })).filter(entry => entry.line.includes('${{')).map(entry => entry.line.trim());
  assert.deepEqual(expressions, [
    'group: pr-readiness-${{ github.event.pull_request.number }}',
    'GH_TOKEN: ${{ github.token }}',
    'GH_REPO: ${{ github.repository }}',
    'PR_NUMBER: ${{ github.event.pull_request.number }}',
    'EVENT_HEAD_SHA: ${{ github.event.pull_request.head.sha }}',
    'EVENT_BASE_SHA: ${{ github.event.pull_request.base.sha }}',
  ]);
  assert.ok(!script.includes('${{'), 'no expression inside the script');
  for (const unsafe of ['pull_request.title', 'pull_request.body', 'head.ref', 'head_ref', 'comment.body', 'github.event.issue', 'github.head_ref'])
    assert.ok(!workflow.includes(unsafe), `untrusted ${unsafe} is never referenced`);
});

test('WFP-5: bounded runtime, one run per pull request, pinned runner, drafts skipped, a job and name that cannot be mistaken for node-tests', () => {
  assert.match(workflow, /^ {2}group: pr-readiness-\$\{\{ github\.event\.pull_request\.number \}\}\n {2}cancel-in-progress: true$/m);
  assert.match(workflow, /^ {4}timeout-minutes: 20$/m);
  assert.match(workflow, /^ {4}runs-on: ubuntu-24\.04$/m);
  assert.match(workflow, /^ {4}if: github\.event\.pull_request\.draft == false$/m);
  assert.match(workflow, /^ {2}pr-readiness:\n {4}name: pr-readiness$/m);
  assert.match(workflow, /^ {6}POLL_MAX_SECONDS: '900'$/m);
  assert.deepEqual([...workflow.matchAll(/node-tests/g)].length, 1, 'the name node-tests appears once, as the check this workflow only observes');
  assert.match(workflow, /^ {6}REQUIRED_CHECK: node-tests$/m);
});

test('WFP-6: the script can only read: one GET fetch, no other verb, no process or file side effects beyond the job summary, no runner-command files', () => {
  assert.equal([...script.matchAll(/\bfetch\(/g)].length, 1);
  assert.deepEqual([...script.matchAll(/method:\s*'([A-Z]+)'/g)].map(match => match[1]), ['GET']);
  assert.doesNotMatch(script, /\b(POST|PUT|PATCH|DELETE)\b/);
  assert.deepEqual([...script.matchAll(/^import .*$/gm)].map(match => match[0]), ["import { appendFileSync } from 'node:fs';"]);
  assert.doesNotMatch(script, /child_process|\beval\(|new Function|execSync|spawn|writeFile|unlinkSync|GITHUB_ENV|GITHUB_OUTPUT|GITHUB_PATH|GITHUB_STATE/);
  assert.equal([...script.matchAll(/appendFileSync\(/g)].length, 1);
  assert.match(script, /appendFileSync\(env\.GITHUB_STEP_SUMMARY/);
});

test('WFP-7: the existing node-tests workflow is intact and still the only definition of the required check', () => {
  assert.match(testsWorkflow, /^name: Tests$/m);
  assert.match(testsWorkflow, /^on:\n {2}pull_request:\n {4}branches:\n {6}- claude\/ui-ux-refinement\n/m);
  assert.match(testsWorkflow, /^permissions:\n {2}contents: read$/m);
  assert.match(testsWorkflow, /^ {2}node-tests:\n {4}runs-on: ubuntu-latest\n {4}timeout-minutes: 10$/m);
  assert.match(testsWorkflow, /run: node --test tests\/\*\.test\.mjs/);
  assert.ok(!/^\s{2}node-tests:/m.test(workflow), 'pr-readiness defines no job called node-tests');
  assert.ok(!/name: node-tests/.test(workflow));
});

test('WFP-8: the documentation states what the report is and is not, how to read it, its limits and how to roll it back', () => {
  const section = docs.slice(docs.indexOf('## PR readiness report'));
  assert.ok(docs.includes('## PR readiness report'), 'section present');
  for (const phrase of ['pr-readiness', 'informational', 'not a required check', 'READY', 'NOT READY', 'INCONCLUSIVE', 'PR_READINESS', 'human review', 'same GitHub account', 'Rollback', 'workflow files', 'authored head'])
    assert.ok(section.toLowerCase().includes(phrase.toLowerCase()), `docs mention ${phrase}`);
});

// ---------------------------------------------------------------- behaviour tests (mock GitHub API)

const pr = (over = {}) => ({
  state: 'open', draft: false, mergeable: true, base: { ref: UAT }, head: { sha: HEAD, repo: { full_name: REPO } }, user: { login: 'APNfsautomation' }, changed_files: 3, additions: 10, deletions: 2, title: 'a title', body: 'a body', ...over,
});
const checkRun = (over = {}) => ({ id: 101, name: 'node-tests', head_sha: HEAD, status: 'completed', conclusion: 'success', app: { id: 15368, slug: 'github-actions' }, ...over });
const checks = (...runs) => ({ total_count: runs.length, check_runs: runs });
const names = (count, mutate = () => ({})) => Array.from({ length: count }, (_, index) => ({ filename: `src/file${index}.js`, ...mutate(index) }));
const ok = body => ({ status: 200, body });
const fail = status => ({ status, body: { message: 'x' } });
const scenario = (over = {}) => ({ pr: [ok(pr())], checks: [ok(checks(checkRun()))], files: names(3), branch: [ok({ commit: { sha: UAT_NOW } })], ...over });

function startMock(spec) {
  const requests = [];
  const counters = new Map();
  const next = (key, list) => { const index = counters.get(key) ?? 0; counters.set(key, index + 1); return list[Math.min(index, list.length - 1)]; };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://mock');
    requests.push({ method: request.method, path: url.pathname, query: url.search, authorization: request.headers.authorization });
    let answer = { status: 404, body: { message: 'unrouted' } };
    if (url.pathname === `/repos/${REPO}/pulls/7`) answer = next('pr', spec.pr);
    else if (url.pathname === `/repos/${REPO}/pulls/7/files`) {
      const page = Number(url.searchParams.get('page'));
      answer = spec.filesPage ? spec.filesPage(page) : ok(spec.files.slice((page - 1) * 100, page * 100));
    } else if (url.pathname === `/repos/${REPO}/commits/${HEAD}/check-runs`) answer = next('checks', spec.checks);
    else if (url.pathname === `/repos/${REPO}/branches/${encodeURIComponent(UAT)}`) answer = next('branch', spec.branch);
    response.writeHead(answer.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(answer.body));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, requests, close: () => { server.closeAllConnections?.(); server.close(); } })));
}

const scratch = mkdtempSync(path.join(tmpdir(), 'pr-readiness-'));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
let runNumber = 0;

async function execute(spec, overrides = {}) {
  const mock = await startMock(spec);
  const summaryFile = path.join(scratch, `summary-${runNumber += 1}.md`);
  const env = {
    ...process.env, GITHUB_API_URL: mock.url, GITHUB_STEP_SUMMARY: summaryFile, GITHUB_SHA: 'e'.repeat(40), GH_TOKEN: 'test-token-not-real', GH_REPO: REPO, PR_NUMBER: '7',
    EVENT_HEAD_SHA: HEAD, EVENT_BASE_SHA: UAT_NOW, UAT_BRANCH: UAT, REQUIRED_CHECK: 'node-tests', POLL_MAX_SECONDS: '0.4', POLL_INTERVAL_SECONDS: '0.05', MERGEABLE_RETRIES: '2',
    MERGEABLE_RETRY_SECONDS: '0.02', API_RETRY_DELAY_MS: '1', ...overrides,
  };
  const child = spawn(process.execPath, ['--input-type=module', '-'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end(script);
  const code = await new Promise(resolve => child.on('close', resolve));
  mock.close();
  const summary = existsSync(summaryFile) ? readFileSync(summaryFile, 'utf8') : '';
  const verdict = stdout.match(/^PR_READINESS verdict=(\S+)/m)?.[1]?.replace('_', ' '); // the log token is NOT_READY so it stays one parseable word
  const codes = [...stdout.matchAll(/^PR_READINESS_REASON kind=(\S+) code=(\S+)$/gm)].map(match => `${match[1]}:${match[2]}`);
  return { code, stdout, stderr, summary, verdict, codes, requests: mock.requests };
}

// Properties that must hold for every single run, whatever the scenario.
function assertInvariants(result, expected) {
  assert.equal(result.verdict, expected, `verdict ${result.verdict}, reasons ${result.codes.join(',')}`);
  assert.equal(result.code, expected === 'READY' ? 0 : 1, 'exit code 0 only for READY');
  assert.ok(result.requests.every(request => request.method === 'GET'), 'only GET requests were sent');
  assert.ok(result.requests.every(request => request.path.startsWith(`/repos/${REPO}/`)), 'only this repository was queried');
  assert.ok(result.requests.every(request => request.authorization === 'Bearer test-token-not-real'));
  assert.ok(result.stdout.includes(BANNER) && result.summary.includes(BANNER), 'the human-review banner is printed even for READY');
  for (const line of result.stdout.split('\n').filter(line => line.startsWith('::')))
    assert.match(line, /^::(notice|warning|error) title=PR readiness( blocking| inconclusive| advisory)?::[^\r\n]*$/, 'only the fixed workflow commands are emitted');
  assert.match(result.stdout, /^PR_READINESS verdict=\S+ pr=\S* head=\S* base=\S* ci=\S* ci_check_run=\S* mergeable=\S* files=\S* files_complete=(true|false) workflow_files=\d+ human_review_required=true$/m);
  assert.ok(result.summary.includes('synthetic pull-request merge ref, not the authored head'), 'GITHUB_SHA is labelled synthetic');
  if (expected !== 'READY') assert.ok(result.codes.some(code => !code.startsWith('advisory:')), 'a non-READY verdict always lists a reason');
}
const check = async (spec, expected, overrides, codes = []) => {
  const result = await execute(spec, overrides);
  assertInvariants(result, expected);
  for (const code of codes) assert.ok(result.codes.includes(code), `expected ${code}, got ${result.codes.join(',')}`);
  return result;
};

test('RDY-1: a verified, complete, green pull request is READY, with the banner, a parseable log line and a summary', async () => {
  const result = await check(scenario(), 'READY');
  assert.match(result.stdout, new RegExp(`^PR_READINESS verdict=READY pr=7 head=${HEAD} base=claude/ui-ux-refinement ci=success ci_check_run=101 mergeable=true files=3 files_complete=true workflow_files=0 human_review_required=true$`, 'm'));
  assert.ok(result.summary.startsWith('## PR readiness: READY\n'));
  assert.ok(result.summary.includes('not a review, a merge authorization, a release approval or proof that the tests ran'));
  assert.ok(result.summary.includes('same GitHub account'), 'the shared-identity limit is stated');
  assert.deepEqual(result.codes, []);
});

test('RDY-2: any non-success conclusion of node-tests is NOT READY (failure, cancelled, skipped, neutral, timed_out, action_required, stale)', async () => {
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'neutral', 'timed_out', 'action_required', 'stale', null, 'something-new'])
    await check(scenario({ checks: [ok(checks(checkRun({ conclusion })))] }), 'NOT READY', undefined, ['notready:CI_NOT_SUCCESS']);
});

test('RDY-3: CI that never finishes, never appears or cannot be read is INCONCLUSIVE, never READY', async () => {
  await check(scenario({ checks: [ok(checks(checkRun({ status: 'in_progress', conclusion: null })))] }), 'INCONCLUSIVE', undefined, ['inconclusive:CI_PENDING']);
  await check(scenario({ checks: [ok(checks(checkRun({ status: 'queued', conclusion: null })))] }), 'INCONCLUSIVE', undefined, ['inconclusive:CI_PENDING']);
  await check(scenario({ checks: [ok(checks())] }), 'INCONCLUSIVE', undefined, ['inconclusive:CI_MISSING']);
  await check(scenario({ checks: [fail(500)] }), 'INCONCLUSIVE', undefined, ['inconclusive:API_CHECKS']);
  await check(scenario({ checks: [fail(404)] }), 'INCONCLUSIVE', undefined, ['inconclusive:API_CHECKS']);
});

test('RDY-4: polling follows a queued to in_progress to success sequence and a rerun supersedes an older result (latest run wins)', async () => {
  await check(scenario({ checks: [ok(checks(checkRun({ status: 'queued', conclusion: null }))), ok(checks(checkRun({ status: 'in_progress', conclusion: null }))), ok(checks(checkRun()))] }), 'READY', { POLL_MAX_SECONDS: '3' });
  await check(scenario({ checks: [ok(checks(checkRun({ id: 100, conclusion: 'failure' }), checkRun({ id: 200, conclusion: 'success' })))] }), 'READY');
  await check(scenario({ checks: [ok(checks(checkRun({ id: 100, conclusion: 'success' }), checkRun({ id: 200, conclusion: 'failure' })))] }), 'NOT READY', undefined, ['notready:CI_NOT_SUCCESS']);
  await check(scenario({ checks: [ok(checks(checkRun({ id: 100, conclusion: 'success' }), checkRun({ id: 200, status: 'in_progress', conclusion: null })))] }), 'INCONCLUSIVE', undefined, ['inconclusive:CI_PENDING']);
});

test('PRV-1: CI provenance: only a node-tests run from the GitHub Actions app (id 15368, slug github-actions) on the exact authored head counts', async () => {
  const forged = [
    checkRun({ id: 900, app: { id: 999, slug: 'github-actions' } }), checkRun({ id: 901, app: { id: 15368, slug: 'other-app' } }), checkRun({ id: 902, head_sha: MOVED_HEAD }),
    checkRun({ id: 903, name: 'node-tests-lookalike' }), checkRun({ id: 904, app: null }),
  ];
  const result = await check(scenario({ checks: [ok(checks(...forged))] }), 'INCONCLUSIVE', undefined, ['inconclusive:CI_MISSING', 'advisory:CI_FOREIGN_CHECKS_IGNORED']);
  assert.ok(!result.stdout.includes('ci=success'));
  await check(scenario({ checks: [ok(checks(...forged, checkRun({ id: 50, conclusion: 'failure' })))] }), 'NOT READY', undefined, ['notready:CI_NOT_SUCCESS', 'advisory:CI_FOREIGN_CHECKS_IGNORED']);
  await check(scenario({ checks: [ok(checks(...forged, checkRun({ id: 50 })))] }), 'READY', undefined, ['advisory:CI_FOREIGN_CHECKS_IGNORED']);
  await check(scenario({ checks: [ok({ total_count: 150, check_runs: [checkRun()] })] }), 'INCONCLUSIVE', undefined, ['inconclusive:CI_TRUNCATED']);
});

test('MRG-1 (P1-1): mergeability must be a verified true: null is retried and then INCONCLUSIVE, false is NOT READY, true is READY', async () => {
  await check(scenario({ pr: [ok(pr({ mergeable: true }))] }), 'READY');
  await check(scenario({ pr: [ok(pr({ mergeable: false }))] }), 'NOT READY', undefined, ['notready:MERGE_CONFLICT']);
  const never = await check(scenario({ pr: [ok(pr({ mergeable: null }))] }), 'INCONCLUSIVE', undefined, ['inconclusive:MERGEABLE_UNKNOWN']);
  assert.ok(never.requests.filter(request => request.path.endsWith('/pulls/7')).length >= 6, 'the unknown value was re-queried before giving up');
  await check(scenario({ pr: [ok(pr({ mergeable: null })), ok(pr({ mergeable: null })), ok(pr({ mergeable: true }))] }), 'READY');
  await check(scenario({ pr: [ok(pr({ mergeable: undefined }))] }), 'INCONCLUSIVE', undefined, ['inconclusive:MERGEABLE_UNKNOWN']);
});

test('ERR-1 (P1-2): every required read that fails turns the result INCONCLUSIVE; none can leave READY', async () => {
  await check(scenario({ pr: [fail(500)] }), 'INCONCLUSIVE', undefined, ['inconclusive:API_PR']);
  await check(scenario({ pr: [fail(404)] }), 'INCONCLUSIVE', undefined, ['inconclusive:API_PR']);
  await check(scenario({ pr: [fail(403)] }), 'INCONCLUSIVE', undefined, ['inconclusive:API_PR']);
  await check(scenario({ filesPage: () => fail(500) }), 'INCONCLUSIVE', undefined, ['inconclusive:FILES_API']);
  await check(scenario({ branch: [fail(500)] }), 'INCONCLUSIVE', undefined, ['inconclusive:API_UAT']);
  await check(scenario({ branch: [fail(404)] }), 'INCONCLUSIVE', undefined, ['inconclusive:API_UAT']);
  await check(scenario({ branch: [ok({ commit: {} })] }), 'INCONCLUSIVE', undefined, ['inconclusive:API_UAT']);
  await check(scenario({ branch: [ok({ commit: { sha: 'nonsense' } })] }), 'INCONCLUSIVE', undefined, ['inconclusive:API_UAT']);
  await check(scenario({ branch: [ok({})] }), 'INCONCLUSIVE', undefined, ['inconclusive:API_UAT']);
  await check(scenario(), 'INCONCLUSIVE', { GITHUB_API_URL: 'http://127.0.0.1:1' }, ['inconclusive:API_PR']);
});

test('ERR-2: a transient 5xx is retried and then succeeds; a final read that fails after CI was observed cannot be READY', async () => {
  await check(scenario({ pr: [fail(502), ok(pr())] }), 'READY');
  await check(scenario({ checks: [fail(500), ok(checks(checkRun()))] }), 'READY');
  await check(scenario({ pr: [ok(pr()), fail(500), fail(500), fail(500)] }), 'INCONCLUSIVE', undefined, ['inconclusive:API_PR_FINAL']);
});

test('STL-1 (P1-3): a stale authored head is NOT READY and CI is not even polled', async () => {
  const result = await check(scenario({ pr: [ok(pr({ head: { sha: MOVED_HEAD, repo: { full_name: REPO } } }))] }), 'NOT READY', undefined, ['notready:HEAD_SUPERSEDED']);
  assert.ok(!result.requests.some(request => request.path.includes('/check-runs')), 'no CI polling for a superseded head');
  assert.ok(result.summary.includes('SUPERSEDED'));
});

test('STL-2 (P1-3): the pull request is re-read after CI: head, base, state, draft or mergeability changing during the wait is never READY', async () => {
  const moved = { head: { sha: MOVED_HEAD, repo: { full_name: REPO } } };
  const during = async (change, codes) => {
    const result = await check(scenario({ pr: [ok(pr()), ok(pr(change))] }), 'NOT READY', undefined, codes);
    assert.ok(result.requests.some(request => request.path.includes('/check-runs')), 'CI was observed before the change was noticed');
    assert.ok(result.requests.filter(request => request.path.endsWith('/pulls/7')).length >= 2, 'the pull request was read again after polling');
  };
  await during(moved, ['notready:CHANGED_DURING_ASSESSMENT', 'notready:HEAD_SUPERSEDED']);
  await during({ state: 'closed' }, ['notready:CHANGED_DURING_ASSESSMENT', 'notready:PR_NOT_OPEN']);
  await during({ base: { ref: 'main' } }, ['notready:CHANGED_DURING_ASSESSMENT', 'notready:BASE_NOT_UAT']);
  await during({ draft: true }, ['notready:CHANGED_DURING_ASSESSMENT', 'notready:PR_DRAFT']);
  await during({ mergeable: false }, ['notready:MERGE_CONFLICT']);
  await check(scenario({ pr: [ok(pr()), ok(pr({ mergeable: null }))] }), 'INCONCLUSIVE', undefined, ['inconclusive:MERGEABLE_UNKNOWN']);
});

test('STL-3: wrong base, draft and closed pull requests are NOT READY at the first read', async () => {
  await check(scenario({ pr: [ok(pr({ base: { ref: 'main' } }))] }), 'NOT READY', undefined, ['notready:BASE_NOT_UAT']);
  await check(scenario({ pr: [ok(pr({ draft: true }))] }), 'NOT READY', undefined, ['notready:PR_DRAFT']);
  await check(scenario({ pr: [ok(pr({ state: 'closed', mergeable: null }))] }), 'NOT READY', undefined, ['notready:PR_NOT_OPEN']);
});

test('FIL-1 (P1-4): changed files are paginated: a workflow file on page 3 of 250 is found and the inventory is complete', async () => {
  const files = names(250, index => (index === 240 ? { filename: '.github/workflows/late.yml' } : {}));
  const result = await check(scenario({ pr: [ok(pr({ changed_files: 250 }))], files }), 'READY', undefined, ['advisory:WORKFLOW_FILES_CHANGED']);
  assert.ok(result.stdout.includes('files=250 files_complete=true workflow_files=1'));
  assert.equal(result.requests.filter(request => request.path.endsWith('/files')).length, 3);
  assert.ok(result.summary.includes('WARNING: WORKFLOW FILES CHANGED'));
  await check(scenario({ pr: [ok(pr({ changed_files: 100 }))], files: names(100) }), 'READY');
  await check(scenario({ pr: [ok(pr({ changed_files: 0 }))], files: [] }), 'READY');
});

test('FIL-2 (P1-4): an incomplete changed-file inventory is INCONCLUSIVE and never reports zero sensitive changes', async () => {
  await check(scenario({ pr: [ok(pr({ changed_files: 250 }))], filesPage: page => (page === 2 ? fail(500) : ok(names(100))) }), 'INCONCLUSIVE', undefined, ['inconclusive:FILES_API']);
  await check(scenario({ pr: [ok(pr({ changed_files: 5 }))], files: names(3) }), 'INCONCLUSIVE', undefined, ['inconclusive:FILES_INCOMPLETE']);
  const capped = await check(scenario({ pr: [ok(pr({ changed_files: 3001 }))], files: names(3000) }), 'INCONCLUSIVE', undefined, ['inconclusive:FILES_INCOMPLETE']);
  assert.ok(capped.stdout.includes('files_complete=false'));
  assert.ok(capped.summary.includes('INCOMPLETE'));
  await check(scenario({ pr: [ok(pr({ changed_files: undefined }))], files: names(3) }), 'INCONCLUSIVE', undefined, ['inconclusive:FILES_INCOMPLETE']);
});

test('WFC-1 (P1-6): workflow edits are flagged prominently even when everything else is green; READY stays advisory', async () => {
  const flagged = async (files, codes) => {
    const result = await check(scenario({ pr: [ok(pr({ changed_files: files.length }))], files }), 'READY', undefined, codes);
    assert.ok(result.summary.includes('> **WARNING: WORKFLOW FILES CHANGED'));
    assert.ok(result.summary.includes('review the workflow diff before trusting any result'));
    assert.ok(result.stdout.split('\n').some(line => line.startsWith('::warning title=PR readiness advisory::[WORKFLOW_FILES_CHANGED]')));
    return result;
  };
  await flagged([{ filename: '.github/workflows/tests.yml' }], ['advisory:WORKFLOW_FILES_CHANGED', 'advisory:TESTS_WORKFLOW_CHANGED']);
  await flagged([{ filename: 'app.js' }, { filename: '.github/actions/x/action.yml' }], ['advisory:WORKFLOW_FILES_CHANGED']);
  await flagged([{ filename: '.GitHub/Workflows/Sneaky.yml' }], ['advisory:WORKFLOW_FILES_CHANGED']);
  await flagged([{ filename: 'legacy/tests.yml', previous_filename: '.github/workflows/tests.yml', status: 'renamed' }], ['advisory:WORKFLOW_FILES_CHANGED', 'advisory:TESTS_WORKFLOW_CHANGED']);
});

test('WFC-2: sensitive areas are counted as advisories: Supabase, vendored dependencies, config, tests, other .github files', async () => {
  const files = [{ filename: 'supabase/migrations/005.sql' }, { filename: 'vendor/x/y.js' }, { filename: 'config/z.js' }, { filename: 'tests/a.test.mjs' }, { filename: '.github/CODEOWNERS' }, { filename: 'docs/a.md' }];
  const result = await check(scenario({ pr: [ok(pr({ changed_files: files.length }))], files }), 'READY', undefined,
    ['advisory:SUPABASE_CHANGED', 'advisory:VENDOR_CHANGED', 'advisory:CONFIG_CHANGED', 'advisory:TESTS_CHANGED', 'advisory:GITHUB_CONFIG_CHANGED']);
  assert.ok(!result.codes.includes('advisory:WORKFLOW_FILES_CHANGED'));
  const clean = await check(scenario({ pr: [ok(pr({ changed_files: 1 }))], files: [{ filename: 'docs/a.md' }] }), 'READY');
  assert.deepEqual(clean.codes, []);
});

test('ADV-1: UAT drift and a fork or deleted head repository are advisories, not blockers', async () => {
  await check(scenario({ branch: [ok({ commit: { sha: 'f'.repeat(40) } })] }), 'READY', undefined, ['advisory:UAT_MOVED']);
  await check(scenario(), 'READY', { EVENT_BASE_SHA: 'not-a-sha' });
  await check(scenario({ pr: [ok(pr({ head: { sha: HEAD, repo: { full_name: 'someone/fork' } } }))] }), 'READY', undefined, ['advisory:FORK_HEAD']);
  await check(scenario({ pr: [ok(pr({ head: { sha: HEAD, repo: null } }))] }), 'READY', undefined, ['advisory:FORK_HEAD']);
});

test('INJ-1: hostile strings from the API are inert: nothing user-controlled reaches the log, annotations or summary except through the allow-list filter', async () => {
  const hostile = '`x`::error title=pwn::pwn $(id) ${{ secrets.X }} [a](http://evil.example)\n::warning::y\r::add-mask::z <script>';
  const spec = scenario({
    pr: [ok(pr({ user: { login: hostile }, base: { ref: hostile }, title: hostile, body: hostile, head: { sha: HEAD, repo: { full_name: REPO }, ref: hostile } }))],
    checks: [ok(checks(checkRun({ conclusion: hostile })))],
    files: names(3, index => ({ filename: index === 0 ? `.github/workflows/${hostile}.yml` : `x/${hostile}${index}.js`, previous_filename: hostile })),
  });
  const result = await execute(spec);
  assertInvariants(result, 'NOT READY');
  // The allow-list keeps letters and digits, so words survive, but every character that could form a command, markup, a link or an expression is replaced.
  for (const text of [result.stdout, result.summary]) {
    for (const fragment of ['](', '$(', '${', '<script', '://', '`x`', 'title=pwn']) assert.ok(!text.includes(fragment), `no ${fragment} survives`);
  }
  assert.ok(!result.summary.includes('::'), 'no workflow command syntax in the summary');
  assert.ok(!result.summary.split('\n').some(line => /^\s*(::|<)/.test(line)));
  for (const row of ['Base (live, final read)', 'PR author (filtered)']) {
    const value = result.summary.match(new RegExp(`\\| ${row.replace(/[()]/g, '\\$&')} \\| \`([^\`]*)\``))[1];
    assert.match(value, /^[A-Za-z0-9._/@+?-]{0,100}$/, `${row} contains only allow-listed characters`);
    assert.ok(value.includes('?'), 'hostile characters were replaced');
  }
  assert.ok(result.codes.includes('advisory:WORKFLOW_FILES_CHANGED'), 'file names are classified, never echoed');
});

test('INJ-2: the title, body, head branch name and file names are never printed even when harmless', async () => {
  const result = await check(scenario({ pr: [ok(pr({ title: 'UNIQUE-TITLE-7731', body: 'UNIQUE-BODY-7731', head: { sha: HEAD, ref: 'UNIQUE-BRANCH-7731', repo: { full_name: REPO } } }))], files: names(3, index => ({ filename: `UNIQUE-FILE-7731-${index}.js` })) }), 'READY');
  assert.ok(!(result.stdout + result.summary).includes('7731'));
});

test('INP-1: invalid inputs are INCONCLUSIVE and no request is made', async () => {
  for (const bad of [{ PR_NUMBER: 'x' }, { PR_NUMBER: '' }, { PR_NUMBER: '7; id' }, { EVENT_HEAD_SHA: 'abc' }, { EVENT_HEAD_SHA: HEAD.toUpperCase() }, { GH_REPO: 'no-slash' }, { GH_REPO: 'a/b/../c' }, { UAT_BRANCH: '' }, { REQUIRED_CHECK: '' }]) {
    const result = await execute(scenario(), bad);
    assertInvariants(result, 'INCONCLUSIVE');
    assert.deepEqual(result.codes, ['inconclusive:BAD_INPUT']);
    assert.equal(result.requests.length, 0);
  }
});

test('RO-1: across a full green run the script sent only GET requests to the five expected read endpoints and nothing else', async () => {
  const result = await check(scenario(), 'READY');
  const endpoints = [...new Set(result.requests.map(request => request.path.replace(/\/[0-9a-f]{40}\//, '/{sha}/')))].sort();
  assert.deepEqual(endpoints, [`/repos/${REPO}/branches/claude%2Fui-ux-refinement`, `/repos/${REPO}/commits/{sha}/check-runs`, `/repos/${REPO}/pulls/7`, `/repos/${REPO}/pulls/7/files`].sort());
  assert.ok(result.requests.every(request => request.method === 'GET'));
});

// ---------------------------------------------------------------- Round 1 review (R1-A, R1-B): missing or invalid required PR metadata must never become READY

const without = (key, over = {}) => { const body = pr(over); delete body[key]; return body; };

test('DRF-1 (R1-A): draft is tri-state: only an explicit boolean false establishes "not a draft"; true is NOT READY; anything else is INCONCLUSIVE', async () => {
  await check(scenario({ pr: [ok(pr({ draft: false }))] }), 'READY');
  await check(scenario({ pr: [ok(pr({ draft: true }))] }), 'NOT READY', undefined, ['notready:PR_DRAFT']);
  for (const [label, body] of [['missing', without('draft')], ['null', pr({ draft: null })], ['string false', pr({ draft: 'false' })], ['string true', pr({ draft: 'true' })], ['zero', pr({ draft: 0 })], ['one', pr({ draft: 1 })], ['empty string', pr({ draft: '' })], ['object', pr({ draft: {} })], ['array', pr({ draft: [] })]]) {
    const result = await execute(scenario({ pr: [ok(body)] }));
    assertInvariants(result, 'INCONCLUSIVE');
    assert.ok(result.codes.includes('inconclusive:PR_DRAFT_UNKNOWN'), `${label}: ${result.codes.join(',')}`);
    assert.ok(!result.codes.includes('notready:PR_DRAFT'), `${label} is not asserted to be a draft either`);
  }
});

test('DRF-2 (R1-A): unknown draft status at either read blocks READY, whichever read is unknown', async () => {
  await check(scenario({ pr: [ok(pr()), ok(without('draft'))] }), 'INCONCLUSIVE', undefined, ['inconclusive:PR_DRAFT_UNKNOWN']);
  await check(scenario({ pr: [ok(pr({ draft: null })), ok(pr())] }), 'INCONCLUSIVE', undefined, ['inconclusive:PR_DRAFT_UNKNOWN']);
  await check(scenario({ pr: [ok(without('draft')), ok(without('draft'))] }), 'INCONCLUSIVE', undefined, ['inconclusive:PR_DRAFT_UNKNOWN']);
  await check(scenario({ pr: [ok(pr({ draft: null })), ok(pr({ draft: true }))] }), 'NOT READY', undefined, ['notready:PR_DRAFT']);
});

test('CFC-1 (R1-B): changed_files is accepted only as a non-negative integer; null, missing, negative, fractional, string and other types are unknown, never a count', async () => {
  const bad = [['null', null], ['missing', undefined], ['string zero', '0'], ['string three', '3'], ['negative', -1], ['fraction', 1.5], ['boolean false', false], ['boolean true', true], ['array', []], ['object', {}], ['NaN (serialises to null)', Number.NaN], ['Infinity (serialises to null)', Infinity]];
  for (const emptyList of [true, false]) {
    for (const [label, value] of bad) {
      const body = value === undefined ? without('changed_files') : pr({ changed_files: value });
      const result = await execute(scenario({ pr: [ok(body)], files: emptyList ? [] : names(3) }));
      assertInvariants(result, 'INCONCLUSIVE');
      assert.ok(result.codes.includes('inconclusive:FILES_INCOMPLETE'), `${label} (${emptyList ? 'empty' : '3'} files): ${result.codes.join(',')}`);
      assert.ok(result.stdout.includes('files_complete=false'), `${label}: inventory is not reported complete`);
      assert.ok(result.stdout.includes('files=unknown'), `${label}: the count is reported as unknown, not as a number`);
    }
  }
});

test('CFC-2 (R1-B): legitimate counts are unchanged: 0 with no files and 3 with three files are READY; a mismatch is still INCONCLUSIVE', async () => {
  await check(scenario({ pr: [ok(pr({ changed_files: 0 }))], files: [] }), 'READY');
  await check(scenario({ pr: [ok(pr({ changed_files: 3 }))], files: names(3) }), 'READY');
  await check(scenario({ pr: [ok(pr({ changed_files: 0 }))], files: names(1) }), 'INCONCLUSIVE', undefined, ['inconclusive:FILES_INCOMPLETE']);
  await check(scenario({ pr: [ok(pr({ changed_files: 3 }))], files: [] }), 'INCONCLUSIVE', undefined, ['inconclusive:FILES_INCOMPLETE']);
});

// ---------------------------------------------------------------- Round 2 review (R2): the check-run total_count is a required fact too

const runList = (count, over = () => ({})) => Array.from({ length: count }, (_, index) => checkRun({ id: index + 1, ...over(index) }));
const countedChecks = (totalCount, runs) => { const body = { total_count: totalCount, check_runs: runs }; if (totalCount === undefined) delete body.total_count; return body; };

test('CNT-1 (R2): total_count is accepted only as a non-negative integer; missing, null, string, negative, fractional and other types are INCONCLUSIVE, never green', async () => {
  for (const [label, value] of [['missing', undefined], ['null', null], ['string one', '1'], ['empty string', ''], ['string zero', '0'], ['negative', -1], ['fraction', 1.5], ['half', 0.5], ['boolean true', true], ['array', []], ['object', {}], ['NaN (serialises to null)', Number.NaN], ['Infinity (serialises to null)', Infinity]]) {
    const result = await execute(scenario({ checks: [ok(countedChecks(value, [checkRun()]))] }));
    assertInvariants(result, 'INCONCLUSIVE');
    assert.ok(result.codes.includes('inconclusive:CI_COUNT_UNKNOWN'), `${label}: ${result.codes.join(',')}`);
  }
});

test('CNT-2 (R2): a reported total smaller than the returned list is an inconsistency and INCONCLUSIVE', async () => {
  for (const [total, runs] of [[0, [checkRun()]], [1, [checkRun({ id: 1 }), checkRun({ id: 2 })]], [99, runList(100)]]) {
    const result = await execute(scenario({ checks: [ok(countedChecks(total, runs))] }));
    assertInvariants(result, 'INCONCLUSIVE');
    assert.ok(result.codes.includes('inconclusive:CI_COUNT_INCONSISTENT'), `${total} of ${runs.length}: ${result.codes.join(',')}`);
  }
});

test('CNT-3 (R2): truncation is still detected, and legitimate matching counts are still READY', async () => {
  await check(scenario({ checks: [ok(countedChecks(1, [checkRun()]))] }), 'READY');
  await check(scenario({ checks: [ok(countedChecks(100, runList(100)))] }), 'READY');
  await check(scenario({ checks: [ok(countedChecks(101, runList(100)))] }), 'INCONCLUSIVE', undefined, ['inconclusive:CI_TRUNCATED']);
  await check(scenario({ checks: [ok(countedChecks(150, [checkRun()]))] }), 'INCONCLUSIVE', undefined, ['inconclusive:CI_TRUNCATED']);
});

test('CNT-4 (R2): an invalid or inconsistent count does not hide a failed CI result: NOT READY still wins, and both reasons are listed', async () => {
  const failed = checkRun({ conclusion: 'failure' });
  await check(scenario({ checks: [ok(countedChecks(null, [failed]))] }), 'NOT READY', undefined, ['notready:CI_NOT_SUCCESS', 'inconclusive:CI_COUNT_UNKNOWN']);
  await check(scenario({ checks: [ok(countedChecks(0, [failed]))] }), 'NOT READY', undefined, ['notready:CI_NOT_SUCCESS', 'inconclusive:CI_COUNT_INCONSISTENT']);
  await check(scenario({ checks: [ok(countedChecks(5, [failed]))] }), 'NOT READY', undefined, ['notready:CI_NOT_SUCCESS', 'inconclusive:CI_TRUNCATED']);
});
