import type { Order } from '../data.ts'

export function OrderDrawer({ order, onClose }: { order: Order; onClose: () => void }) {
  return <div className="drawer-backdrop"><aside className="drawer" aria-label="订单详情">
    <header><div><span>订单详情</span><h2>{order.id} · {order.customer} · 企业采购与定制服务</h2></div><button className="icon-button" aria-label="关闭详情" onClick={onClose}>×</button></header>
    <dl><div><dt>客户</dt><dd>{order.customer}</dd></div><div><dt>金额</dt><dd>{order.amount}</dd></div><div><dt>状态</dt><dd>{order.status}</dd></div></dl>
  </aside></div>
}
