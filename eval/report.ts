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
    overview: `模型要在 ${task.fixture} 页面中处理 ${requirements.length} 条由插件真实生成的批注，共 ${task.rounds.length} 轮。主要任务：${task.title}。`,
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
  const diagnostic = details.filter(record => record.category !== 'protocol-smoke')
  const allEligibleDiagnostic = diagnostic.filter(record => record.diagnosticValidity === 'eligible' && record.experimentId !== undefined && record.executionRevision !== undefined && record.model.reasoningEffort !== undefined)
  const cohortKey = (record: RunRecord): string => [record.model.provider, record.model.model, record.model.reasoningEffort, record.repoCommit, record.harnessCommit, record.executionRevision].join(':')
  const latestEligible = [...allEligibleDiagnostic].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1)
  const currentCohortKey = latestEligible === undefined ? undefined : cohortKey(latestEligible)
  const eligibleDiagnostic = currentCohortKey === undefined ? [] : allEligibleDiagnostic.filter(record => cohortKey(record) === currentCohortKey)
  const smoke = details.filter(record => record.category === 'protocol-smoke')
  const diagnosticGroupKey = (record: RunRecord): string => [record.taskId, record.repetition, record.model.provider, record.model.model, record.model.reasoningEffort, record.repoCommit, record.harnessCommit, record.taskRevision, record.executionRevision].join(':')
  const diagnosticGroups = new Map<string, Set<RunRecord['arm']>>()
  for (const record of eligibleDiagnostic) {
    const key = diagnosticGroupKey(record)
    const arms = diagnosticGroups.get(key) ?? new Set<RunRecord['arm']>()
    arms.add(record.arm)
    diagnosticGroups.set(key, arms)
  }
  const completeGroupKeys = new Set([...diagnosticGroups].filter(([, arms]) => arms.size === 3).map(([key]) => key))
  const eligiblePaired = eligibleDiagnostic.filter(record => completeGroupKeys.has(diagnosticGroupKey(record)))
  const diagnosticScenarios = new Set(eligiblePaired.map(record => record.taskId)).size
  const pairedGroups = completeGroupKeys.size
  const fullWins = eligiblePaired.filter(record => record.arm === 'full' && record.status === 'pass').length
  const textWins = eligiblePaired.filter(record => record.arm === 'text-only' && record.status === 'pass').length
  const observedLift = eligiblePaired.length === 0 ? undefined : fullWins - textWins
  const observedLiftValue = observedLift ?? 0
  const diagnosticConclusion = eligiblePaired.length === 0
    ? '正式对比还没有可用结果。需要用当前版本重新运行三种输入方式后，才能判断插件有没有帮助。'
    : observedLiftValue === 0
      ? `当前 ${diagnosticScenarios} 道对比题、${pairedGroups} 次重复中，使用插件和只给批注文字的完成数相同，暂时没有观察到插件让模型多完成任务。这说明现有题目还没拉开差距，不代表插件没有价值。`
      : observedLiftValue > 0
        ? `当前 ${diagnosticScenarios} 道对比题、${pairedGroups} 次重复中，使用插件比只给批注文字多完成 ${observedLiftValue} 次，观察到了正向帮助。题目数量仍少，结论暂时只适用于这些场景。`
        : `当前 ${diagnosticScenarios} 道对比题、${pairedGroups} 次重复中，使用插件反而少完成 ${Math.abs(observedLiftValue)} 次，需要先检查失败案例和题目设计，不能据此判断插件有效。`
  const generatedAt = new Date().toISOString()
  const headlineRecords = eligibleDiagnostic.length === 0 ? details : eligibleDiagnostic
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
  .eyebrow { color:var(--muted); font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
  .verdict { flex:0 0 auto; padding:8px 12px; border-radius:999px; background:#fff8c5; color:var(--warn); font-size:13px; font-weight:700; }
  .arm-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin:14px 0 22px; }
  .arm-card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; }
  .arm-card.baseline { border-color:#8c959f; }
  .arm-card.full { border-color:#80bfff; box-shadow:inset 0 3px 0 #54aeff; }
  .arm-name { display:flex; justify-content:space-between; align-items:center; gap:8px; font-weight:700; }
  .role { color:var(--muted); font-size:11px; font-weight:600; }
  .score { margin:15px 0 2px; font-size:27px; font-weight:700; }
  .arm-metrics { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:14px; }
  .metric strong { display:block; font-size:14px; }
  .metric span { color:var(--muted); font-size:11px; }
  .delta { margin-top:12px; color:var(--muted); font-size:12px; }
  .delta-positive { color:var(--ok); font-weight:600; }
  .delta-negative { color:var(--bad); font-weight:600; }
  .section-bar { display:flex; justify-content:space-between; gap:12px; align-items:end; margin:22px 0 10px; }
  .section-bar h2 { margin:0 0 3px; font-size:17px; }
  .section-bar p { margin:0; }
  .filters { display:flex; gap:8px; flex-wrap:wrap; margin:14px 0; }
  .filters select, .filters button { padding:6px 10px; border:1px solid var(--line); border-radius:8px; background:var(--card); font-size:13px; }
  .table-scroll { width:100%; max-width:100%; overflow-x:auto; border:1px solid var(--line); border-radius:10px; background:var(--card); overscroll-behavior-inline:contain; }
  table { width:100%; border-collapse:collapse; background:var(--card); }
  .comparison-table { min-width:1080px; }
  .runs-table { min-width:1500px; }
  th, td { padding:9px 12px; border-bottom:1px solid var(--line); font-size:13px; text-align:left; }
  th { white-space:nowrap; }
  td.task-description { min-width:300px; max-width:430px; white-space:normal; }
  .task-summary { line-height:1.45; }
  .task-summary strong { display:block; margin-bottom:3px; }
  .cell-score { font-weight:700; }
  .cell-sub { color:var(--muted); font-size:11px; margin-top:3px; white-space:nowrap; }
  .baseline-cell { background:#f6f8fa; }
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
  .arm-columns { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin:16px 0; }
  .arm-column { border:1px solid var(--line); border-radius:10px; padding:14px; min-width:0; }
  .arm-column h3 { margin:0 0 10px; }
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
  @media (max-width:900px) { .arm-grid,.arm-columns { grid-template-columns:1fr; } .experiment-head { flex-direction:column; } }
</style>
</head>
<body>
<header>
  <h1>dsh-web-review · 评测结果</h1>
  <div class="meta">模型：<span id="model"></span> · DSH：<span id="runtime"></span> · 生成时间：<span id="generatedAt"></span></div>
  <nav class="tabs">
    <button class="tab active" data-view="comparison">正式对比<span class="count">${diagnosticScenarios}</span></button>
    <button class="tab" data-view="smoke">基础链路<span class="count">${smoke.length}</span></button>
    <button class="tab" data-view="archive">全部运行<span class="count">${details.length}</span></button>
  </nav>
</header>
<main>
  <section class="view active" id="comparisonView">
    <div class="experiment-head">
      <div><div class="eyebrow">Experiment comparison</div><h2>完整插件 vs 只有批注文字</h2><p>${diagnosticConclusion}</p></div>
      <div class="verdict">${eligiblePaired.length === 0 ? '等待结果' : observedLiftValue === 0 ? '结果持平' : observedLiftValue > 0 ? '插件更好' : '需要排查'}</div>
    </div>
    <div class="arm-grid" id="armSummary"></div>
    <div class="section-bar"><div><h2>按题目比较</h2><p class="meta">每道题的 3 次重复已合并。点击一行查看三种输入下的每次运行。</p></div>
      <select id="comparisonFilter"><option value="">全部结果</option><option value="improved">插件更好</option><option value="regressed">插件更差</option><option value="tie">持平</option></select>
    </div>
    <div class="table-scroll"><table class="comparison-table">
      <thead><tr><th>题目</th><th>只有批注文字（基线）</th><th>使用插件</th><th>相对基线</th><th>已知正确位置（上限）</th><th>结论</th></tr></thead>
      <tbody id="comparisonBody"></tbody>
    </table></div>
  </section>
  <section class="view" id="smokeView">
    <div class="experiment-head"><div><div class="eyebrow">Protocol smoke</div><h2>基础批注链路</h2><p>检查插件生成的批注能否被模型接收并完成常规修改。通过只代表链路可用，不代表完整插件比纯文字更好。</p></div><div class="verdict">${smoke.filter(record => record.status === 'pass').length}/${smoke.length} 通过</div></div>
    <div class="section-bar"><div><h2>基础题结果</h2><p class="meta">每行是一道基础题。</p></div></div>
    <div class="table-scroll"><table><thead><tr><th>题目</th><th>要完成什么</th><th>难度</th><th>结果</th><th>步骤</th><th>Token / 预期</th><th>耗时</th><th>过程</th></tr></thead><tbody id="smokeBody"></tbody></table></div>
  </section>
  <section class="view" id="archiveView">
    <div class="experiment-head"><div><div class="eyebrow">Run archive</div><h2>全部运行记录</h2><p>用于复现和排查，包括旧版实验。旧结果可能使用了不同模型、代码或评估规则，不参与正式比较。</p></div><div class="verdict">${details.length} 条记录</div></div>
    <div class="filters">
      <select id="fCategory"><option value="">全部考察内容</option></select><select id="fDifficulty"><option value="">全部难度</option><option value="easy">简单</option><option value="medium">中等</option><option value="hard">困难</option><option value="long">长任务</option></select>
      <select id="fFixture"><option value="">全部测试页面</option></select><select id="fArm"><option value="">全部输入方式</option><option value="full">使用插件</option><option value="text-only">只有批注文字</option><option value="oracle">已知正确位置</option></select>
      <select id="fStatus"><option value="">全部结果</option><option value="pass">完成</option><option value="fail">未完成</option><option value="timeout">超时</option><option value="error">运行出错</option></select><select id="fBudget"><option value="">全部 Token 用量</option><option value="warning">只看超出预期</option><option value="normal">只看预期内</option></select><button id="fReset">重置</button>
    </div>
    <div class="table-scroll"><table class="runs-table">
    <thead><tr>
      <th>题目</th><th>拿到的信息</th><th>第几次</th><th>要完成什么</th><th>主要考察</th><th>难度</th><th>测试页面</th><th>结果</th>
      <th>模型步骤</th><th>工具调用</th><th>从第几步开始改文件</th><th>Token / 预期</th><th>耗时</th><th>没通过的原因</th><th>完整过程</th>
    </tr></thead>
    <tbody id="tbody"></tbody>
    </table></div>
  </section>
</main>
<div id="detail"><article>
  <button class="close" onclick="document.getElementById('detail').classList.remove('open')">✕</button>
  <div id="detailBody"></div>
</article></div>
<script>
const DATA = ${JSON.stringify(details)};
const TOTALS = ${JSON.stringify(totals)};
const CURRENT_COHORT = ${JSON.stringify(currentCohortKey)};
document.getElementById('model').textContent = ${JSON.stringify(modelLabels.length === 1 ? modelLabels[0] : `混合配置（${modelLabels.length} 种）`)};
document.getElementById('runtime').textContent = ${JSON.stringify(runtimeLabels.length === 1 ? runtimeLabels[0] : `混合运行时（${runtimeLabels.length} 种）`)};
document.getElementById('generatedAt').textContent = new Date(${JSON.stringify(generatedAt)}).toLocaleString('zh-CN', { hour12:false });
const fmt = n => n >= 1000000 ? (n/1000000).toFixed(2)+'M' : n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n);
const budgeted = d => d.process?.tokens ? d.process.tokens.input + d.process.tokens.output : undefined;
const tokenWarning = d => budgeted(d) !== undefined && budgeted(d) > d.tokenBudget.warnAbove;
const STATUS = { pass:'完成', fail:'未完成', timeout:'超时', error:'运行出错' };
const ARM = { full:'使用插件', 'text-only':'只有批注文字', oracle:'已知正确位置' };
const CATEGORY = { 'protocol-smoke':'基础链路', 'multi-target':'一次处理多个位置', 'scope-resolution':'判断该改哪里', 'anchor-fallback':'没有源码位置时自行查找', responsive:'不同屏幕尺寸', semantics:'语义和无障碍', iterative:'连续多轮修改', 'tool-ownership':'判断修改哪个项目', trust:'识别不可信页面信息' };
const DIFFICULTY = { easy:'简单', medium:'中等', hard:'困难', long:'长任务' };
const ATTRIBUTION = { 'not-modified':'没有改到目标', localization:'找错了修改位置', 'wrong-value':'改出的结果不符合要求', timeout:'运行超时', 'runtime-error':'DSH 或检查程序出错', unknown:'—' };
const END_REASON = { completed:'正常完成', 'max-tokens':'回复达到长度上限', cancelled:'被取消', error:'运行出错' };
const categories = [...new Set(DATA.map(d => d.category))].sort();
const fixtures = [...new Set(DATA.map(d => d.fixture))].sort();
for (const c of categories) { const o = document.createElement('option'); o.value = c; o.textContent = CATEGORY[c] ?? c; document.getElementById('fCategory').appendChild(o); }
for (const f of fixtures) { const o = document.createElement('option'); o.value = f; o.textContent = f; document.getElementById('fFixture').appendChild(o); }
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const statusScore = d => d?.status === 'pass' ? 1 : 0;
const executionKey = d => d.experimentId ?? [d.taskId,d.arm,d.repetition,d.model?.provider,d.model?.model,d.model?.reasoningEffort ?? 'unknown',d.repoCommit,d.harnessCommit].join(':');
const signed = (n, digits) => n === undefined || Number.isNaN(n) ? '—' : (n > 0 ? '+' : '') + n.toFixed(digits ?? 0);
async function copyDshCommand(command) {
  try {
    await navigator.clipboard.writeText(command);
    alert('已复制命令。粘贴到终端后会用正式版 DSH 打开该对话。');
  } catch {
    window.prompt('复制下面的命令，在终端运行：', command);
  }
}
const paired = new Map();
const cohortKey = d => [d.model.provider,d.model.model,d.model.reasoningEffort,d.repoCommit,d.harnessCommit,d.executionRevision].join(':');
for (const d of DATA.filter(d => d.category !== 'protocol-smoke' && d.diagnosticValidity === 'eligible' && d.experimentId && d.executionRevision && d.model?.reasoningEffort && cohortKey(d) === CURRENT_COHORT)) {
  const key = [d.taskId,d.repetition,d.model.provider,d.model.model,d.model.reasoningEffort,d.repoCommit,d.harnessCommit,d.taskRevision,d.executionRevision].join(':');
  const row = paired.get(key) ?? { taskId:d.taskId, repetition:d.repetition };
  row[d.arm] = d;
  paired.set(key, row);
}
const completePairs = [...paired.values()].filter(row => row.full && row['text-only'] && row.oracle);
const formalRuns = completePairs.flatMap(row => [row['text-only'],row.full,row.oracle]);
const average = (rows, read) => rows.length ? rows.reduce((sum,row) => sum + (read(row) ?? 0),0) / rows.length : undefined;
const aggregate = rows => ({ attempts:rows.length, passes:rows.filter(d => d.status === 'pass').length, steps:average(rows,d => d.process?.steps), tokens:average(rows,d => budgeted(d)), duration:average(rows,d => (d.process?.durationMs ?? d.durationMs)/1000) });
const taskGroups = new Map();
for (const d of formalRuns) { const group = taskGroups.get(d.taskId) ?? { sample:d, full:[], 'text-only':[], oracle:[] }; group[d.arm].push(d); taskGroups.set(d.taskId,group); }
const outcome = group => { const full=aggregate(group.full), text=aggregate(group['text-only']); return full.passes > text.passes ? 'improved' : full.passes < text.passes ? 'regressed' : 'tie'; };
const metricCell = (summary, baseline) => '<div class="cell-score">' + summary.passes + '/' + summary.attempts + ' 完成</div><div class="cell-sub">' + signed(summary.steps,1).replace('+','') + ' 步 · ' + fmt(Math.round(summary.tokens ?? 0)) + ' Token · ' + signed(summary.duration,1).replace('+','') + ' 秒</div>' + (baseline ? '<div class="cell-sub">基线</div>' : '');
function renderArmSummary() {
  const text=aggregate(formalRuns.filter(d=>d.arm==='text-only')), full=aggregate(formalRuns.filter(d=>d.arm==='full')), oracle=aggregate(formalRuns.filter(d=>d.arm==='oracle'));
  const card = (arm,summary,role,base) => '<article class="arm-card ' + (arm==='text-only'?'baseline':arm) + '"><div class="arm-name"><span>' + esc(ARM[arm]) + '</span><span class="role">' + role + '</span></div><div class="score">' + summary.passes + '/' + summary.attempts + '</div><div class="meta">完成次数</div><div class="arm-metrics"><div class="metric"><strong>' + signed(summary.steps,1).replace('+','') + '</strong><span>平均步骤</span></div><div class="metric"><strong>' + fmt(Math.round(summary.tokens ?? 0)) + '</strong><span>平均 Token</span></div><div class="metric"><strong>' + signed(summary.duration,1).replace('+','') + ' 秒</strong><span>平均耗时</span></div></div>' + (base ? '<div class="delta">相对基线：完成 ' + signed(summary.passes-base.passes) + ' · 步骤 ' + signed(summary.steps-base.steps,1) + ' · Token ' + signed(summary.tokens-base.tokens,0) + '</div>' : '<div class="delta">其他输入方式都与此比较</div>') + '</article>';
  document.getElementById('armSummary').innerHTML = card('text-only',text,'基线') + card('full',full,'待验证方案',text) + card('oracle',oracle,'定位信息上限',text);
}
function renderComparison() {
  const filter=document.getElementById('comparisonFilter').value;
  const rows=[...taskGroups.entries()].filter(([,g])=>!filter || outcome(g)===filter);
  document.getElementById('comparisonBody').innerHTML = rows.length ? rows.map(([taskId,g]) => {
    const text=aggregate(g['text-only']), full=aggregate(g.full), oracle=aggregate(g.oracle), result=outcome(g);
    const label=result==='improved'?'插件更好':result==='regressed'?'插件更差':'持平';
    const cls=result==='improved'?'delta-positive':result==='regressed'?'delta-negative':'';
    return '<tr class="row task-row" data-task-id="'+esc(taskId)+'"><td class="task-description"><div class="task-summary"><strong>'+esc(g.sample.title)+'</strong>'+esc(g.sample.taskDescription.overview)+'</div></td><td class="baseline-cell">'+metricCell(text,true)+'</td><td>'+metricCell(full,false)+'</td><td class="'+cls+'"><div>完成 '+signed(full.passes-text.passes)+'</div><div class="cell-sub">步骤 '+signed(full.steps-text.steps,1)+' · Token '+signed(full.tokens-text.tokens,0)+' · 耗时 '+signed(full.duration-text.duration,1)+' 秒</div></td><td>'+metricCell(oracle,false)+'</td><td class="'+cls+'">'+label+'</td></tr>';
  }).join('') : '<tr><td colspan="6" class="empty">没有符合条件的题目</td></tr>';
  for (const row of document.querySelectorAll('.task-row')) row.addEventListener('click',()=>openTask(row.dataset.taskId));
}
function renderSmoke() {
  document.getElementById('smokeBody').innerHTML = DATA.filter(d=>d.category==='protocol-smoke').map(d=>'<tr class="row smoke-row" data-run-key="'+esc(executionKey(d))+'"><td><strong>'+esc(d.taskId)+'</strong></td><td class="task-description">'+esc(d.title)+'</td><td>'+esc(DIFFICULTY[d.difficulty]??d.difficulty)+'</td><td><span class="badge '+d.status+'">'+esc(STATUS[d.status]??d.status)+'</span></td><td>'+(d.process?.steps??'—')+'</td><td>'+(budgeted(d)!==undefined?fmt(budgeted(d))+' / '+fmt(d.tokenBudget.expected)+(tokenWarning(d)?' <span class="badge warning">超出预期</span>':''):'—')+'</td><td>'+((d.process?.durationMs??d.durationMs)/1000).toFixed(0)+' 秒</td><td>'+detailLinks(d)+'</td></tr>').join('');
  for (const row of document.querySelectorAll('.smoke-row')) row.addEventListener('click',()=>openDetail(row.dataset.runKey));
}
function detailLinks(d) { return d.sessionLogHref ? '<span class="log-actions"><button class="link-button copy-command" data-command="'+esc(d.viewerCommand)+'">复制 DSH 命令</button><a href="'+esc(d.sessionLogHref)+'" target="_blank">JSONL</a></span>' : '—'; }
function render() {
  const fCategory = document.getElementById('fCategory').value;
  const fDifficulty = document.getElementById('fDifficulty').value;
  const fFixture = document.getElementById('fFixture').value;
  const fArm = document.getElementById('fArm').value;
  const fStatus = document.getElementById('fStatus').value;
  const fBudget = document.getElementById('fBudget').value;
  const rows = DATA.filter(d =>
    (!fCategory || d.category === fCategory) &&
    (!fDifficulty || d.difficulty === fDifficulty) &&
    (!fFixture || d.fixture === fFixture) &&
    (!fArm || d.arm === fArm) &&
    (!fStatus || d.status === fStatus) &&
    (!fBudget || (fBudget === 'warning' ? tokenWarning(d) : !tokenWarning(d))));
  document.getElementById('tbody').innerHTML = rows.map(d => {
    const tokens = d.process?.tokens;
    const runKey = executionKey(d);
    const usage = budgeted(d);
    const warning = tokenWarning(d);
    return '<tr class="row' + (warning ? ' token-warning' : '') + '" data-run-key="' + esc(runKey) + '">'
      + '<td>' + esc(d.taskId) + '</td><td>' + esc(ARM[d.arm] ?? d.arm) + '</td><td>' + esc(d.repetition) + '</td>'
      + '<td class="task-description"><div class="task-summary"><strong>' + esc(d.title) + '</strong>' + esc(d.taskDescription.overview) + '</div></td>'
      + '<td>' + esc(CATEGORY[d.category] ?? d.category) + '</td><td>' + esc(DIFFICULTY[d.difficulty] ?? d.difficulty) + '</td><td>' + esc(d.fixture) + '</td>'
      + '<td><span class="badge ' + d.status + '">' + esc(STATUS[d.status] ?? d.status) + '</span></td>'
      + '<td>' + (d.process?.steps ?? '—') + '</td>'
      + '<td>' + Object.values(d.process?.toolCalls ?? {}).reduce((a,b)=>a+b,0) + '</td>'
      + '<td>' + (d.process?.firstWriteStep ?? '—') + '</td>'
      + '<td>' + (tokens ? fmt(usage)+' / '+fmt(d.tokenBudget.expected) + (warning ? ' <span class="badge warning">超出预期</span>' : '') : '—') + '</td>'
      + '<td>' + (d.durationMs/1000).toFixed(0) + ' 秒</td>'
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
document.getElementById('fArm').onchange = render;
document.getElementById('fStatus').onchange = render;
document.getElementById('fBudget').onchange = render;
document.getElementById('fReset').onclick = () => { for (const id of ['fCategory','fDifficulty','fFixture','fArm','fStatus','fBudget']) document.getElementById(id).value=''; render(); };
function openTask(taskId) {
  const group=taskGroups.get(taskId); if(!group)return;
  const d=group.sample;
  const requirementLines=d.taskDescription.requirements.map(r=>'<li>'+esc(r.comment)+'<div class="requirement-meta">'+esc(['第 '+r.round+' 轮','页面元素：'+r.target,r.viewport?'页面尺寸：'+r.viewport:'',r.adjustments.length?'指定调整：'+r.adjustments.join('，'):''].filter(Boolean).join(' · '))+'</div></li>').join('');
  const column=arm=>{const rows=group[arm], summary=aggregate(rows); return '<section class="arm-column"><h3>'+esc(ARM[arm])+'</h3>'+metricCell(summary,arm==='text-only')+rows.map(run=>'<div class="trial"><span>第 '+run.repetition+' 次</span><div><span class="badge '+run.status+'">'+esc(STATUS[run.status]??run.status)+'</span><div class="trial-metrics">'+(run.process?.steps??'—')+' 步 · '+fmt(budgeted(run)??0)+' Token · '+((run.process?.durationMs??run.durationMs)/1000).toFixed(0)+' 秒</div></div><button class="link-button trial-detail" data-run-key="'+esc(executionKey(run))+'">查看详情</button></div>').join('')+'</section>';};
  document.getElementById('detailBody').innerHTML='<h2>'+esc(d.title)+'</h2><p class="meta">'+esc(taskId)+' · '+esc(CATEGORY[d.category]??d.category)+' · '+esc(DIFFICULTY[d.difficulty]??d.difficulty)+' · '+esc(d.fixture)+'</p><h3>题目要求</h3><p>'+esc(d.taskDescription.overview)+'</p><ol class="requirements">'+requirementLines+'</ol><h3>三种输入的运行结果</h3><div class="arm-columns">'+column('text-only')+column('full')+column('oracle')+'</div>';
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
    (backTaskId ? '<p><button class="link-button" id="backToTask">← 返回题目对比</button></p>' : '') + '<h2>' + esc(d.taskId) + ' · ' + esc(d.title) + '</h2>'
    + '<p class="meta">' + esc(d.fixture) + ' / ' + esc(CATEGORY[d.category] ?? d.category) + ' / ' + esc(DIFFICULTY[d.difficulty] ?? d.difficulty)
    + ' · <span class="badge ' + d.status + '">' + esc(STATUS[d.status] ?? d.status) + '</span>'
    + ' · 输入方式：' + esc(ARM[d.arm] ?? d.arm) + ' · 第 ' + esc(d.repetition) + ' 次运行 · ' + (d.durationMs/1000).toFixed(1) + ' 秒</p>'
    + (d.status === 'pass' ? '' : '<p><strong>没通过的原因：</strong>' + esc(ATTRIBUTION[d.attribution] ?? d.attribution ?? '暂未判断') + '</p>')
    + '<h3>模型要完成什么</h3><p>' + esc(d.taskDescription.overview) + '</p><ol class="requirements">' + requirementLines + '</ol>'
    + (d.sessionLogHref ? '<p class="log-actions"><button class="link-button" data-command="' + esc(d.viewerCommand) + '" onclick="copyDshCommand(this.dataset.command)">复制“用正式版 DSH 查看”命令</button><a href="' + esc(d.sessionLogHref) + '" target="_blank">打开原始 JSONL</a>' + (d.process?.sessionId ? ' <span class="meta">会话：' + esc(d.process.sessionId) + '</span>' : '') + '</p>' : '')
    + '<h3>模型和 Token 用量</h3><p class="meta">' + esc([d.model.provider, d.model.model, d.model.reasoningEffort ? '推理强度 ' + d.model.reasoningEffort : '推理强度未记录'].join(' · ')) + '</p>'
    + '<p class="meta">输入 ' + fmt(tokens?.input ?? 0) + ' · 输出 ' + fmt(tokens?.output ?? 0)
    + ' · 缓存读取/写入 ' + fmt(tokens?.cacheRead ?? 0) + '/' + fmt(tokens?.cacheWrite ?? 0)
    + ' · 推理 ' + fmt(tokens?.reasoning ?? 0)
    + ' · 有用量记录的步骤 ' + (tokens?.stepsWithUsage ?? 0) + '/' + (tokens?.assistantSteps ?? 0) + '</p>'
    + '<p class="meta">本报告用“输入 + 输出”判断是否超出预期：实际 ' + fmt(budgeted(d) ?? 0) + ' · 通常预期 ' + fmt(d.tokenBudget.expected) + ' · 超过 ' + fmt(d.tokenBudget.warnAbove) + ' 时提醒'
    + (tokenWarning(d) ? ' <span class="badge warning">超出预期</span>' : '') + '</p>'
    + '<h3>模型是怎么做的</h3><p class="meta">共 ' + (d.process?.turns ?? '—') + ' 轮对话、' + (d.process?.steps ?? '—') + ' 个模型步骤'
    + ' · 第 ' + (d.process?.firstToolCallStep ?? '—') + ' 步首次使用工具 · 第 ' + (d.process?.firstWriteStep ?? '—') + ' 步开始改文件'
    + ' · 最终状态：' + esc(END_REASON[d.process?.endReason] ?? d.process?.endReason ?? '未记录') + '</p>'
    + '<p class="meta">使用过的工具：' + esc(toolLines || '无') + '</p>'
    + '<p class="meta">模型明确打开过的文件（不含搜索和命令读取）：' + esc((d.process?.filesRead ?? []).join('，') || '无') + '</p>'
    + '<p class="meta">最终修改的文件：' + esc(d.modifiedFiles.join('，') || '无') + '</p>'
    + '<h3>自动检查结果</h3>' + (graderLines ? '<p>通过 ' + graderPassed + '/' + graderTotal + ' 项检查。</p><details><summary>查看每项检查的技术明细</summary><ul>' + graderLines + '</ul></details>' : '<p class="meta">没有自动检查结果</p>')
    + '<h3>模型最终回复</h3><pre>' + esc(d.process?.finalText ?? '') + '</pre>'
    + (d.trace ? '<details><summary>查看模型思考和完整工具调用</summary>' + (d.traceHref ? '<p><a href="' + esc(d.traceHref) + '" target="_blank">在单独页面打开</a></p>' : '') + '<pre>' + esc(d.trace) + '</pre></details>' : '')
    + '<details><summary>复现和排查信息</summary><p class="meta">运行 ID：' + esc(d.experimentId ?? '旧记录（没有完整运行 ID）')
    + ' · 当时结果：' + esc(STATUS[d.originalStatus] ?? d.originalStatus ?? '未记录')
    + ' · 最近检查时间：' + esc(d.gradedAt ?? '未记录')
    + ' · 检查规则版本：' + esc(d.graderRevision ?? '未记录')
    + ' · 进程退出码：' + esc(d.exitCode) + '</p></details>'
    + (d.diff ? '<h3>文件改动摘要</h3><pre>' + esc(d.diff) + '</pre>' : '')
    + (d.stderr ? '<details><summary>查看运行错误输出</summary><pre>' + esc(d.stderr) + '</pre></details>' : '');
  document.getElementById('detail').classList.add('open');
  if(backTaskId)document.getElementById('backToTask').onclick=()=>openTask(backTaskId);
}
document.getElementById('detail').addEventListener('click', e => { if (e.target === document.getElementById('detail')) document.getElementById('detail').classList.remove('open'); });
for(const tab of document.querySelectorAll('.tab'))tab.addEventListener('click',()=>{for(const item of document.querySelectorAll('.tab'))item.classList.toggle('active',item===tab);for(const view of document.querySelectorAll('.view'))view.classList.toggle('active',view.id===tab.dataset.view+'View')});
document.getElementById('comparisonFilter').onchange=renderComparison;
renderArmSummary(); renderComparison(); renderSmoke(); wireCommands(document.getElementById('smokeBody'));
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
