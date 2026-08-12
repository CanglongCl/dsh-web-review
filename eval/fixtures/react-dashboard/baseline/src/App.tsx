function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

const stats = [
  { label: '今日访问', value: '12,480' },
  { label: '活跃用户', value: '3,219' },
  { label: '转化率', value: '24.6%' },
  { label: '总收入', value: '¥86,400' },
]

export function App() {
  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="avatar" aria-label="用户头像">李</div>
        <div className="user-info">
          <div className="username">李明</div>
          <div className="role">产品运营</div>
        </div>
      </header>
      <section className="stats">
        {stats.map((item) => (
          <StatCard key={item.label} label={item.label} value={item.value} />
        ))}
      </section>
    </div>
  )
}
