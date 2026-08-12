/**
 * Report generator (`pnpm eval:report`): aggregates eval/results/results.jsonl
 * plus per-run artifacts into a single-file HTML report (data embedded as
 * JSON, vanilla-JS rendering, opens from file://). Click a task to see its
 * full process: injected context, turn/step timeline, thinking, tool calls,
 * token usage, workspace diff, and grader evidence.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { RESULTS_PATH } from './runner/runner.ts'
import type { RunRecord } from './types.ts'

interface Detail extends RunRecord {
  trace?: string
  diff?: string
  stdout?: string
  stderr?: string
}

function runDetails(record: RunRecord): Detail {
  const detail: Detail = { ...record }
  for (const [field, file] of [
    ['trace', 'trace.md'],
    ['diff', 'diff.txt'],
    ['stdout', 'stdout.txt'],
    ['stderr', 'stderr.txt'],
  ] as const) {
    const path = join(record.runDir, file)
    if (existsSync(path)) {
      const text = readFileSync(path, 'utf8')
      detail[field] = text.length > 200_000 ? `${text.slice(0, 200_000)}… (truncated)` : text
    }
  }
  return detail
}

function main(): void {
  const resultsFile = join(RESULTS_PATH, 'results.jsonl')
  if (!existsSync(resultsFile)) {
    console.error(`no results at ${resultsFile}; run pnpm eval:run first`)
    process.exit(2)
  }
  const records = readFileSync(resultsFile, 'utf8').split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as RunRecord)
  const details = records.map(record => runDetails(record))
  const summaryFile = join(RESULTS_PATH, 'run-summary.json')
  const summary = existsSync(summaryFile)
    ? JSON.parse(readFileSync(summaryFile, 'utf8')) as { model?: unknown; ranAt?: string; taskCount?: number }
    : {}
  const totals = details.reduce((acc, record) => {
    const tokens = record.process?.tokens
    if (tokens !== undefined) {
      acc.input += tokens.input
      acc.output += tokens.output
      acc.cacheRead += tokens.cacheRead
      acc.cacheWrite += tokens.cacheWrite
      acc.reasoning += tokens.reasoning
    }
    acc.durationMs += record.durationMs
    return acc
  }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, durationMs: 0 })
  const passed = details.filter(record => record.status === 'pass').length

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>dsh-web-review eval report</title>
<style>
  :root { --bg:#f6f7f9; --card:#fff; --line:#e2e5ea; --text:#24292f; --muted:#57606a; --ok:#1a7f37; --bad:#cf222e; --warn:#9a6700; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, sans-serif; background:var(--bg); color:var(--text); }
  header { background:var(--card); border-bottom:1px solid var(--line); padding:20px 28px; }
  header h1 { margin:0 0 6px; font-size:20px; }
  .meta { color:var(--muted); font-size:13px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; padding:20px 28px; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  .stat .value { font-size:22px; font-weight:600; }
  .stat .label { font-size:12px; color:var(--muted); }
  main { padding:0 28px 40px; }
  .filters { display:flex; gap:8px; flex-wrap:wrap; margin:14px 0; }
  .filters select, .filters button { padding:6px 10px; border:1px solid var(--line); border-radius:8px; background:var(--card); font-size:13px; }
  table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  th, td { padding:9px 12px; border-bottom:1px solid var(--line); font-size:13px; text-align:left; }
  th { background:#f0f2f5; font-weight:600; }
  tr:last-child td { border-bottom:0; }
  tr.row { cursor:pointer; }
  tr.row:hover { background:#f6f8fa; }
  .badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; font-weight:600; }
  .pass { background:#dafbe1; color:var(--ok); }
  .fail { background:#ffebe9; color:var(--bad); }
  .timeout, .error { background:#fff8c5; color:var(--warn); }
  #detail { position:fixed; inset:0; background:rgba(20,24,28,0.5); display:none; align-items:center; justify-content:center; }
  #detail.open { display:flex; }
  #detail article { background:var(--card); width:min(1100px,94vw); height:92vh; border-radius:12px; padding:20px 24px; overflow:auto; }
  #detail .close { float:right; border:1px solid var(--line); background:none; border-radius:8px; padding:4px 10px; cursor:pointer; }
  pre { background:#f6f8fa; border:1px solid var(--line); border-radius:8px; padding:10px 12px; overflow:auto; font-size:12px; max-height:420px; }
  details { margin:10px 0; }
  summary { cursor:pointer; font-weight:600; font-size:13px; }
  h3 { margin:18px 0 8px; font-size:15px; }
</style>
</head>
<body>
<header>
  <h1>dsh-web-review · frontend modification eval</h1>
  <div class="meta">model: <span id="model"></span> · tasks: <span id="taskCount"></span> · generated: <span id="generatedAt"></span></div>
</header>
<div class="cards">
  <div class="stat"><div class="value" id="passRate"></div><div class="label">pass rate</div></div>
  <div class="stat"><div class="value" id="totalDuration"></div><div class="label">total wall time</div></div>
  <div class="stat"><div class="value" id="inputTokens"></div><div class="label">input tokens</div></div>
  <div class="stat"><div class="value" id="outputTokens"></div><div class="label">output tokens</div></div>
  <div class="stat"><div class="value" id="cacheTokens"></div><div class="label">cache read/write</div></div>
  <div class="stat"><div class="value" id="reasoningTokens"></div><div class="label">reasoning tokens</div></div>
</div>
<main>
  <div class="filters">
    <select id="fCategory"><option value="">全部类别</option></select>
    <select id="fDifficulty"><option value="">全部难度</option><option value="easy">easy</option><option value="medium">medium</option><option value="hard">hard</option></select>
    <select id="fFixture"><option value="">全部应用</option></select>
    <select id="fStatus"><option value="">全部状态</option><option value="pass">pass</option><option value="fail">fail</option><option value="timeout">timeout</option><option value="error">error</option></select>
    <button id="fReset">重置</button>
  </div>
  <table>
    <thead><tr>
      <th>task</th><th>title</th><th>category</th><th>difficulty</th><th>fixture</th><th>status</th>
      <th>steps</th><th>tools</th><th>first write</th><th>tokens in/out</th><th>duration</th><th>attribution</th>
    </tr></thead>
    <tbody id="tbody"></tbody>
  </table>
</main>
<div id="detail"><article>
  <button class="close" onclick="document.getElementById('detail').classList.remove('open')">✕</button>
  <div id="detailBody"></div>
</article></div>
<script>
const DATA = ${JSON.stringify(details)};
const SUMMARY = ${JSON.stringify(summary)};
const TOTALS = ${JSON.stringify(totals)};
const model = SUMMARY.model ?? DATA[0]?.model ?? {};
document.getElementById('model').textContent = [model.provider, model.model, model.reasoningEffort ? '· effort ' + model.reasoningEffort : ''].filter(Boolean).join(' ');
document.getElementById('taskCount').textContent = DATA.length;
document.getElementById('generatedAt').textContent = new Date().toISOString();
document.getElementById('passRate').textContent = Math.round(${passed} / Math.max(1, DATA.length) * 100) + '%';
document.getElementById('totalDuration').textContent = (TOTALS.durationMs / 60000).toFixed(1) + ' min';
const fmt = n => n >= 1000000 ? (n/1000000).toFixed(2)+'M' : n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n);
document.getElementById('inputTokens').textContent = fmt(TOTALS.input);
document.getElementById('outputTokens').textContent = fmt(TOTALS.output);
document.getElementById('cacheTokens').textContent = fmt(TOTALS.cacheRead) + ' / ' + fmt(TOTALS.cacheWrite);
document.getElementById('reasoningTokens').textContent = fmt(TOTALS.reasoning);
const categories = [...new Set(DATA.map(d => d.category))].sort();
const fixtures = [...new Set(DATA.map(d => d.fixture))].sort();
for (const c of categories) { const o = document.createElement('option'); o.value = c; o.textContent = c; document.getElementById('fCategory').appendChild(o); }
for (const f of fixtures) { const o = document.createElement('option'); o.value = f; o.textContent = f; document.getElementById('fFixture').appendChild(o); }
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function render() {
  const fCategory = document.getElementById('fCategory').value;
  const fDifficulty = document.getElementById('fDifficulty').value;
  const fFixture = document.getElementById('fFixture').value;
  const fStatus = document.getElementById('fStatus').value;
  const rows = DATA.filter(d =>
    (!fCategory || d.category === fCategory) &&
    (!fDifficulty || d.difficulty === fDifficulty) &&
    (!fFixture || d.fixture === fFixture) &&
    (!fStatus || d.status === fStatus));
  document.getElementById('tbody').innerHTML = rows.map(d => {
    const tokens = d.process?.tokens;
    return '<tr class="row" onclick="openDetail(' + JSON.stringify(d.taskId) + ')">'
      + '<td>' + esc(d.taskId) + '</td><td>' + esc(d.title) + '</td><td>' + esc(d.category) + '</td><td>' + esc(d.difficulty) + '</td><td>' + esc(d.fixture) + '</td>'
      + '<td><span class="badge ' + d.status + '">' + d.status + '</span></td>'
      + '<td>' + (d.process?.steps ?? '—') + '</td>'
      + '<td>' + Object.values(d.process?.toolCalls ?? {}).reduce((a,b)=>a+b,0) + '</td>'
      + '<td>' + (d.process?.firstWriteStep ?? '—') + '</td>'
      + '<td>' + (tokens ? fmt(tokens.input)+' / '+fmt(tokens.output) : '—') + '</td>'
      + '<td>' + (d.durationMs/1000).toFixed(0) + 's</td>'
      + '<td>' + esc(d.attribution ?? '') + '</td></tr>';
  }).join('');
}
document.getElementById('fCategory').onchange = render;
document.getElementById('fDifficulty').onchange = render;
document.getElementById('fFixture').onchange = render;
document.getElementById('fStatus').onchange = render;
document.getElementById('fReset').onclick = () => { for (const id of ['fCategory','fDifficulty','fFixture','fStatus']) document.getElementById(id).value=''; render(); };
function openDetail(taskId) {
  const d = DATA.find(x => x.taskId === taskId);
  if (!d) return;
  const tokens = d.process?.tokens;
  const toolLines = Object.entries(d.process?.toolCalls ?? {}).map(([name,count]) => name + ' × ' + count).join(', ');
  const graderLines = (d.grader?.results ?? []).map(r => '<li>' + esc(r.ok ? '✓' : '✗') + ' ' + esc(r.expected) + ' → ' + esc(r.measured) + '</li>').join('');
  document.getElementById('detailBody').innerHTML =
    '<h2>' + esc(d.taskId) + ' · ' + esc(d.title) + '</h2>'
    + '<p class="meta">' + esc(d.fixture) + ' / ' + esc(d.category) + ' / ' + esc(d.difficulty)
    + ' · <span class="badge ' + d.status + '">' + d.status + '</span>'
    + ' · ' + esc(d.attribution ?? '') + ' · ' + (d.durationMs/1000).toFixed(1) + 's · exit ' + d.exitCode + '</p>'
    + '<h3>Model</h3><p class="meta">' + esc([d.model.provider, d.model.model, d.model.reasoningEffort ?? ''].filter(Boolean).join(' · ')) + '</p>'
    + '<h3>Tokens</h3><p class="meta">in ' + fmt(tokens?.input ?? 0) + ' · out ' + fmt(tokens?.output ?? 0)
    + ' · cache r/w ' + fmt(tokens?.cacheRead ?? 0) + '/' + fmt(tokens?.cacheWrite ?? 0)
    + ' · reasoning ' + fmt(tokens?.reasoning ?? 0)
    + ' · usage reported on ' + (d.process?.stepsWithUsage ?? 0) + '/' + (d.process?.assistantSteps ?? 0) + ' steps</p>'
    + '<h3>Process</h3><p class="meta">turns ' + (d.process?.turns ?? '—') + ' · steps ' + (d.process?.steps ?? '—')
    + ' · first tool call at step ' + (d.process?.firstToolCallStep ?? '—') + ' · first write at step ' + (d.process?.firstWriteStep ?? '—')
    + ' · end reason ' + esc(d.process?.endReason ?? '') + '</p>'
    + '<p class="meta">tools: ' + esc(toolLines || 'none') + '</p>'
    + '<p class="meta">files read: ' + esc((d.process?.filesRead ?? []).join(', ') || 'none') + '</p>'
    + '<p class="meta">modified files: ' + esc(d.modifiedFiles.join(', ') || 'none') + '</p>'
    + '<h3>Grader</h3>' + (graderLines ? '<ul>' + graderLines + '</ul>' : '<p class="meta">no grader evidence</p>')
    + '<h3>Final answer</h3><pre>' + esc(d.process?.finalText ?? '') + '</pre>'
    + (d.trace ? '<h3>Process trace</h3><pre>' + esc(d.trace) + '</pre>' : '')
    + (d.diff ? '<h3>Workspace diff</h3><pre>' + esc(d.diff) + '</pre>' : '')
    + (d.stderr ? '<h3>Stderr</h3><pre>' + esc(d.stderr) + '</pre>' : '');
  document.getElementById('detail').classList.add('open');
}
document.getElementById('detail').addEventListener('click', e => { if (e.target === document.getElementById('detail')) document.getElementById('detail').classList.remove('open'); });
render();
</script>
</body>
</html>
`
  const outDir = RESULTS_PATH
  mkdirSync(outDir, { recursive: true })
  const out = join(outDir, 'report.html')
  writeFileSync(out, html)
  console.log(`report written: ${out} (${details.length} task(s), ${passed} passing)`)
}

void main()
