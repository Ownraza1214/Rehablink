import { useEffect, useRef, useCallback } from 'react'
import { forwardKinematics, computeCouplerCurve } from '../engine/synthesis'

const SCALE = 2.5  // px per mm

export default function LinkageCanvas({
  mechanism,
  crankAngle = 0,
  width = 600,
  height = 400,
  showTrail = true,
  showVelocity = false,
  showICs = false,
  instantCenters = null,
  precisionPoints = [],
  velocityData = null,
  style = {},
}) {
  const canvasRef = useRef(null)
  const trailRef  = useRef([])

  // World-to-canvas transform (Y flipped, origin at center-left area)
  const toCanvas = useCallback((x, y, offX = 0, offY = 0) => {
    const cx = width * 0.25 + offX
    const cy = height * 0.65 + offY
    return { x: cx + x * SCALE, y: cy - y * SCALE }
  }, [width, height])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !mechanism) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width
    const H = canvas.height

    ctx.clearRect(0, 0, W, H)

    // â"€â"€ Grid â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'
    ctx.lineWidth = 1
    const gridStep = 25 * SCALE
    for (let x = 0; x < W; x += gridStep) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
    }
    for (let y = 0; y < H; y += gridStep) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
    }
    // Scale bar
    ctx.fillStyle = '#4a5568'
    ctx.font = '10px Consolas,monospace'
    ctx.fillText('25mm', 10, H - 8)
    ctx.strokeStyle = '#4a5568'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(10, H - 14); ctx.lineTo(10 + gridStep, H - 14); ctx.stroke()

    const { L1, L2, L3, L4, O2, O4 } = mechanism

    // â"€â"€ Coupler trail â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    if (showTrail) {
      const curve = computeCouplerCurve(L1, L2, L3, L4, O2, O4, 180)
      if (curve.length > 1) {
        ctx.beginPath()
        let first = true
        for (const pt of curve) {
          const cp = toCanvas((pt.x + pt.A?.x || pt.x) / 1, pt.y)
          const pp = toCanvas(
            (pt.A.x + pt.B.x) / 2,
            (pt.A.y + pt.B.y) / 2,
          )
          if (first) { ctx.moveTo(pp.x, pp.y); first = false }
          else ctx.lineTo(pp.x, pp.y)
        }
        ctx.strokeStyle = 'rgba(0,180,255,0.3)'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
    }

    // â"€â"€ Current kinematics â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    const fk = forwardKinematics(crankAngle, L1, L2, L3, L4, O2, O4)
    if (!fk) return

    const pO2 = toCanvas(O2.x, O2.y)
    const pO4 = toCanvas(O4.x, O4.y)
    const pA  = toCanvas(fk.A.x, fk.A.y)
    const pB  = toCanvas(fk.B.x, fk.B.y)

    const drawLink = (p1, p2, color, width = 4) => {
      ctx.beginPath()
      ctx.moveTo(p1.x, p1.y)
      ctx.lineTo(p2.x, p2.y)
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.lineCap = 'round'
      ctx.stroke()
    }

    const drawPivot = (p, color, r = 7, label = '') => {
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, 2 * Math.PI)
      ctx.fillStyle = color
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'
      ctx.lineWidth = 1
      ctx.stroke()
      if (label) {
        ctx.fillStyle = '#ffffff'
        ctx.font = 'bold 11px Consolas,monospace'
        ctx.fillText(label, p.x + 10, p.y - 6)
      }
    }

    // Ground link (dashed)
    ctx.setLineDash([6, 4])
    drawLink(pO2, pO4, 'rgba(255,255,255,0.15)', 2)
    ctx.setLineDash([])

    // Links
    drawLink(pO2, pA,  '#00b4ff', 5) // crank (L2)
    drawLink(pA,  pB,  '#8b5cf6', 4) // coupler (L3)
    drawLink(pO4, pB,  '#00ff88', 5) // rocker (L4)

    // Pivots
    drawPivot(pO2, '#00b4ff', 8, 'O2')
    drawPivot(pO4, '#00ff88', 8, 'O4')
    drawPivot(pA,  '#ffffff', 6, 'A')
    drawPivot(pB,  '#ffaa00', 6, 'B')

    // â"€â"€ Instant Centers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    if (showICs && instantCenters) {
      const IC_COLORS = {
        I12: '#ff6b6b', I13: '#ffd93d', I14: '#6bcb77',
        I23: '#4d96ff', I24: '#c77dff', I34: '#ff9f1c',
      }
      for (const [key, ic] of Object.entries(instantCenters)) {
        if (!ic) continue
        const p = toCanvas(ic.x, ic.y)
        // Only draw if in canvas bounds
        if (p.x > -20 && p.x < W + 20 && p.y > -20 && p.y < H + 20) {
          ctx.beginPath()
          ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI)
          ctx.fillStyle = IC_COLORS[key] || '#ffffff'
          ctx.fill()
          ctx.fillStyle = '#ffffff'
          ctx.font = 'bold 10px Consolas,monospace'
          ctx.fillText(ic.label || key, p.x + 7, p.y - 4)
        }
      }
    }

    // â"€â"€ Velocity vectors â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    if (showVelocity && velocityData) {
      const arrowScale = 15
      drawArrow(ctx, pA, velocityData.VA, arrowScale, '#00b4ff', 'Vâ‚')
      drawArrow(ctx, pB, velocityData.VB, arrowScale, '#ffaa00', 'V_b')
    }

    // â"€â"€ Precision points â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    for (const pt of precisionPoints) {
      const px = toCanvas(pt.theta_in * SCALE * 0.1, pt.theta_out * SCALE * 0.1)
      ctx.beginPath()
      ctx.arc(px.x, px.y, 5, 0, 2 * Math.PI)
      ctx.fillStyle = '#ffaa00'
      ctx.fill()
    }

    // â"€â"€ Coupler point glow at current position â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
    const cpX = (fk.A.x + fk.B.x) / 2
    const cpY = (fk.A.y + fk.B.y) / 2
    const cp  = toCanvas(cpX, cpY)
    ctx.beginPath()
    ctx.arc(cp.x, cp.y, 4, 0, 2 * Math.PI)
    ctx.fillStyle = '#ff6b6b'
    ctx.shadowBlur = 10
    ctx.shadowColor = '#ff6b6b'
    ctx.fill()
    ctx.shadowBlur = 0

  }, [mechanism, crankAngle, showTrail, showVelocity, showICs, instantCenters, precisionPoints, velocityData, toCanvas])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        width: '100%',
        height: '100%',
        background: 'rgba(0,0,0,0.3)',
        borderRadius: 12,
        ...style,
      }}
    />
  )
}

function drawArrow(ctx, origin, vec, scale, color, label) {
  if (!vec) return
  const mag = Math.sqrt(vec.x * vec.x + vec.y * vec.y)
  if (mag < 0.001) return
  const ex = origin.x + vec.x * scale
  const ey = origin.y - vec.y * scale // canvas Y is flipped
  ctx.beginPath()
  ctx.moveTo(origin.x, origin.y)
  ctx.lineTo(ex, ey)
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.stroke()
  // Arrowhead
  const angle = Math.atan2(ey - origin.y, ex - origin.x)
  ctx.beginPath()
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex - 10 * Math.cos(angle - 0.4), ey - 10 * Math.sin(angle - 0.4))
  ctx.lineTo(ex - 10 * Math.cos(angle + 0.4), ey - 10 * Math.sin(angle + 0.4))
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  if (label) {
    ctx.fillStyle = color
    ctx.font = '10px Consolas,monospace'
    ctx.fillText(label, ex + 5, ey - 5)
  }
}

