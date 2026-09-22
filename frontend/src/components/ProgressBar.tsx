export default function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0
  return (
    <div className="progress-outer">
      <div className="progress-inner" style={{ width: `${pct}%` }} />
    </div>
  )
}
