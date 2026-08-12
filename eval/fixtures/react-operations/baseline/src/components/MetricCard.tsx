interface MetricCardProps { label: string; value: string; delta: string }

export function MetricCard({ label, value, delta }: MetricCardProps) {
  return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{delta}</small></article>
}
