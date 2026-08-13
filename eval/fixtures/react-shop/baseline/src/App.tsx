interface Product {
  id: number
  title: string
  price: string
}

const products: Product[] = [
  { id: 1, title: '星空投影灯', price: '¥129' },
  { id: 2, title: '磁悬浮音箱', price: '¥299' },
  { id: 3, title: '复古机械键盘', price: '¥459' },
  { id: 4, title: '桌面苔藓盆栽', price: '¥89' },
  { id: 5, title: '便携咖啡手冲壶', price: '¥158' },
  { id: 6, title: '云朵氛围夜灯', price: '¥69' },
]

export function App() {
  return (
    <div className="page">
      <header className="header">
        <h1 className="shop-title">魔法商店</h1>
        <p className="shop-subtitle">精选好物 · 限时特惠</p>
      </header>
      <main className="products">
        {products.map((product) => (
          <article key={product.id} className="product-card">
            <h2 className="product-title">{product.title}</h2>
            <p className="price">{product.price}</p>
            <button className="buy" type="button">加入购物车</button>
          </article>
        ))}
      </main>
    </div>
  )
}
