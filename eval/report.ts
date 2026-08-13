/**
 * Report generator (`pnpm eval:report`): aggregates eval/results/results.jsonl
 * plus per-run artifacts into a single-file HTML report (data embedded as
 * JSON, vanilla-JS rendering, opens from file://). Click a task to see its
 * full process: injected context, turn/step timeline, thinking, tool calls,
 * token usage, workspace diff, and grader evidence.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { REPO_ROOT, RESULTS_PATH } from './runner/runner.ts'
import { loadTasks } from './tasks/register.ts'
import type { LoadedEvalTask, RunRecord, TokenBudget } from './types.ts'

interface TaskRequirement {
  round: number
  target: string
  comment: string
  adjustments: string[]
  skills: string[]
  viewport?: string
}

interface TaskDescription {
  overview: string
  requirements: TaskRequirement[]
}

interface Detail extends RunRecord {
  tokenBudget: TokenBudget
  taskDescription: TaskDescription
  trace?: string
  diff?: string
  stdout?: string
  stderr?: string
  sessionLogHref?: string
  viewerCommand?: string
  traceHref?: string
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function describeTask(task: LoadedEvalTask): TaskDescription {
  const requirements = task.rounds.flatMap((round, roundIndex) => round.capture.map(annotation => ({
    round: roundIndex + 1,
    target: annotation.target,
    comment: annotation.comment,
    adjustments: (annotation.adjusts ?? []).map(adjustment => `${adjustment.property} → ${adjustment.after}`),
    skills: annotation.selectedSkills ?? [],
    ...(annotation.viewport === undefined ? {} : { viewport: `${annotation.viewport.width}×${annotation.viewport.height}` }),
  })))
  return {
    overview: `${task.fixture} 页面包含 ${requirements.length} 条由插件真实生成的批注，分 ${task.rounds.length} 轮提交。`,
    requirements,
  }
}

function runDetails(record: RunRecord, task: LoadedEvalTask): Detail {
  const detail: Detail = { ...record, tokenBudget: task.tokenBudget, taskDescription: describeTask(task) }
  const linkTo = (file: string): string => relative(RESULTS_PATH, join(record.runDir, file)).split(sep).join('/')
  if (record.runDir !== '' && existsSync(join(record.runDir, 'session.jsonl'))) {
    detail.sessionLogHref = linkTo('session.jsonl')
    detail.viewerCommand = `cd ${shellQuote(REPO_ROOT)} && pnpm eval:view ${shellQuote(join(record.runDir, 'session.jsonl'))}`
  }
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

async function main(): Promise<void> {
  const resultsFile = join(RESULTS_PATH, 'results.jsonl')
  if (!existsSync(resultsFile)) {
    console.error(`no results at ${resultsFile}; run pnpm eval:run first`)
    process.exit(2)
  }
  // Keep the latest grading for one immutable execution. Legacy records are
  // separated by the configuration fields that were previously omitted.
  const parsed = readFileSync(resultsFile, 'utf8').split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as RunRecord)
  const latestByRun = new Map<string, RunRecord>()
  for (const record of parsed) latestByRun.set(record.experimentId ?? [record.taskId, record.arm ?? 'full', record.repetition ?? 1, record.model.provider, record.model.model, record.model.reasoningEffort ?? 'unknown', record.repoCommit, record.harnessCommit].join(':'), record)
  const records = [...latestByRun.values()].sort((a, b) => `${a.taskId}:${a.arm}:${a.repetition}`.localeCompare(`${b.taskId}:${b.arm}:${b.repetition}`))
  const tasks = new Map((await loadTasks()).map(task => [task.id, task]))
  const details = records.map(record => {
    const task = tasks.get(record.taskId)
    if (task === undefined) throw new Error(`result references unknown task ${record.taskId}`)
    return runDetails(record, task)
  })
  const diagnostic = details.filter(record => record.category !== 'protocol-smoke')
  const allEligibleDiagnostic = diagnostic.filter(record => record.diagnosticValidity === 'eligible' && record.experimentId !== undefined && record.executionRevision !== undefined && record.model.reasoningEffort !== undefined)
  const cohortKey = (record: RunRecord): string => [record.model.provider, record.model.model, record.model.reasoningEffort, record.repoCommit, record.harnessCommit, record.executionRevision].join(':')
  const latestEligible = [...allEligibleDiagnostic].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1)
  const currentCohortKey = latestEligible === undefined ? undefined : cohortKey(latestEligible)
  const eligibleDiagnostic = currentCohortKey === undefined ? [] : allEligibleDiagnostic.filter(record => cohortKey(record) === currentCohortKey)
  const smoke = details.filter(record => record.category === 'protocol-smoke')
  const reportDetails = [...smoke, ...eligibleDiagnostic.filter(record => record.arm === 'full')]
    .sort((a, b) => `${a.category}:${a.taskId}:${a.repetition}`.localeCompare(`${b.category}:${b.taskId}:${b.repetition}`))
  const reportTaskIds = new Set(reportDetails.map(record => record.taskId))
  const passedRuns = reportDetails.filter(record => record.status === 'pass').length
  const passedTasks = [...reportTaskIds].filter(taskId => reportDetails.filter(record => record.taskId === taskId).every(record => record.status === 'pass')).length
  const overallPassed = reportDetails.length > 0 && passedTasks === reportTaskIds.size
  const reportSummary = reportDetails.length === 0
    ? '当前评测版本暂无有效运行。'
    : `${passedTasks}/${reportTaskIds.size} 个评测任务通过，${passedRuns}/${reportDetails.length} 次有效运行通过。所有批注均由插件真实生成。`
  const generatedAt = new Date().toISOString()
  const headlineRecords = reportDetails.length === 0 ? details : reportDetails
  const modelLabels = [...new Set(headlineRecords.map(record => [record.model.provider, record.model.model, record.model.reasoningEffort ?? 'effort 未记录'].join(' / ')))]
  const runtimeLabels = [...new Set(headlineRecords.map(record => record.harnessCommit))]

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>dsh-web-review 评测结果</title>
<style>
  :root { --bg:#f6f7f9; --card:#fff; --line:#dfe3e8; --text:#1f2328; --muted:#656d76; --ok:#1a7f37; --bad:#cf222e; --warn:#9a6700; --blue:#0969da; --blue-bg:#eef6ff; }
  * { box-sizing: border-box; }
  body { margin:0; overflow-x:hidden; font-family: system-ui, sans-serif; background:var(--bg); color:var(--text); }
  header { background:var(--card); border-bottom:1px solid var(--line); padding:22px 28px 0; }
  header h1 { margin:0 0 6px; font-size:21px; }
  .meta { color:var(--muted); font-size:13px; }
  .tabs { display:flex; gap:22px; margin-top:20px; }
  .tab { border:0; border-bottom:2px solid transparent; background:none; padding:10px 2px 12px; color:var(--muted); cursor:pointer; font-weight:600; }
  .tab.active { color:var(--text); border-bottom-color:var(--blue); }
  .count { display:inline-block; min-width:20px; margin-left:5px; padding:1px 6px; border-radius:999px; background:#eaeef2; font-size:11px; text-align:center; }
  main { width:100%; min-width:0; padding:24px 28px 48px; }
  .view { display:none; }
  .view.active { display:block; }
  .experiment-head { display:flex; justify-content:space-between; gap:20px; align-items:flex-start; padding:18px 20px; background:var(--card); border:1px solid var(--line); border-radius:12px; }
  .experiment-head h2 { margin:2px 0 7px; font-size:20px; }
  .experiment-head p { margin:0; max-width:850px; line-height:1.55; }
  .verdict { flex:0 0 auto; padding:8px 12px; border-radius:999px; background:#dafbe1; color:var(--ok); font-size:13px; font-weight:700; }
  .verdict.failed { background:#ffebe9; color:var(--bad); }
  .summary-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin:14px 0 22px; }
  .summary-card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; }
  .summary-card .value { margin:3px 0; font-size:27px; font-weight:700; }
  .metric strong { display:block; font-size:14px; }
  .metric span { color:var(--muted); font-size:11px; }
  .section-bar { display:flex; justify-content:space-between; gap:12px; align-items:end; margin:22px 0 10px; }
  .section-bar h2 { margin:0 0 3px; font-size:17px; }
  .section-bar p { margin:0; }
  .filters { display:flex; gap:8px; flex-wrap:wrap; margin:14px 0; }
  .filters select, .filters button { padding:6px 10px; border:1px solid var(--line); border-radius:8px; background:var(--card); font-size:13px; }
  .table-scroll { width:100%; max-width:100%; overflow-x:auto; border:1px solid var(--line); border-radius:10px; background:var(--card); overscroll-behavior-inline:contain; }
  table { width:100%; border-collapse:collapse; background:var(--card); }
  .tasks-table { min-width:1160px; }
  .runs-table { min-width:1450px; }
  th, td { padding:9px 12px; border-bottom:1px solid var(--line); font-size:13px; text-align:left; }
  th { white-space:nowrap; }
  td.task-description { min-width:300px; max-width:430px; white-space:normal; }
  .task-summary { line-height:1.45; }
  .task-summary strong { display:block; margin-bottom:3px; }
  .cell-score { font-weight:700; }
  .cell-sub { color:var(--muted); font-size:11px; margin-top:3px; white-space:nowrap; }
  .requirements { padding-left:22px; }
  .requirements li { margin:8px 0; line-height:1.5; }
  .requirement-meta { color:var(--muted); font-size:12px; }
  th { background:#f0f2f5; font-weight:600; }
  tr:last-child td { border-bottom:0; }
  tr.row { cursor:pointer; }
  tr.row:hover { background:#f6f8fa; }
  .badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; font-weight:600; }
  .pass { background:#dafbe1; color:var(--ok); }
  .fail { background:#ffebe9; color:var(--bad); }
  .timeout, .error { background:#fff8c5; color:var(--warn); }
  .warning { background:#fff8c5; color:var(--warn); }
  tr.token-warning { background:#fffdf0; }
  #detail { position:fixed; inset:0; background:rgba(20,24,28,0.5); display:none; align-items:center; justify-content:center; }
  #detail.open { display:flex; }
  #detail article { background:var(--card); width:min(1180px,94vw); height:92vh; border-radius:12px; padding:20px 24px; overflow:auto; }
  #detail .close { float:right; border:1px solid var(--line); background:none; border-radius:8px; padding:4px 10px; cursor:pointer; }
  .trial { display:grid; grid-template-columns:auto 1fr auto; gap:8px; align-items:center; padding:9px 0; border-top:1px solid var(--line); }
  .trial-metrics { color:var(--muted); font-size:11px; line-height:1.4; }
  pre { background:#f6f8fa; border:1px solid var(--line); border-radius:8px; padding:10px 12px; overflow:auto; font-size:12px; max-height:420px; }
  details { margin:10px 0; }
  summary { cursor:pointer; font-weight:600; font-size:13px; }
  h3 { margin:18px 0 8px; font-size:15px; }
  h2.section { margin:24px 0 10px; font-size:16px; }
  .delta-positive { color:var(--ok); font-weight:600; }
  .delta-negative { color:var(--bad); font-weight:600; }
  .log-actions { display:flex; align-items:center; gap:8px; white-space:nowrap; }
  .link-button { appearance:none; border:0; padding:0; background:none; color:#0969da; text-decoration:underline; font:inherit; cursor:pointer; }
  .empty { padding:28px; text-align:center; color:var(--muted); }
  @media (max-width:900px) { .summary-grid { grid-template-columns:1fr; } .experiment-head { flex-direction:column; } }
</style>
</head>
<body>
<header>
  <h1>dsh-web-review · 插件评测报告</h1>
  <div class="meta">模型配置：<span id="model"></span> · DSH 版本：<span id="runtime"></span> · 生成时间：<span id="generatedAt"></span></div>
  <nav class="tabs">
    <button class="tab active" data-view="overview">评测概览</button>
    <button class="tab" data-view="tasks">任务结果<span class="count">${reportTaskIds.size}</span></button>
    <button class="tab" data-view="runs">运行记录<span class="count">${reportDetails.length}</span></button>
  </nav>
</header>
<main>
  <section class="view active" id="overviewView">
    <div class="experiment-head">
      <div><h2>插件任务验收结果</h2><p>${reportSummary}</p></div>
      <div class="verdict${overallPassed ? '' : ' failed'}">${reportDetails.length === 0 ? '数据不足' : overallPassed ? '通过' : '未通过'}</div>
    </div>
    <div class="summary-grid" id="summaryCards"></div>
    <div class="section-bar"><div><h2>场景覆盖</h2><p class="meta">基础场景覆盖单项与常规批注任务；复杂场景覆盖多目标和源码定位任务。</p></div></div>
    <div class="table-scroll"><table><thead><tr><th>场景类型</th><th>评测任务</th><th>有效运行</th><th>通过运行</th><th>验收状态</th></tr></thead><tbody id="coverageBody"></tbody></table></div>
  </section>
  <section class="view" id="tasksView">
    <div class="experiment-head"><div><h2>评测任务结果</h2><p>任务结果汇总同一任务的有效重复运行。选择任务可查看验收要求和各次运行详情。</p></div><div class="verdict${overallPassed ? '' : ' failed'}">${passedTasks}/${reportTaskIds.size} 个任务通过</div></div>
    <div class="filters"><select id="tKind"><option value="">全部场景</option><option value="basic">基础场景</option><option value="complex">复杂场景</option></select><select id="tStatus"><option value="">全部状态</option><option value="pass">通过</option><option value="fail">未通过</option></select><select id="tDifficulty"><option value="">全部难度</option><option value="easy">简单</option><option value="medium">中等</option><option value="hard">困难</option><option value="long">长任务</option></select><button id="tReset">清除筛选条件</button></div>
    <div class="table-scroll"><table class="tasks-table"><thead><tr><th>评测任务</th><th>场景类型</th><th>验收状态</th><th>重复稳定性</th><th>验收项通过率</th><th>平均执行步骤</th><th>平均输入与输出 Token</th><th>平均 Agent 会话耗时</th><th>运行详情</th></tr></thead><tbody id="tasksBody"></tbody></table></div>
  </section>
  <section class="view" id="runsView">
    <div class="experiment-head"><div><h2>有效运行记录</h2><p>记录当前评测范围内的插件运行，用于复现和故障分析。</p></div><div class="verdict${overallPassed ? '' : ' failed'}">${passedRuns}/${reportDetails.length} 次运行通过</div></div>
    <div class="filters">
      <select id="fCategory"><option value="">全部能力类别</option></select><select id="fDifficulty"><option value="">全部难度</option><option value="easy">简单</option><option value="medium">中等</option><option value="hard">困难</option><option value="long">长任务</option></select>
      <select id="fFixture"><option value="">全部测试页面</option></select><select id="fStatus"><option value="">全部状态</option><option value="pass">通过</option><option value="fail">未通过</option><option value="timeout">超时</option><option value="error">执行错误</option></select><select id="fBudget"><option value="">全部 Token 使用量</option><option value="warning">超过预警阈值</option><option value="normal">未超过预警阈值</option></select><button id="fReset">清除筛选条件</button>
    </div>
    <div class="table-scroll"><table class="runs-table">
    <thead><tr>
      <th>评测任务</th><th>重复序号</th><th>任务摘要</th><th>能力类别</th><th>难度</th><th>测试页面</th><th>验收状态</th>
      <th>Agent 执行步骤</th><th>工具调用</th><th>首次文件写入步骤</th><th>Token 使用量 / 预警阈值</th><th>Agent 会话耗时</th><th>失败归因</th><th>运行详情</th>
    </tr></thead>
    <tbody id="tbody"></tbody>
    </table></div>
  </section>
</main>
<div id="detail"><article>
  <button class="close" aria-label="关闭详情" title="关闭详情" onclick="document.getElementById('detail').classList.remove('open')">✕</button>
  <div id="detailBody"></div>
</article></div>
<script>
const DATA = ${JSON.stringify(reportDetails)};
document.getElementById('model').textContent = ${JSON.stringify(modelLabels.length === 1 ? modelLabels[0] : `${modelLabels.length} 种（详见运行记录）`)};
document.getElementById('runtime').textContent = ${JSON.stringify(runtimeLabels.length === 1 ? runtimeLabels[0] : `${runtimeLabels.length} 个（详见运行记录）`)};
document.getElementById('generatedAt').textContent = new Date(${JSON.stringify(generatedAt)}).toLocaleString('zh-CN', { hour12:false });
const fmt = n => n >= 1000000 ? (n/1000000).toFixed(2)+'M' : n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n);
const budgeted = d => d.process?.tokens ? d.process.tokens.input + d.process.tokens.output : undefined;
const tokenWarning = d => budgeted(d) !== undefined && budgeted(d) > d.tokenBudget.warnAbove;
const STATUS = { pass:'通过', fail:'未通过', timeout:'超时', error:'执行错误' };
const CATEGORY = { 'protocol-smoke':'基础场景', 'multi-target':'多目标修改', 'scope-resolution':'源码范围解析', 'anchor-fallback':'源码锚点回退', responsive:'响应式布局', semantics:'语义与无障碍', iterative:'多轮修改', 'tool-ownership':'修改范围归属', trust:'页面证据可信度' };
const DIFFICULTY = { easy:'简单', medium:'中等', hard:'困难', long:'长任务' };
const ATTRIBUTION = { 'not-modified':'未修改目标实现', localization:'源码定位错误', 'wrong-value':'实现结果不符合验收要求', timeout:'运行超时', 'runtime-error':'评测基础设施错误', unknown:'尚未归因' };
const END_REASON = { completed:'执行完成', 'max-tokens':'达到生成长度限制', cancelled:'执行已取消', error:'执行错误' };
const categories = [...new Set(DATA.map(d => d.category))].sort();
const fixtures = [...new Set(DATA.map(d => d.fixture))].sort();
for (const c of categories) { const o = document.createElement('option'); o.value = c; o.textContent = CATEGORY[c] ?? c; document.getElementById('fCategory').appendChild(o); }
for (const f of fixtures) { const o = document.createElement('option'); o.value = f; o.textContent = f; document.getElementById('fFixture').appendChild(o); }
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const executionKey = d => d.experimentId ?? [d.taskId,d.arm,d.repetition,d.model?.provider,d.model?.model,d.model?.reasoningEffort ?? 'unknown',d.repoCommit,d.harnessCommit].join(':');
const value = (n, digits) => n === undefined || Number.isNaN(n) ? '—' : n.toFixed(digits ?? 0);
const message = (template, values) => Object.entries(values).reduce((output,[key,item])=>output.replaceAll('{'+key+'}',String(item)),template);
async function copyDshCommand(command) {
  try {
    await navigator.clipboard.writeText(command);
    alert('DSH 查看命令已复制。请在终端运行该命令。');
  } catch {
    window.prompt('无法自动复制。请复制以下命令并在终端运行：', command);
  }
}
const average = (rows, read) => rows.length ? rows.reduce((sum,row) => sum + (read(row) ?? 0),0) / rows.length : undefined;
const assertionSummary = rows => { const results=rows.flatMap(d=>d.grader?.results??[]); return { passed:results.filter(result=>result.ok).length, total:results.length }; };
const aggregate = rows => ({ attempts:rows.length, passes:rows.filter(d => d.status === 'pass').length, assertions:assertionSummary(rows), steps:average(rows,d => d.process?.steps), tokens:average(rows,d => budgeted(d)), duration:average(rows,d => d.process?.durationMs===undefined?undefined:d.process.durationMs/1000) });
const taskGroups = new Map();
for (const d of DATA) { const group=taskGroups.get(d.taskId)??{sample:d,runs:[]}; group.runs.push(d); taskGroups.set(d.taskId,group); }
const scenarioKind = d => d.category==='protocol-smoke'?'basic':'complex';
const scenarioLabel = kind => kind==='basic'?'基础场景':'复杂场景';
const statusBadge = status => '<span class="badge '+esc(status)+'">'+esc(STATUS[status]??status)+'</span>';
const taskStatus = runs => runs.every(d=>d.status==='pass')?'pass':'fail';
const summary=aggregate(DATA);
const taskPassed=[...taskGroups.values()].filter(group=>taskStatus(group.runs)==='pass').length;
const tokenWarnings=DATA.filter(tokenWarning).length;
document.getElementById('summaryCards').innerHTML = [
  ['任务通过率',taskPassed+'/'+taskGroups.size],['运行通过率',summary.passes+'/'+summary.attempts],['验收项通过率',summary.assertions.passed+'/'+summary.assertions.total],
  ['Token 预警运行',String(tokenWarnings)],['平均 Agent 执行步骤',value(summary.steps,1)],['平均 Agent 会话耗时',value(summary.duration,1)+' 秒']
].map(item=>'<article class="summary-card"><div class="meta">'+esc(item[0])+'</div><div class="value">'+esc(item[1])+'</div></article>').join('');
document.getElementById('coverageBody').innerHTML = ['basic','complex'].map(kind=>{const rows=DATA.filter(d=>scenarioKind(d)===kind);const tasks=new Set(rows.map(d=>d.taskId));const passed=rows.filter(d=>d.status==='pass').length;return '<tr><td>'+scenarioLabel(kind)+'</td><td>'+tasks.size+'</td><td>'+rows.length+'</td><td>'+passed+'/'+rows.length+'</td><td>'+statusBadge(passed===rows.length?'pass':'fail')+'</td></tr>';}).join('');
function renderTasks() {
  const kind=document.getElementById('tKind').value,status=document.getElementById('tStatus').value,difficulty=document.getElementById('tDifficulty').value;
  const rows=[...taskGroups.entries()].filter(([,group])=>(!kind||scenarioKind(group.sample)===kind)&&(!status||taskStatus(group.runs)===status)&&(!difficulty||group.sample.difficulty===difficulty));
  document.getElementById('tasksBody').innerHTML = rows.length ? rows.map(([taskId,group])=>{const stats=aggregate(group.runs);return '<tr class="row task-row" data-task-id="'+esc(taskId)+'"><td class="task-description"><div class="task-summary"><strong>'+esc(group.sample.title)+'</strong>'+esc(group.sample.taskDescription.overview)+'</div></td><td>'+scenarioLabel(scenarioKind(group.sample))+'</td><td>'+statusBadge(taskStatus(group.runs))+'</td><td>'+esc(message('{passed}/{total} 次运行通过',{passed:stats.passes,total:stats.attempts}))+'</td><td>'+stats.assertions.passed+'/'+stats.assertions.total+'</td><td>'+value(stats.steps,1)+'</td><td>'+fmt(Math.round(stats.tokens??0))+'</td><td>'+value(stats.duration,1)+' 秒</td><td><button class="link-button task-detail" data-task-id="'+esc(taskId)+'">查看运行结果</button></td></tr>';}).join('') : '<tr><td colspan="9" class="empty">没有符合筛选条件的任务。<button class="link-button" id="emptyReset">清除筛选条件</button></td></tr>';
  for(const row of document.querySelectorAll('.task-row'))row.addEventListener('click',()=>openTask(row.dataset.taskId));
  for(const button of document.querySelectorAll('.task-detail'))button.addEventListener('click',event=>{event.stopPropagation();openTask(button.dataset.taskId)});
  if(document.getElementById('emptyReset'))document.getElementById('emptyReset').onclick=resetTaskFilters;
}
function resetTaskFilters(){for(const id of ['tKind','tStatus','tDifficulty'])document.getElementById(id).value='';renderTasks();}
function detailLinks(d) { return d.sessionLogHref ? '<span class="log-actions"><button class="link-button copy-command" data-command="'+esc(d.viewerCommand)+'">复制 DSH 查看命令</button><a href="'+esc(d.sessionLogHref)+'" target="_blank">查看原始会话日志</a></span>' : '—'; }
function render() {
  const fCategory = document.getElementById('fCategory').value;
  const fDifficulty = document.getElementById('fDifficulty').value;
  const fFixture = document.getElementById('fFixture').value;
  const fStatus = document.getElementById('fStatus').value;
  const fBudget = document.getElementById('fBudget').value;
  const rows = DATA.filter(d =>
    (!fCategory || d.category === fCategory) &&
    (!fDifficulty || d.difficulty === fDifficulty) &&
    (!fFixture || d.fixture === fFixture) &&
    (!fStatus || d.status === fStatus) &&
    (!fBudget || (fBudget === 'warning' ? tokenWarning(d) : !tokenWarning(d))));
  document.getElementById('tbody').innerHTML = rows.map(d => {
    const tokens = d.process?.tokens;
    const runKey = executionKey(d);
    const usage = budgeted(d);
    const warning = tokenWarning(d);
    return '<tr class="row' + (warning ? ' token-warning' : '') + '" data-run-key="' + esc(runKey) + '">'
      + '<td>' + esc(d.taskId) + '</td><td>' + esc(d.repetition) + '</td>'
      + '<td class="task-description"><div class="task-summary"><strong>' + esc(d.title) + '</strong>' + esc(d.taskDescription.overview) + '</div></td>'
      + '<td>' + esc(CATEGORY[d.category] ?? d.category) + '</td><td>' + esc(DIFFICULTY[d.difficulty] ?? d.difficulty) + '</td><td>' + esc(d.fixture) + '</td>'
      + '<td><span class="badge ' + d.status + '">' + esc(STATUS[d.status] ?? d.status) + '</span></td>'
      + '<td>' + (d.process?.steps ?? '—') + '</td>'
      + '<td>' + Object.values(d.process?.toolCalls ?? {}).reduce((a,b)=>a+b,0) + '</td>'
      + '<td>' + (d.process?.firstWriteStep ?? '—') + '</td>'
      + '<td>' + (tokens ? fmt(usage)+' / '+fmt(d.tokenBudget.warnAbove) + (warning ? ' <span class="badge warning">超过预警阈值</span>' : '') : '—') + '</td>'
      + '<td>' + (d.process?.durationMs===undefined?'—':(d.process.durationMs/1000).toFixed(0)+' 秒') + '</td>'
      + '<td>' + esc(ATTRIBUTION[d.attribution] ?? d.attribution ?? '') + '</td>'
      + '<td>' + detailLinks(d) + '</td></tr>';
  }).join('');
  for (const row of document.querySelectorAll('#tbody tr[data-run-key]')) row.addEventListener('click', () => openDetail(row.dataset.runKey));
  wireCommands(document.getElementById('tbody'));
}
function wireCommands(root) { for (const button of root.querySelectorAll('.copy-command')) button.addEventListener('click',event=>{event.stopPropagation();copyDshCommand(button.dataset.command)}); for (const link of root.querySelectorAll('a')) link.addEventListener('click',event=>event.stopPropagation()); }
document.getElementById('fCategory').onchange = render;
document.getElementById('fDifficulty').onchange = render;
document.getElementById('fFixture').onchange = render;
document.getElementById('fStatus').onchange = render;
document.getElementById('fBudget').onchange = render;
document.getElementById('fReset').onclick = () => { for (const id of ['fCategory','fDifficulty','fFixture','fStatus','fBudget']) document.getElementById(id).value=''; render(); };
document.getElementById('tKind').onchange=renderTasks;
document.getElementById('tStatus').onchange=renderTasks;
document.getElementById('tDifficulty').onchange=renderTasks;
document.getElementById('tReset').onclick=resetTaskFilters;
function openTask(taskId) {
  const group=taskGroups.get(taskId); if(!group)return;
  const d=group.sample;
  const requirementLines=d.taskDescription.requirements.map(r=>'<li>'+esc(r.comment)+'<div class="requirement-meta">'+esc(['第 '+r.round+' 轮','页面元素：'+r.target,r.viewport?'页面尺寸：'+r.viewport:'',r.adjustments.length?'指定调整：'+r.adjustments.join('，'):''].filter(Boolean).join(' · '))+'</div></li>').join('');
  const stats=aggregate(group.runs);
  const trials=group.runs.map(run=>{const repetition=message('第 {number} 次运行',{number:run.repetition});return '<div class="trial"><span>'+esc(repetition)+'</span><div>'+statusBadge(run.status)+'<div class="trial-metrics">'+(run.process?.steps??'—')+' 步 · '+fmt(budgeted(run)??0)+' Token · '+(run.process?.durationMs===undefined?'—':(run.process.durationMs/1000).toFixed(0)+' 秒')+'</div></div><button class="link-button trial-detail" data-run-key="'+esc(executionKey(run))+'">'+esc('查看'+repetition)+'</button></div>';}).join('');
  const resultSummary=message('{passed}/{total} 次运行通过 · 验收项通过率 {assertionPassed}/{assertionTotal}',{passed:stats.passes,total:stats.attempts,assertionPassed:stats.assertions.passed,assertionTotal:stats.assertions.total});
  document.getElementById('detailBody').innerHTML='<h2>'+esc(d.title)+'</h2><p class="meta">'+esc(taskId)+' · '+esc(scenarioLabel(scenarioKind(d)))+' · '+esc(CATEGORY[d.category]??d.category)+' · '+esc(DIFFICULTY[d.difficulty]??d.difficulty)+' · '+esc(d.fixture)+'</p><h3>任务摘要</h3><p>'+esc(d.taskDescription.overview)+'</p><h3>验收要求</h3><ol class="requirements">'+requirementLines+'</ol><h3>运行结果</h3><p>'+statusBadge(taskStatus(group.runs))+' · '+esc(resultSummary)+'</p>'+trials;
  for(const button of document.querySelectorAll('.trial-detail'))button.addEventListener('click',()=>openDetail(button.dataset.runKey,taskId));
  document.getElementById('detail').classList.add('open');
}
function openDetail(runKey, backTaskId) {
  const d = DATA.find(x => executionKey(x) === runKey);
  if (!d) return;
  const tokens = d.process?.tokens;
  const toolLines = Object.entries(d.process?.toolCalls ?? {}).map(([name,count]) => name + ' × ' + count).join('，');
  const graderLines = (d.grader?.results ?? []).map(r => '<li>' + esc(r.ok ? '✓' : '✗') + ' ' + esc(r.expected) + ' → ' + esc(r.measured) + '</li>').join('');
  const graderPassed = (d.grader?.results ?? []).filter(r => r.ok).length;
  const graderTotal = d.grader?.results?.length ?? 0;
  const requirementLines = d.taskDescription.requirements.map(r => {
    const metadata = ['第 ' + r.round + ' 轮', '页面元素：' + r.target, r.viewport ? '页面尺寸：' + r.viewport : '', r.adjustments.length ? '指定调整：' + r.adjustments.join('，') : '', r.skills.length ? '辅助说明：' + r.skills.join('，') : ''].filter(Boolean).join(' · ');
    return '<li>' + esc(r.comment) + '<div class="requirement-meta">' + esc(metadata) + '</div></li>';
  }).join('');
  document.getElementById('detailBody').innerHTML =
    (backTaskId ? '<p><button class="link-button" id="backToTask">← 返回任务结果</button></p>' : '') + '<h2>' + esc(d.taskId) + ' · ' + esc(d.title) + '</h2>'
    + '<p class="meta">' + esc(d.fixture) + ' / ' + esc(CATEGORY[d.category] ?? d.category) + ' / ' + esc(DIFFICULTY[d.difficulty] ?? d.difficulty)
    + ' · <span class="badge ' + d.status + '">' + esc(STATUS[d.status] ?? d.status) + '</span>'
    + ' · ' + esc(message('第 {number} 次运行',{number:d.repetition})) + '</p>'
    + (d.status === 'pass' ? '' : '<p><strong>失败归因：</strong>' + esc(ATTRIBUTION[d.attribution] ?? d.attribution ?? '尚未归因') + '</p>')
    + '<h3>任务摘要</h3><p>' + esc(d.taskDescription.overview) + '</p><h3>验收要求</h3><ol class="requirements">' + requirementLines + '</ol>'
    + (d.sessionLogHref ? '<p class="log-actions"><button class="link-button" data-command="' + esc(d.viewerCommand) + '" onclick="copyDshCommand(this.dataset.command)">复制 DSH 查看命令</button><a href="' + esc(d.sessionLogHref) + '" target="_blank">查看原始会话日志</a>' + (d.process?.sessionId ? ' <span class="meta">会话 ID：' + esc(d.process.sessionId) + '</span>' : '') + '</p>' : '')
    + '<h3>运行配置与 Token 使用量</h3><p class="meta">' + esc([d.model.provider, d.model.model, d.model.reasoningEffort ? '推理强度 ' + d.model.reasoningEffort : '推理强度未记录'].join(' · ')) + '</p>'
    + '<p class="meta">输入 ' + fmt(tokens?.input ?? 0) + ' · 输出 ' + fmt(tokens?.output ?? 0)
    + ' · 缓存读取/写入 ' + fmt(tokens?.cacheRead ?? 0) + '/' + fmt(tokens?.cacheWrite ?? 0)
    + ' · 推理 ' + fmt(tokens?.reasoning ?? 0)
    + ' · 有用量记录的步骤 ' + (tokens?.stepsWithUsage ?? 0) + '/' + (tokens?.assistantSteps ?? 0) + '</p>'
    + '<p class="meta">输入与输出 Token ' + fmt(budgeted(d) ?? 0) + ' · 预期使用量 ' + fmt(d.tokenBudget.expected) + ' · 预警阈值 ' + fmt(d.tokenBudget.warnAbove)
    + (tokenWarning(d) ? ' <span class="badge warning">超过预警阈值</span>' : '') + '</p>'
    + '<p class="meta">Agent 会话耗时 ' + (d.process?.durationMs===undefined?'—':(d.process.durationMs/1000).toFixed(1)+' 秒') + ' · 端到端运行耗时 ' + (d.durationMs/1000).toFixed(1) + ' 秒</p>'
    + '<h3>执行过程</h3><p class="meta">对话轮次 ' + (d.process?.turns ?? '—') + ' · Agent 执行步骤 ' + (d.process?.steps ?? '—')
    + ' · 首次工具调用步骤 ' + (d.process?.firstToolCallStep ?? '—') + ' · 首次文件写入步骤 ' + (d.process?.firstWriteStep ?? '—')
    + ' · 最终状态：' + esc(END_REASON[d.process?.endReason] ?? d.process?.endReason ?? '未记录') + '</p>'
    + '<p class="meta">工具调用统计：' + esc(toolLines || '无') + '</p>'
    + '<p class="meta">显式读取文件（不含搜索和命令读取）：' + esc((d.process?.filesRead ?? []).join('，') || '无') + '</p>'
    + '<p class="meta">修改文件：' + esc(d.modifiedFiles.join('，') || '无') + '</p>'
    + '<h3>自动验收结果</h3>' + (graderLines ? '<p>验收项通过率 ' + graderPassed + '/' + graderTotal + '。</p><details><summary>查看验收项明细</summary><ul>' + graderLines + '</ul></details>' : '<p class="meta">未记录自动验收结果。</p>')
    + '<h3>模型最终响应</h3><pre>' + esc(d.process?.finalText ?? '') + '</pre>'
    + (d.trace ? '<details><summary>查看完整执行日志</summary>' + (d.traceHref ? '<p><a href="' + esc(d.traceHref) + '" target="_blank">查看完整执行日志</a></p>' : '') + '<pre>' + esc(d.trace) + '</pre></details>' : '')
    + '<details><summary>复现信息</summary><p class="meta">运行 ID：' + esc(d.experimentId ?? '未记录完整运行 ID')
    + ' · 原始验收状态：' + esc(STATUS[d.originalStatus] ?? d.originalStatus ?? '未记录')
    + ' · 最近验收时间：' + esc(d.gradedAt ?? '未记录')
    + ' · 验收规则版本：' + esc(d.graderRevision ?? '未记录')
    + ' · 进程退出码：' + esc(d.exitCode) + '</p></details>'
    + (d.diff ? '<h3>文件变更</h3><pre>' + esc(d.diff) + '</pre>' : '')
    + (d.stderr ? '<details><summary>查看执行错误日志</summary><pre>' + esc(d.stderr) + '</pre></details>' : '');
  document.getElementById('detail').classList.add('open');
  if(backTaskId)document.getElementById('backToTask').onclick=()=>openTask(backTaskId);
}
document.getElementById('detail').addEventListener('click', e => { if (e.target === document.getElementById('detail')) document.getElementById('detail').classList.remove('open'); });
for(const tab of document.querySelectorAll('.tab'))tab.addEventListener('click',()=>{for(const item of document.querySelectorAll('.tab'))item.classList.toggle('active',item===tab);for(const view of document.querySelectorAll('.view'))view.classList.toggle('active',view.id===tab.dataset.view+'View')});
renderTasks(); render();
</script>
</body>
</html>
`
  const outDir = RESULTS_PATH
  mkdirSync(outDir, { recursive: true })
  const out = join(outDir, 'report.html')
  writeFileSync(out, html)
  console.log(`report written: ${out} (${reportTaskIds.size} task(s), ${passedRuns}/${reportDetails.length} run(s) passing)`)
}

void main()
