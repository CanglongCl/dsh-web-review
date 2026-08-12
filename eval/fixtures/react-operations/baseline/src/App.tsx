import { useState } from 'react'
import { FilterBar } from './components/FilterBar.tsx'
import { MetricCard } from './components/MetricCard.tsx'
import { OrderDrawer } from './components/OrderDrawer.tsx'
import { OrderTable } from './components/OrderTable.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { orders, type Order } from './data.ts'

export function App() {
  const [selected, setSelected] = useState<Order | null>(orders[0]!)
  return <div className="app-shell"><Sidebar /><main className="main-content">
    <header className="page-heading"><div><p>运营工作台</p><h1>订单管理</h1></div><button className="button primary">新建订单</button></header>
    <FilterBar />
    <section className="metrics" aria-label="订单指标"><MetricCard label="今日订单" value="128" delta="较昨日 +12%" /><MetricCard label="待处理" value="24" delta="需要及时跟进" /><MetricCard label="本月成交" value="¥842,600" delta="目标完成 76%" /></section>
    <OrderTable orders={orders} onOpen={setSelected} />
  </main>{selected !== null && <OrderDrawer order={selected} onClose={() => setSelected(null)} />}</div>
}
