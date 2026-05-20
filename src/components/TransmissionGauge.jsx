import { useEffect, useRef } from 'react'

export default function TransmissionGauge({ angle = 45, width = 200, height = 120 }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)

    const cx = W / 2, cy = H - 18, r = Math.min(cx - 10, cy - 10)

    // Track background
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0)
    ctx.lineWidth = 14; ctx.strokeStyle = '#1e1e1e'; ctx.stroke()

    // Red zone 0 - 30deg
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, Math.PI - (30 / 180) * Math.PI)
    ctx.strokeStyle = '#c0392b'; ctx.stroke()

    // Green zone 30 - 180deg
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI - (30 / 180) * Math.PI, 0)
    ctx.strokeStyle = '#27ae60'; ctx.stroke()

    // Needle
    const needleAngle = Math.PI - (Math.min(angle, 180) / 180) * Math.PI
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + (r - 4) * Math.cos(needleAngle), cy + (r - 4) * Math.sin(needleAngle))
    ctx.strokeStyle = '#f0f0f0'; ctx.lineWidth = 2.5; ctx.stroke()

    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 2 * Math.PI)
    ctx.fillStyle = '#f0f0f0'; ctx.fill()

    // Labels
    ctx.font = '9px Consolas,monospace'; ctx.fillStyle = '#444'
    ctx.textAlign = 'left';   ctx.fillText('0deg',   6, cy + 4)
    ctx.textAlign = 'right';  ctx.fillText('180deg', W - 4, cy + 4)
    ctx.textAlign = 'center'; ctx.fillText('90deg',  cx, cy - r + 12)

    // Value
    const ok = angle >= 30
    ctx.fillStyle = ok ? '#27ae60' : '#c0392b'
    ctx.font = 'bold 15px Consolas,monospace'
    ctx.fillText(angle.toFixed(1) + 'deg', cx, cy - 26)
    ctx.fillStyle = '#444'; ctx.font = '10px Inter,sans-serif'
    ctx.fillText(ok ? 'SAFE' : 'DANGER', cx, cy - 12)
  }, [angle])

  return <canvas ref={canvasRef} width={width} height={height} style={{ width: '100%', height: 'auto' }} />
}

