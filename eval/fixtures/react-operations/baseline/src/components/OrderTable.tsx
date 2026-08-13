import type { Order } from '../data.ts'

export function OrderTable({ orders, onOpen }: { orders: Order[]; onOpen: (order: Order) => void }) {
  return <section className="results" aria-labelledby="results-title">
    <div className="results-heading"><div><h2 id="results-title">订单列表</h2><p>共 128 条结果</p></div><button className="button primary">导出数据</button></div>
    <div className="table-scroll"><table><thead><tr><th>订单</th><th>客户</th><th>金额</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>{orders.map(order => <tr key={order.id}><td>{order.id}</td><td>{order.customer}</td><td>{order.amount}</td><td><span className={`status ${order.status}`}>{order.status}</span></td><td className="actions"><button className="button secondary" onClick={() => onOpen(order)}>查看</button><button className="button primary cancel-order">取消订单</button></td></tr>)}</tbody>
    </table></div>
  </section>
}
