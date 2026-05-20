export default function MetricCard({ label, value, unit, color = '#c0392b', icon }) {
  return (
    <div style={{
      background: '#111',
      border: '1px solid #1e1e1e',
      borderRadius: 10,
      padding: '16px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: color }} />
      <div style={{ paddingLeft: 8 }}>
        <div style={{ color: '#444', fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 6 }}>
          {icon && <span style={{ marginRight: 5 }}>{icon}</span>}{label}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 30, fontWeight: 900, fontFamily: 'Consolas,monospace', color: '#f0f0f0' }}>
            {value}
          </span>
          {unit && <span style={{ fontSize: 12, color: '#444', letterSpacing: '0.05em' }}>{unit}</span>}
        </div>
      </div>
    </div>
  )
}

