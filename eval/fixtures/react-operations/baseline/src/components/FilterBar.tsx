export function FilterBar() {
  return <section className="filter-bar" aria-label="订单筛选">
    <div className="filter-heading"><strong>筛选订单</strong><span>快速缩小结果范围</span></div>
    <label>状态<select defaultValue="all"><option value="all">全部状态</option><option>待处理</option><option>已发货</option></select></label>
    <label>搜索<input type="search" placeholder="订单号或客户" /></label>
    <button className="button secondary">应用筛选</button>
  </section>
}
