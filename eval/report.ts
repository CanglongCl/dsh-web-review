/**
 * Report generator (`pnpm eval:report`): aggregates eval/results/results.jsonl
 * plus per-run artifacts into a single-file HTML report (data embedded as
 * JSON, vanilla-JS rendering, opens from file://). Click a task to see its
 * full process: injected context, turn/step timeline, thinking, tool calls,
 * token usage, workspace diff, and grader evidence.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { RESULTS_PATH } from './runner/runner.ts'
import type { RunRecord } from './types.ts'

interface Detail extends RunRecord {
  trace?: string
  diff?: string
  stdout?: string
  stderr?: string
  sessionLogHref?: string
  traceHref?: string
}

function runDetails(record: RunRecord): Detail {
  const detail: Detail = { ...record }
  const linkTo = (file: string): string => relative(RESULTS_PATH, join(record.runDir, file)).split(sep).join('/')
  if (record.runDir !== '' && existsSync(join(record.runDir, 'session.jsonl'))) detail.sessionLogHref = linkTo('session.jsonl')
  if (record.runDir !== '' && existsSync(join(record.runDir, 'trace.md'))) detail.traceHref = linkTo('trace.md')
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
  // Keep the latest record per scenario arm and repetition.
  const parsed = readFileSync(resultsFile, 'utf8').split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as RunRecord)
  const latestByRun = new Map<string, RunRecord>()
  for (const record of parsed) latestByRun.set(`${record.taskId}:${record.arm ?? 'full'}:${record.repetition ?? 1}`, record)
  const records = [...latestByRun.values()].sort((a, b) => `${a.taskId}:${a.arm}:${a.repetition}`.localeCompare(`${b.taskId}:${b.arm}:${b.repetition}`))
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
<title>dsh-web-review 插件能力评测报告</title>
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
  h2.section { margin:24px 0 10px; font-size:16px; }
  .delta-positive { color:var(--ok); font-weight:600; }
  .delta-negative { color:var(--bad); font-weight:600; }
</style>
</head>
<body>
<header>
  <h1>dsh-web-review · 插件能力评测报告</h1>
  <div class="meta">模型：<span id="model"></span> · 运行次数：<span id="taskCount"></span> · 生成时间：<span id="generatedAt"></span></div>
</header>
<div class="cards">
  <div class="stat"><div class="value" id="passRate"></div><div class="label">通过率</div></div>
  <div class="stat"><div class="value" id="totalDuration"></div><div class="label">累计运行时间</div></div>
  <div class="stat"><div class="value" id="inputTokens"></div><div class="label">输入 Token</div></div>
  <div class="stat"><div class="value" id="outputTokens"></div><div class="label">输出 Token</div></div>
  <div class="stat"><div class="value" id="cacheTokens"></div><div class="label">缓存读取 / 写入</div></div>
  <div class="stat"><div class="value" id="reasoningTokens"></div><div class="label">推理 Token</div></div>
</div>
<main>
  <div class="filters">
    <select id="fCategory"><option value="">全部类别</option></select>
    <select id="fDifficulty"><option value="">全部难度</option><option value="easy">简单</option><option value="medium">中等</option><option value="hard">困难</option><option value="long">长任务</option></select>
    <select id="fFixture"><option value="">全部应用</option></select>
    <select id="fArm"><option value="">全部实验臂</option><option value="full">完整插件</option><option value="text-only">仅文本</option><option value="oracle">理想上下文</option></select>
    <select id="fStatus"><option value="">全部状态</option><option value="pass">通过</option><option value="fail">未通过</option><option value="timeout">超时</option><option value="error">错误</option></select>
    <button id="fReset">重置</button>
  </div>
  <h2 class="section">插件能力配对诊断</h2>
  <table>
    <thead><tr><th>题目</th><th>重复</th><th>仅文本</th><th>完整插件</th><th>Oracle</th><th>完整 − 仅文本</th><th>Oracle − 完整</th><th>步骤差</th><th>耗时差</th></tr></thead>
    <tbody id="pairBody"></tbody>
  </table>
  <h2 class="section">单次运行明细</h2>
  <table>
    <thead><tr>
      <th>题目</th><th>实验臂</th><th>重复</th><th>题目名称</th><th>能力类别</th><th>难度</th><th>应用</th><th>状态</th>
      <th>步骤</th><th>工具调用</th><th>首次写入</th><th>Token 输入 / 输出</th><th>耗时</th><th>失败归因</th><th>对话日志</th>
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
document.getElementById('model').textContent = [model.provider, model.model, model.reasoningEffort ? '· 推理强度 ' + model.reasoningEffort : ''].filter(Boolean).join(' ');
document.getElementById('taskCount').textContent = DATA.length;
document.getElementById('generatedAt').textContent = new Date().toLocaleString('zh-CN', { hour12:false });
document.getElementById('passRate').textContent = Math.round(${passed} / Math.max(1, DATA.length) * 100) + '%';
document.getElementById('totalDuration').textContent = (TOTALS.durationMs / 60000).toFixed(1) + ' 分钟';
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
const STATUS = { pass:'通过', fail:'未通过', timeout:'超时', error:'运行错误' };
const ARM = { full:'完整插件', 'text-only':'仅文本', oracle:'Oracle' };
const CATEGORY = { 'protocol-smoke':'协议冒烟', 'multi-target':'多目标定位', 'scope-resolution':'作用域判断', 'anchor-fallback':'无源码锚点回退', responsive:'响应式', semantics:'语义与无障碍', iterative:'多轮修正', 'tool-ownership':'工具归属', trust:'信任边界' };
const DIFFICULTY = { easy:'简单', medium:'中等', hard:'困难', long:'长任务' };
const ATTRIBUTION = { 'not-modified':'未修改', localization:'定位错误', 'wrong-value':'结果不符', timeout:'超时', 'runtime-error':'运行错误', unknown:'—' };
const statusScore = d => d?.status === 'pass' ? 1 : 0;
const signed = n => n === undefined || Number.isNaN(n) ? '—' : (n > 0 ? '+' : '') + n;
const paired = new Map();
for (const d of DATA) {
  const key = d.taskId + ':' + d.repetition;
  const row = paired.get(key) ?? { taskId:d.taskId, repetition:d.repetition };
  row[d.arm] = d;
  paired.set(key, row);
}
function armBadge(d) { return d ? '<span class="badge ' + d.status + '">' + esc(STATUS[d.status] ?? d.status) + '</span>' : '—'; }
function renderPairs(rows) {
  document.getElementById('pairBody').innerHTML = rows.map(row => {
    const text = row['text-only'], full = row.full, oracle = row.oracle;
    const fullLift = text && full ? statusScore(full) - statusScore(text) : undefined;
    const oracleGap = full && oracle ? statusScore(oracle) - statusScore(full) : undefined;
    const stepLift = text?.process && full?.process ? full.process.steps - text.process.steps : undefined;
    const stepGap = full?.process && oracle?.process ? oracle.process.steps - full.process.steps : undefined;
    const durationLift = text && full ? Math.round((full.durationMs - text.durationMs) / 1000) : undefined;
    const durationGap = full && oracle ? Math.round((oracle.durationMs - full.durationMs) / 1000) : undefined;
    const deltaClass = n => n > 0 ? 'delta-positive' : n < 0 ? 'delta-negative' : '';
    return '<tr><td>' + esc(row.taskId) + '</td><td>' + esc(row.repetition) + '</td><td>' + armBadge(text) + '</td><td>' + armBadge(full) + '</td><td>' + armBadge(oracle) + '</td>'
      + '<td class="' + deltaClass(fullLift) + '">' + signed(fullLift) + '</td><td class="' + deltaClass(oracleGap) + '">' + signed(oracleGap) + '</td>'
      + '<td>完整−文本 ' + signed(stepLift) + ' · Oracle−完整 ' + signed(stepGap) + '</td><td>完整−文本 ' + signed(durationLift) + ' 秒 · Oracle−完整 ' + signed(durationGap) + ' 秒</td></tr>';
  }).join('');
}
function render() {
  const fCategory = document.getElementById('fCategory').value;
  const fDifficulty = document.getElementById('fDifficulty').value;
  const fFixture = document.getElementById('fFixture').value;
  const fArm = document.getElementById('fArm').value;
  const fStatus = document.getElementById('fStatus').value;
  const rows = DATA.filter(d =>
    (!fCategory || d.category === fCategory) &&
    (!fDifficulty || d.difficulty === fDifficulty) &&
    (!fFixture || d.fixture === fFixture) &&
    (!fArm || d.arm === fArm) &&
    (!fStatus || d.status === fStatus));
  const visiblePairs = [...paired.values()].filter(row => rows.some(d => d.taskId === row.taskId && d.repetition === row.repetition));
  renderPairs(visiblePairs);
  document.getElementById('tbody').innerHTML = rows.map(d => {
    const tokens = d.process?.tokens;
    const runKey = d.taskId + ':' + d.arm + ':' + d.repetition;
    return '<tr class="row" onclick="openDetail(' + JSON.stringify(runKey) + ')">'
      + '<td>' + esc(d.taskId) + '</td><td>' + esc(ARM[d.arm] ?? d.arm) + '</td><td>' + esc(d.repetition) + '</td><td>' + esc(d.title) + '</td><td>' + esc(CATEGORY[d.category] ?? d.category) + '</td><td>' + esc(DIFFICULTY[d.difficulty] ?? d.difficulty) + '</td><td>' + esc(d.fixture) + '</td>'
      + '<td><span class="badge ' + d.status + '">' + esc(STATUS[d.status] ?? d.status) + '</span></td>'
      + '<td>' + (d.process?.steps ?? '—') + '</td>'
      + '<td>' + Object.values(d.process?.toolCalls ?? {}).reduce((a,b)=>a+b,0) + '</td>'
      + '<td>' + (d.process?.firstWriteStep ?? '—') + '</td>'
      + '<td>' + (tokens ? fmt(tokens.input)+' / '+fmt(tokens.output) : '—') + '</td>'
      + '<td>' + (d.durationMs/1000).toFixed(0) + ' 秒</td>'
      + '<td>' + esc(ATTRIBUTION[d.attribution] ?? d.attribution ?? '') + '</td>'
      + '<td>' + (d.sessionLogHref ? '<a href="' + esc(d.sessionLogHref) + '" target="_blank" onclick="event.stopPropagation()">打开日志</a>' : '—') + '</td></tr>';
  }).join('');
}
document.getElementById('fCategory').onchange = render;
document.getElementById('fDifficulty').onchange = render;
document.getElementById('fFixture').onchange = render;
document.getElementById('fArm').onchange = render;
document.getElementById('fStatus').onchange = render;
document.getElementById('fReset').onclick = () => { for (const id of ['fCategory','fDifficulty','fFixture','fArm','fStatus']) document.getElementById(id).value=''; render(); };
function openDetail(runKey) {
  const d = DATA.find(x => x.taskId + ':' + x.arm + ':' + x.repetition === runKey);
  if (!d) return;
  const tokens = d.process?.tokens;
  const toolLines = Object.entries(d.process?.toolCalls ?? {}).map(([name,count]) => name + ' × ' + count).join('，');
  const graderLines = (d.grader?.results ?? []).map(r => '<li>' + esc(r.ok ? '✓' : '✗') + ' ' + esc(r.expected) + ' → ' + esc(r.measured) + '</li>').join('');
  document.getElementById('detailBody').innerHTML =
    '<h2>' + esc(d.taskId) + ' · ' + esc(ARM[d.arm] ?? d.arm) + ' · 第 ' + esc(d.repetition) + ' 次 · ' + esc(d.title) + '</h2>'
    + '<p class="meta">' + esc(d.fixture) + ' / ' + esc(CATEGORY[d.category] ?? d.category) + ' / ' + esc(DIFFICULTY[d.difficulty] ?? d.difficulty)
    + ' · <span class="badge ' + d.status + '">' + esc(STATUS[d.status] ?? d.status) + '</span>'
    + ' · ' + esc(ATTRIBUTION[d.attribution] ?? d.attribution ?? '') + ' · ' + (d.durationMs/1000).toFixed(1) + ' 秒 · 退出码 ' + d.exitCode + '</p>'
    + (d.sessionLogHref ? '<p><a href="' + esc(d.sessionLogHref) + '" target="_blank">打开对应的 Harness 对话日志</a>' + (d.process?.sessionId ? ' <span class="meta">会话：' + esc(d.process.sessionId) + '</span>' : '') + '</p>' : '')
    + '<h3>模型</h3><p class="meta">' + esc([d.model.provider, d.model.model, d.model.reasoningEffort ?? ''].filter(Boolean).join(' · ')) + '</p>'
    + '<h3>Token 用量</h3><p class="meta">输入 ' + fmt(tokens?.input ?? 0) + ' · 输出 ' + fmt(tokens?.output ?? 0)
    + ' · 缓存读取/写入 ' + fmt(tokens?.cacheRead ?? 0) + '/' + fmt(tokens?.cacheWrite ?? 0)
    + ' · 推理 ' + fmt(tokens?.reasoning ?? 0)
    + ' · 有用量记录的步骤 ' + (tokens?.stepsWithUsage ?? 0) + '/' + (tokens?.assistantSteps ?? 0) + '</p>'
    + '<h3>执行过程</h3><p class="meta">轮次 ' + (d.process?.turns ?? '—') + ' · 步骤 ' + (d.process?.steps ?? '—')
    + ' · 首次工具调用：第 ' + (d.process?.firstToolCallStep ?? '—') + ' 步 · 首次写入：第 ' + (d.process?.firstWriteStep ?? '—') + ' 步'
    + ' · 结束原因：' + esc(d.process?.endReason ?? '') + '</p>'
    + '<p class="meta">工具：' + esc(toolLines || '无') + '</p>'
    + '<p class="meta">读取文件：' + esc((d.process?.filesRead ?? []).join('，') || '无') + '</p>'
    + '<p class="meta">修改文件：' + esc(d.modifiedFiles.join('，') || '无') + '</p>'
    + '<h3>评分证据</h3>' + (graderLines ? '<ul>' + graderLines + '</ul>' : '<p class="meta">无评分证据</p>')
    + '<h3>模型最终回复</h3><pre>' + esc(d.process?.finalText ?? '') + '</pre>'
    + (d.trace ? '<h3>执行轨迹</h3>' + (d.traceHref ? '<p><a href="' + esc(d.traceHref) + '" target="_blank">单独打开轨迹文件</a></p>' : '') + '<pre>' + esc(d.trace) + '</pre>' : '')
    + (d.diff ? '<h3>工作区差异</h3><pre>' + esc(d.diff) + '</pre>' : '')
    + (d.stderr ? '<h3>标准错误输出</h3><pre>' + esc(d.stderr) + '</pre>' : '');
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
