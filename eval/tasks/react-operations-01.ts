import { loadFrozenRound } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const frozen = loadFrozenRound('react-operations-01', 1, import.meta.url)

export const task: EvalTask = {
  id: 'react-operations-01',
  fixture: 'react-operations',
  fixtureKind: 'react',
  category: 'multi-target',
  difficulty: 'long',
  title: '处理运营后台的六条关联批注',
  arms: ['full', 'text-only', 'oracle'],
  rounds: [{
    prompt: '请根据页面批注修改前端实现。',
    capture: [
      {
        target: '.nav-link.active',
        comment: '当前所在栏目不够醒目。只增强选中态：增加深一点的底色，并在左侧加一条 #7aa2ff 的强调线；不要改变其他导航项。',
        selectedSkills: ['better-interface'],
      },
      {
        target: '.filter-bar',
        comment: '筛选区和结果卡片混在一起了。把这里做成浅蓝灰色的独立筛选面板，边框也更明确，内部留白增加到 20px。',
        adjusts: [{ property: 'background-color', after: '#eef3fb' }],
        targetPosition: { xRatio: 0.5, yRatio: 0.08 },
      },
      {
        target: '.metrics',
        comment: '三张指标卡之间太挤，卡片间距和这一组上下留白都调整到 24px。',
        adjusts: [{ property: 'gap', after: '24px' }],
        targetPosition: { xRatio: 0.335, yRatio: 0.5 },
      },
      {
        target: 'tbody tr:first-child .cancel-order',
        comment: '“取消订单”是危险操作，所有订单行里的这个操作都使用危险按钮样式；不要影响“导出数据”和“新建订单”。',
      },
      {
        target: '.drawer h2',
        comment: '手机宽度下标题太长会挤掉关闭按钮。窄屏时保持单行并用省略号截断，关闭按钮必须始终可见。',
        viewport: { width: 390, height: 844 },
      },
      {
        target: '.filter-heading span',
        comment: '手机端筛选区只保留标题和说明，状态、搜索框与应用按钮先隐藏；桌面端保持完整。',
        viewport: { width: 390, height: 844 },
      },
    ],
    oracleContext: [
      '- Navigation selected-state styles live in src/styles.css and the item markup is owned by src/components/Sidebar.tsx.',
      '- Filter and responsive rules live in src/styles.css; FilterBar markup is in src/components/FilterBar.tsx.',
      '- Shared order action markup is in src/components/OrderTable.tsx. Add a danger variant rather than changing every primary button.',
      '- Drawer markup is in src/components/OrderDrawer.tsx and its narrow-screen behavior belongs in the existing media query.',
    ].join('\n'),
    ...frozen,
  }],
  grader: {
    pass: [
      {
        kind: 'dom', selector: '.nav-link.active',
        styleDiffersFrom: { selector: '.nav-link:not(.active)', properties: ['background-color'] },
        colorLuminance: { property: 'background-color', max: 100 },
        leftAccentColor: '#7aa2ff',
      },
      { kind: 'dom', selector: '.filter-bar', style: { 'background-color': '#eef3fb', padding: '20px' }, styleGreaterThan: { 'border-width': '0px' } },
      { kind: 'dom', selector: '.metrics', style: { gap: '24px', 'margin-top': '24px', 'margin-bottom': '24px' } },
      { kind: 'dom', selector: '.actions button:last-child', text: '取消订单', colorDominance: { property: 'background-color', channel: 'red', margin: 20 }, all: true },
      { kind: 'dom', selector: '.drawer h2', style: { overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' }, viewport: { width: 390, height: 844 } },
      { kind: 'dom', selector: '.drawer .icon-button', visible: true, doesNotOverlap: '.drawer h2', viewport: { width: 390, height: 844 } },
      { kind: 'dom', selector: '.filter-bar label', style: { display: 'none' }, viewport: { width: 390, height: 844 }, all: true },
      { kind: 'dom', selector: '.filter-bar > .button', style: { display: 'none' }, viewport: { width: 390, height: 844 } },
      { kind: 'dom', selector: '.filter-heading strong', visible: true, viewport: { width: 390, height: 844 } },
      { kind: 'dom', selector: '.filter-heading span', visible: true, viewport: { width: 390, height: 844 } },
    ],
    noRegression: [
      { kind: 'dom', selector: '.page-heading .primary', style: { 'background-color': '#3267d6' } },
      { kind: 'dom', selector: '.results-heading .primary', style: { 'background-color': '#3267d6' } },
      { kind: 'dom', selector: '.nav-link:not(.active)', style: { 'background-color': 'rgba(0, 0, 0, 0)' } },
      { kind: 'dom', selector: '.filter-bar label', style: { display: 'grid' }, viewport: { width: 1280, height: 900 }, all: true },
    ],
    negative: ['!important'],
  },
  golden: { kind: 'git-patch', patchFile: 'golden.patch' },
}
