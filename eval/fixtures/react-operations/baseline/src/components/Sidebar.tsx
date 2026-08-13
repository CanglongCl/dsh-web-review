const items = ['总览', '订单', '客户', '商品', '设置']

export function Sidebar() {
  return <aside className="sidebar" aria-label="主导航">
    <div className="brand">Northstar</div>
    <nav>{items.map(item => <a className={`nav-link${item === '订单' ? ' active' : ''}`} href={`#${item}`} key={item}>{item}</a>)}</nav>
  </aside>
}
