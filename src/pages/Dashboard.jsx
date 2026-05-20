import { useEffect, useRef, useState } from 'react'
import useMechanismStore from '../store/useMechanismStore'
import {
  forwardKinematicsRaw, velocityAnalysis, accelerationAnalysis,
  computeCouplerCurve, grashofCheck,
} from '../engine/synthesis'

const DEG   = Math.PI / 180
const RAD   = 180 / Math.PI
const SCALE = 3.2

export default function Dashboard() {
  const mechanism = useMechanismStore(s => s.mechanism)

  const canvasRef = useRef(null)
  const animRef   = useRef(null)
  const angleRef  = useRef(0)
  const mechRef   = useRef(mechanism)

  const [angle, setAngle] = useState(0)

  useEffect(() => { mechRef.current = mechanism }, [mechanism])

  // Animation loop
  useEffect(() => {
    let last = performance.now()
    function tick(now) {
      const dt = (now - last) / 1000
      last = now
      angleRef.current = (angleRef.current + dt * 55) % 360
      setAngle(angleRef.current)
      try { drawFrame(angleRef.current, mechRef.current) } catch (_) {}
      animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRef.current)
  }, [])

  function toCanvas(x, y, W, H) {
    return { x: W * 0.32 + x * SCALE, y: H * 0.62 - y * SCALE }
  }

  function drawFrame(ang, mech) {
    const canvas = canvasRef.current
    if (!canvas || !mech?.L1) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    const tc = (x, y) => toCanvas(x, y, W, H)

    ctx.clearRect(0, 0, W, H)

    // ── Background ──
    const bg = ctx.createRadialGradient(W * 0.4, H * 0.5, 20, W * 0.4, H * 0.5, W * 0.75)
    bg.addColorStop(0, '#0c1018')
    bg.addColorStop(1, '#050709')
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)

    // ── Grid ──
    const gs = 40
    ctx.lineWidth = 1
    for (let x = 0; x < W; x += gs) {
      const isMaj = Math.round(x / gs) % 5 === 0
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H)
      ctx.strokeStyle = isMaj ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.015)'
      ctx.stroke()
    }
    for (let y = 0; y < H; y += gs) {
      const isMaj = Math.round(y / gs) % 5 === 0
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y)
      ctx.strokeStyle = isMaj ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.015)'
      ctx.stroke()
    }

    const { L1, L2, L3, L4, O2, O4 } = mech

    // ── Coupler curve (gradient) ──
    const curve = computeCouplerCurve(L1, L2, L3, L4, O2, O4, 360)
    for (let i = 0; i < curve.length - 1; i++) {
      const p1 = tc(curve[i].x,   curve[i].y)
      const p2 = tc(curve[i+1].x, curve[i+1].y)
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y)
      const t = i / curve.length
      ctx.strokeStyle = `hsla(${200 + t * 60},80%,60%,0.35)`
      ctx.lineWidth = 1.5; ctx.stroke()
    }

    // ── FK ──
    const fk = forwardKinematicsRaw(ang * DEG, L1, L2, L3, L4, O2, O4)
    if (!fk) return

    const pO2 = tc(O2.x,   O2.y)
    const pO4 = tc(O4.x,   O4.y)
    const pA  = tc(fk.A.x, fk.A.y)
    const pB  = tc(fk.B.x, fk.B.y)
    const pCP = tc((fk.A.x + fk.B.x) / 2, (fk.A.y + fk.B.y) / 2)

    // ── Ground bar ──
    drawGround(ctx, pO2, pO4)

    // ── Dimension lines ──
    drawDim(ctx, pO2, pA,  `L2=${L2.toFixed(0)}mm`, '#c0392b')
    drawDim(ctx, pA,  pB,  `L3=${L3.toFixed(0)}mm`, '#4a9eff')
    drawDim(ctx, pO4, pB,  `L4=${L4.toFixed(0)}mm`, '#00c851')
    drawGroundDim(ctx, pO2, pO4, `L1=${L1.toFixed(0)}mm`, W, H)

    // ── Links (CAD style) ──
    drawLink(ctx, pO2, pA, '#c0392b', 9)
    drawLink(ctx, pA,  pB, '#2a4878', 7)
    drawLink(ctx, pO4, pB, '#1a4a2a', 9)

    // ── Velocity vectors ──
    const vel = velocityAnalysis(ang, 10, L1, L2, L3, L4, O2, O4)
    if (vel) {
      const vs = 0.55
      drawVec(ctx, pA, vel.VA,  vs, '#00b4ff', 'Va')
      drawVec(ctx, pB, vel.VB,  vs, '#40d0ff', 'Vb')
    }

    // ── Acceleration vectors ──
    const acc = accelerationAnalysis(ang, 10, 0, L1, L2, L3, L4, O2, O4)
    if (acc) {
      const as = 0.035
      drawVec(ctx, pA, acc.AA, as, '#ff9800', 'Aa')
      drawVec(ctx, pB, acc.AB, as, '#ffb74d', 'Ab')
    }

    // ── Pivots ──
    drawPivot(ctx, pO2, '#c0392b', 12, 'O₂', true)
    drawPivot(ctx, pO4, '#00c851', 12, 'O₄', true)
    drawPivot(ctx, pA,  '#4a9eff',  8, 'A',  false)
    drawPivot(ctx, pB,  '#4a9eff',  8, 'B',  false)

    // Coupler midpoint
    ctx.beginPath(); ctx.arc(pCP.x, pCP.y, 5, 0, 2 * Math.PI)
    ctx.fillStyle = '#ff6b6b'; ctx.shadowBlur = 16; ctx.shadowColor = '#ff6b6b'
    ctx.fill(); ctx.shadowBlur = 0

    // Coupler midpoint label
    ctx.fillStyle = '#ff6b6b88'; ctx.font = '10px Consolas,monospace'
    ctx.fillText('P', pCP.x + 9, pCP.y - 6)

    // ── Angle arc on crank ──
    ctx.beginPath()
    ctx.arc(pO2.x, pO2.y, 30, 0, -ang * DEG, ang > 0)
    ctx.strokeStyle = '#c0392b66'; ctx.lineWidth = 1.5; ctx.stroke()
    ctx.fillStyle = '#c0392b88'; ctx.font = 'bold 11px Consolas,monospace'
    ctx.fillText(`${ang.toFixed(0)}°`, pO2.x + 34, pO2.y - 4)

    // ── Theta4 arc on rocker ──
    const t4 = fk.theta4 * RAD
    ctx.beginPath()
    ctx.arc(pO4.x, pO4.y, 26, 0, -t4 * DEG, t4 > 0)
    ctx.strokeStyle = '#00c85166'; ctx.lineWidth = 1.5; ctx.stroke()
    ctx.fillStyle = '#00c85188'; ctx.font = '10px Consolas,monospace'
    ctx.fillText(`${t4.toFixed(0)}°`, pO4.x + 30, pO4.y - 4)
  }

  // ── Draw helpers ────────────────────────────────────────────────

  function drawGround(ctx, p1, p2) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    const nx = -dy / len, ny = dx / len

    ctx.strokeStyle = '#1e2a1e'; ctx.lineWidth = 12; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke()
    ctx.strokeStyle = '#2d3d2d'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke()

    for (let i = 0; i <= 8; i++) {
      const t = i / 8
      const bx = p1.x + t * dx, by = p1.y + t * dy
      ctx.beginPath()
      ctx.moveTo(bx + nx * 10, by + ny * 10)
      ctx.lineTo(bx + nx * 20, by + ny * 20)
      ctx.strokeStyle = '#2d3d2d'; ctx.lineWidth = 1.5; ctx.stroke()
    }
  }

  function drawLink(ctx, p1, p2, color, hw) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    const nx = -dy / len * hw, ny = dx / len * hw

    ctx.beginPath()
    ctx.moveTo(p1.x + nx, p1.y + ny)
    ctx.lineTo(p2.x + nx, p2.y + ny)
    ctx.arc(p2.x, p2.y, hw, Math.atan2(ny, nx), Math.atan2(-ny, -nx), false)
    ctx.lineTo(p1.x - nx, p1.y - ny)
    ctx.arc(p1.x, p1.y, hw, Math.atan2(-ny, -nx), Math.atan2(ny, nx), false)
    ctx.closePath()

    const grad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y)
    grad.addColorStop(0, color + '55')
    grad.addColorStop(0.5, color + '33')
    grad.addColorStop(1, color + '55')
    ctx.fillStyle = grad; ctx.fill()
    ctx.strokeStyle = color + 'cc'; ctx.lineWidth = 1.8
    ctx.shadowBlur = 8; ctx.shadowColor = color + '44'
    ctx.stroke(); ctx.shadowBlur = 0

    // centerline
    ctx.setLineDash([5, 5])
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y)
    ctx.strokeStyle = color + '33'; ctx.lineWidth = 1; ctx.stroke()
    ctx.setLineDash([])
  }

  function drawPivot(ctx, p, color, r, label, isGround) {
    ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, 2 * Math.PI)
    ctx.strokeStyle = color + '22'; ctx.lineWidth = 1; ctx.stroke()

    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI)
    ctx.fillStyle = color + '28'
    ctx.shadowBlur = 14; ctx.shadowColor = color
    ctx.fill()
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke()
    ctx.shadowBlur = 0

    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 2 * Math.PI)
    ctx.fillStyle = color; ctx.fill()

    if (isGround) {
      const th = 16
      ctx.beginPath()
      ctx.moveTo(p.x, p.y + r + 3)
      ctx.lineTo(p.x - th / 2, p.y + r + th + 3)
      ctx.lineTo(p.x + th / 2, p.y + r + th + 3)
      ctx.closePath()
      ctx.strokeStyle = color + '77'; ctx.lineWidth = 1.5; ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(p.x - th / 2 - 5, p.y + r + th + 3)
      ctx.lineTo(p.x + th / 2 + 5, p.y + r + th + 3)
      ctx.strokeStyle = color + '55'; ctx.lineWidth = 2; ctx.stroke()
    }

    if (label) {
      ctx.fillStyle = '#e0ecff'
      ctx.font = 'bold 12px Consolas,monospace'
      ctx.textAlign = 'center'
      ctx.fillText(label, p.x, p.y - r - 10)
      ctx.textAlign = 'left'
    }
  }

  function drawDim(ctx, p1, p2, text, color) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    const nx = -dy / len * 22, ny = dx / len * 22
    const ox1 = p1.x + nx, oy1 = p1.y + ny
    const ox2 = p2.x + nx, oy2 = p2.y + ny

    ctx.save()
    ctx.globalAlpha = 0.45
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([3, 4])
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(ox1, oy1); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(p2.x, p2.y); ctx.lineTo(ox2, oy2); ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(ox1, oy1); ctx.lineTo(ox2, oy2); ctx.stroke()
    dimArrow(ctx, ox1, oy1, ox2, oy2, color)
    dimArrow(ctx, ox2, oy2, ox1, oy1, color)
    ctx.globalAlpha = 0.7
    ctx.fillStyle = color; ctx.font = 'bold 10px Consolas,monospace'
    ctx.textAlign = 'center'
    const bg = ctx.createRadialGradient((ox1+ox2)/2, (oy1+oy2)/2, 0, (ox1+ox2)/2, (oy1+oy2)/2, 30)
    bg.addColorStop(0, '#0c101888')
    bg.addColorStop(1, 'transparent')
    ctx.fillStyle = bg
    ctx.fillRect((ox1+ox2)/2 - 30, (oy1+oy2)/2 - 14, 60, 14)
    ctx.fillStyle = color
    ctx.fillText(text, (ox1 + ox2) / 2, (oy1 + oy2) / 2 - 4)
    ctx.textAlign = 'left'
    ctx.restore()
  }

  function drawGroundDim(ctx, p1, p2, text) {
    const my = Math.max(p1.y, p2.y) + 36
    ctx.save(); ctx.globalAlpha = 0.3
    ctx.strokeStyle = '#888'; ctx.lineWidth = 1; ctx.setLineDash([3, 4])
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y + 8); ctx.lineTo(p1.x, my + 4); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(p2.x, p2.y + 8); ctx.lineTo(p2.x, my + 4); ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(p1.x, my); ctx.lineTo(p2.x, my); ctx.stroke()
    dimArrow(ctx, p1.x, my, p2.x, my, '#888')
    dimArrow(ctx, p2.x, my, p1.x, my, '#888')
    ctx.globalAlpha = 0.55
    ctx.fillStyle = '#aaa'; ctx.font = 'bold 10px Consolas,monospace'
    ctx.textAlign = 'center'
    ctx.fillText(text, (p1.x + p2.x) / 2, my - 5)
    ctx.textAlign = 'left'
    ctx.restore()
  }

  function dimArrow(ctx, x1, y1, x2, y2, color) {
    const a = Math.atan2(y2 - y1, x2 - x1)
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x1 + 7 * Math.cos(a - 0.4), y1 + 7 * Math.sin(a - 0.4))
    ctx.moveTo(x1, y1)
    ctx.lineTo(x1 + 7 * Math.cos(a + 0.4), y1 + 7 * Math.sin(a + 0.4))
    ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.stroke()
  }

  function drawVec(ctx, origin, vec, scale, color, label) {
    if (!vec) return
    const mag = Math.sqrt(vec.x ** 2 + vec.y ** 2)
    if (mag < 0.01) return
    const ex = origin.x + vec.x * scale
    const ey = origin.y - vec.y * scale
    const ang = Math.atan2(ey - origin.y, ex - origin.x)

    ctx.save()
    ctx.globalAlpha = 0.9
    ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(ex, ey)
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineCap = 'round'
    ctx.shadowBlur = 8; ctx.shadowColor = color; ctx.stroke()

    const hs = 11
    ctx.beginPath()
    ctx.moveTo(ex, ey)
    ctx.lineTo(ex - hs * Math.cos(ang - 0.35), ey - hs * Math.sin(ang - 0.35))
    ctx.lineTo(ex - hs * Math.cos(ang + 0.35), ey - hs * Math.sin(ang + 0.35))
    ctx.closePath(); ctx.fillStyle = color; ctx.fill()
    ctx.shadowBlur = 0

    const lx = ex + 9 * Math.cos(ang), ly = ey + 9 * Math.sin(ang)
    const str = `${label}=${mag.toFixed(0)}`
    ctx.font = 'bold 10px Consolas,monospace'
    const tw = ctx.measureText(str).width
    ctx.globalAlpha = 0.7; ctx.fillStyle = '#07090ccc'
    ctx.beginPath(); ctx.roundRect(lx - 2, ly - 12, tw + 8, 15, 3); ctx.fill()
    ctx.globalAlpha = 1; ctx.fillStyle = color
    ctx.fillText(str, lx + 2, ly)
    ctx.restore()
  }

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div style={{
      height: '100%', width: '100%',
      display: 'flex', flexDirection: 'column',
      background: '#050709', overflow: 'hidden', position: 'relative',
    }}>

      {/* ── Full-screen canvas ── */}
      <canvas
        ref={canvasRef}
        width={1400}
        height={820}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />

      {/* ── Credits overlay (top-left) ── */}
      <div style={{
        position: 'absolute', top: 32, left: 36,
        zIndex: 10, pointerEvents: 'none',
      }}>
        {/* Project tag */}
        <div style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '0.35em',
          textTransform: 'uppercase', color: '#c0392b',
          marginBottom: 10,
        }}>
          PIEAS · Mechanics of Machines · CEP
        </div>

        {/* Main title */}
        <div style={{
          fontSize: 72, fontWeight: 900, lineHeight: 0.9,
          letterSpacing: '-3px', color: '#f0f4ff',
          textShadow: '0 0 60px rgba(192,57,43,0.4)',
        }}>
          REHAB<span style={{ color: '#c0392b' }}>LINK</span>
        </div>
        <div style={{
          fontSize: 13, fontWeight: 700, letterSpacing: '0.28em',
          color: '#2a3a4a', marginTop: 6, textTransform: 'uppercase',
        }}>
          CPM Knee Rehabilitation · Linkage Synthesis Platform
        </div>

        {/* Divider */}
        <div style={{
          width: 280, height: 2, marginTop: 22, marginBottom: 20,
          background: 'linear-gradient(90deg,#c0392b,transparent)',
        }} />

        {/* Prepared by */}
        <div style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '0.25em',
          color: '#c0392b', textTransform: 'uppercase', marginBottom: 8,
        }}>
          Prepared By
        </div>
        <div style={{
          fontSize: 26, fontWeight: 900, color: '#e8f0ff',
          letterSpacing: '0.04em', lineHeight: 1.2,
          textShadow: '0 2px 20px rgba(74,158,255,0.2)',
        }}>
          Muhammad Own Raza
        </div>
        <div style={{
          fontSize: 26, fontWeight: 900, color: '#e8f0ff',
          letterSpacing: '0.04em', lineHeight: 1.2,
          textShadow: '0 2px 20px rgba(74,158,255,0.2)',
          marginBottom: 16,
        }}>
          Muhammad Rayyan
        </div>

        {/* Presented to */}
        <div style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '0.25em',
          color: '#c0392b', textTransform: 'uppercase', marginBottom: 6,
        }}>
          Presented To
        </div>
        <div style={{
          fontSize: 18, fontWeight: 800, color: '#c0392b',
          letterSpacing: '0.06em',
        }}>
          Engr. Attique Ahmed
        </div>
        <div style={{
          fontSize: 11, fontWeight: 700, color: '#2a3a4a',
          letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2,
        }}>
          Mechanics of Machines
        </div>
      </div>

      {/* ── Live data readout (bottom-left) ── */}
      <div style={{
        position: 'absolute', bottom: 28, left: 36,
        zIndex: 10, pointerEvents: 'none',
        display: 'flex', gap: 12,
      }}>
        {[
          { label: 'Theta2',  value: `${angle.toFixed(1)}°`,             color: '#c0392b' },
          { label: 'L1',      value: `${(mechanism?.L1 || 0).toFixed(0)} mm`, color: '#4a5568' },
          { label: 'L2 Crank', value: `${(mechanism?.L2 || 0).toFixed(0)} mm`, color: '#c0392b' },
          { label: 'L3 Coupler', value: `${(mechanism?.L3 || 0).toFixed(0)} mm`, color: '#4a9eff' },
          { label: 'L4 Rocker', value: `${(mechanism?.L4 || 0).toFixed(0)} mm`, color: '#00c851' },
        ].map(d => (
          <div key={d.label} style={{
            background: 'rgba(5,7,9,0.85)',
            border: `1px solid ${d.color}33`,
            borderRadius: 8, padding: '7px 14px',
            backdropFilter: 'blur(4px)',
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: d.color + 'aa', marginBottom: 2 }}>
              {d.label.toUpperCase()}
            </div>
            <div style={{ fontSize: 15, fontWeight: 900, fontFamily: 'Consolas,monospace', color: d.color }}>
              {d.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Legend (bottom-right) ── */}
      <div style={{
        position: 'absolute', bottom: 28, right: 32,
        zIndex: 10, pointerEvents: 'none',
        display: 'flex', flexDirection: 'column', gap: 6,
        background: 'rgba(5,7,9,0.8)', border: '1px solid #0f1820',
        borderRadius: 10, padding: '12px 16px',
        backdropFilter: 'blur(6px)',
      }}>
        {[
          { color: '#c0392b', label: 'Crank  (L2)' },
          { color: '#4a9eff', label: 'Coupler (L3)' },
          { color: '#00c851', label: 'Rocker  (L4)' },
          { color: '#888',    label: 'Ground  (L1)' },
          { color: '#00b4ff', label: 'Velocity  V' },
          { color: '#ff9800', label: 'Acceleration  A' },
        ].map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 18, height: 3, background: item.color, borderRadius: 2, flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: item.color + 'cc', letterSpacing: '0.05em' }}>
              {item.label}
            </span>
          </div>
        ))}
      </div>

    </div>
  )
}
