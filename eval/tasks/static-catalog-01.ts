import { loadFrozenRound } from './frozen.ts'
import type { EvalTask } from '../types.ts'

const frozen = loadFrozenRound('static-catalog-01', 1, import.meta.url)

export const task: EvalTask = {
  id: 'static-catalog-01', fixture: 'static-catalog', fixtureKind: 'static', category: 'anchor-fallback', difficulty: 'long',
  title: '在无框架源码锚点时定位重复商品节点',
  arms: ['full', 'text-only', 'oracle'],
  rounds: [{
    prompt: '请根据页面批注修改前端实现。',
    capture: [
      { target: '.sold-out .a1b2c3_action', comment: '只有缺货商品的按钮文案改成“到货提醒”，其余三个商品按钮保持原样。', adjusts: [{ property: 'text', after: '到货提醒' }] },
      { target: '.a1b2c3_price', comment: '所有商品价格都提升到 18px，不要改商品标题和描述字号。', adjusts: [{ property: 'font-size', after: '18px' }] },
      { target: '.a1b2c3_favorite', comment: '这些心形按钮没有可访问名称。每张卡都按“收藏 + 商品名”补上 aria-label，图标继续对读屏隐藏。', selectedSkills: ['better-accessibility'] },
      { target: '.a1b2c3_productCard.featured', comment: '只给精选的第一张卡增加 2px 的 #7a5af8 边框，其他产品卡不变。', targetPosition: { xRatio: 0.02, yRatio: 0.55 } },
      { target: '.a1b2c3_catalogGrid', comment: '手机端一行只显示一张产品卡；桌面端仍然保持四列。', viewport: { width: 390, height: 844 }, targetPosition: { xRatio: 0.5, yRatio: 0.002 } },
    ],
    oracleContext: [
      '- Product markup is in index.html. The sold-out card is the article with class sold-out.',
      '- Shared catalog visuals and the mobile media query are in styles.css.',
      '- Apply price sizing to .a1b2c3_price, the featured border to .a1b2c3_productCard.featured, and the mobile column rule to .a1b2c3_catalogGrid.',
    ].join('\n'),
    ...frozen,
  }],
  grader: {
    pass: [
      { kind: 'dom', selector: '.sold-out .a1b2c3_action', text: '到货提醒' },
      { kind: 'dom', selector: '.a1b2c3_price', style: { 'font-size': '18px' }, all: true },
      { kind: 'dom', selector: '.a1b2c3_favorite', accessibleNamePattern: '^收藏\\s*\\S+', all: true },
      { kind: 'dom', selector: '.a1b2c3_favorite span', attr: { name: 'aria-hidden', value: 'true' }, all: true },
      { kind: 'dom', selector: '.a1b2c3_productCard.featured', style: { 'border-width': '2px', 'border-color': '#7a5af8' } },
      { kind: 'dom', selector: '.a1b2c3_catalogGrid', style: { 'grid-template-columns': '334px' }, viewport: { width: 390, height: 844 }, tolerance: 2 },
    ],
    noRegression: [
      { kind: 'dom', selector: '.a1b2c3_productCard:not(.featured)', style: { 'border-width': '1px', 'border-color': '#ded9d0' }, all: true },
      { kind: 'dom', selector: '.a1b2c3_productCard:not(.sold-out) .a1b2c3_action', text: '加入购物袋', all: true },
      { kind: 'dom', selector: '.a1b2c3_productCard h2', style: { 'font-size': '17px' }, all: true },
      { kind: 'dom', selector: '.a1b2c3_catalogGrid', style: { 'grid-template-columns': '254px 254px 254px 254px' }, viewport: { width: 1120, height: 900 }, tolerance: 3 },
    ],
    negative: ['!important'],
  },
  golden: { kind: 'html-dir', dir: 'golden' },
}
