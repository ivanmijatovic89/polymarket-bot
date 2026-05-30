export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`bg-card border border-border rounded-lg p-4 ${className}`}>{children}</div>
  )
}

export function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card>
      <div className="text-muted text-xs uppercase tracking-wider">{label}</div>
      <div className="text-3xl font-bold mt-2 leading-none">{value}</div>
    </Card>
  )
}
