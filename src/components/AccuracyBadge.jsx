export default function AccuracyBadge({ score, size = 'md' }) {
  const ok   = score >= 80
  const warn = score >= 60 && score < 80
  const color = ok ? '#27ae60' : warn ? '#f39c12' : '#c0392b'
  const bg    = ok ? 'rgba(39,174,96,0.1)' : warn ? 'rgba(243,156,18,0.1)' : 'rgba(192,57,43,0.1)'
  const pad   = size === 'lg' ? '10px 22px' : '4px 12px'
  const fs    = size === 'lg' ? 20 : 11

  return (
    <span style={{
      background: bg,
      color,
      border: `1px solid ${color}44`,
      borderRadius: 6,
      padding: pad,
      fontSize: fs,
      fontWeight: 800,
      fontFamily: 'Consolas,monospace',
      letterSpacing: '0.05em',
      whiteSpace: 'nowrap',
    }}>
      {score.toFixed(1)}% {ok ? 'v' : 'x'}
    </span>
  )
}

