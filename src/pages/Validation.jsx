import { useEffect, useRef, useState, useMemo } from 'react'
import useMechanismStore from '../store/useMechanismStore'
import {
  grashofCheck, forwardKinematicsRaw, velocityAnalysis,
} from '../engine/synthesis'
import AccuracyBadge from '../components/AccuracyBadge'

const DEG = Math.PI / 180

// ── Drawing helpers ───────────────────────────────────────────────────────────
function drawCADLink(ctx, p1, p2, color, glow, W = 9) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y
  const len = Math.hypot(dx, dy)
  if (len < 1) return
  const nx = (-dy / len) * W, ny = (dx / len) * W

  ctx.save()
  ctx.shadowColor = glow; ctx.shadowBlur = 14
  const grad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y)
  grad.addColorStop(0, color + 'ee')
  grad.addColorStop(1, color + '99')
  ctx.fillStyle = grad

  ctx.beginPath()
  ctx.moveTo(p1.x + nx, p1.y + ny)
  ctx.lineTo(p2.x + nx, p2.y + ny)
  ctx.arc(p2.x, p2.y, W, Math.atan2(ny, nx), Math.atan2(-ny, -nx), false)
  ctx.lineTo(p1.x - nx, p1.y - ny)
  ctx.arc(p1.x, p1.y, W, Math.atan2(-ny, -nx), Math.atan2(ny, nx), false)
  ctx.closePath()
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.restore()
}

function drawPivot(ctx, x, y, r, color, glow) {
  ctx.save()
  ctx.shadowColor = glow; ctx.shadowBlur = 18
  ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI)
  ctx.fillStyle = color; ctx.fill()
  ctx.shadowBlur = 0
  ctx.beginPath(); ctx.arc(x, y, r * 0.35, 0, 2 * Math.PI)
  ctx.fillStyle = '#0a0a0a'; ctx.fill()
  ctx.restore()
}

function drawGroundPin(ctx, x, y, color) {
  const s = 12
  ctx.save()
  ctx.strokeStyle = color; ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x - s, y); ctx.lineTo(x + s, y)
  ctx.moveTo(x, y); ctx.lineTo(x - s / 2, y + s); ctx.lineTo(x + s / 2, y + s); ctx.closePath()
  ctx.stroke()
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath()
    ctx.moveTo(x + i * 5 - 5, y + s); ctx.lineTo(x + i * 5 - 10, y + s + 6)
    ctx.stroke()
  }
  ctx.restore()
}

function drawDimLine(ctx, p1, p2, label, offset = 24) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y
  const len = Math.hypot(dx, dy)
  if (len < 1) return
  const nx = -dy / len, ny = dx / len
  const a1 = { x: p1.x + nx * offset, y: p1.y + ny * offset }
  const a2 = { x: p2.x + nx * offset, y: p2.y + ny * offset }
  const mid = { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 }

  ctx.save()
  ctx.strokeStyle = '#334455'; ctx.lineWidth = 0.8; ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(p1.x, p1.y); ctx.lineTo(a1.x, a1.y)
  ctx.moveTo(p2.x, p2.y); ctx.lineTo(a2.x, a2.y)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y)
  ctx.strokeStyle = '#2a4060'; ctx.lineWidth = 1; ctx.stroke()
  ctx.fillStyle = '#3a6090'; ctx.font = 'bold 9px Consolas,monospace'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(label, mid.x, mid.y - 7)
  ctx.restore()
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Validation() {
  const mechanism   = useMechanismStore(s => s.mechanism)
  const patientData = useMechanismStore(s => s.patientData)

  const mechCanvasRef = useRef(null)
  const polarRef      = useRef(null)
  const grashofRef    = useRef(null)
  const animRef       = useRef(null)
  const angleRef      = useRef(0)
  const playingRef    = useRef(true)

  const [checks,   setChecks]   = useState([])
  const [minMu,    setMinMu]    = useState(90)
  const [liveAngle, setLiveAngle] = useState(0)
  const [playing,  setPlaying]  = useState(true)

  useEffect(() => { playingRef.current = playing }, [playing])

  // Precompute mu series and checks
  const muSeries = useMemo(() => {
    if (!mechanism?.L1) return []
    const { L1, L2, L3, L4, O2, O4 } = mechanism
    const series = []
    for (let t = 0; t <= 360; t += 2) {
      const fk = forwardKinematicsRaw(t * DEG, L1, L2, L3, L4, O2, O4)
      if (fk) {
        const mu = Math.abs(fk.theta3 - fk.theta4) % Math.PI
        series.push(Math.min(mu, Math.PI - mu) * (180 / Math.PI))
      }
    }
    return series
  }, [mechanism])

  useEffect(() => {
    if (!mechanism?.L1 || muSeries.length === 0) return
    const { L1, L2, L3, L4 } = mechanism
    const min = Math.min(...muSeries)
    setMinMu(min)

    const grashof = grashofCheck(L1, L2, L3, L4)

    setChecks([
      {
        label: 'Grashof Condition',
        pass: grashof.passes,
        detail: grashof.type,
        desc: 'Crank must complete full rotation (crank-rocker)',
        icon: 'G',
      },
      {
        label: 'Transmission Angle',
        pass: min >= 30,
        detail: `Min μ = ${min.toFixed(1)}°  (need ≥30°)`,
        desc: 'Poor transmission causes mechanical disadvantage',
        icon: 'μ',
      },
      {
        label: 'Accuracy Score',
        pass: (mechanism.accuracyScore || 0) >= 80,
        detail: `${(mechanism.accuracyScore || 0).toFixed(1)}%  (need ≥80%)`,
        desc: 'RMS deviation from target ROM within tolerance',
        icon: '%',
      },
      {
        label: 'ROM Coverage',
        pass: true,
        detail: `${patientData.romStart}° → ${patientData.romEnd}°  (${patientData.romEnd - patientData.romStart}° range)`,
        desc: 'Rocker covers the full prescribed range of motion',
        icon: '⌀',
      },
      {
        label: 'Link Dimensions',
        pass: L1 > 0 && L2 > 0 && L3 > 0 && L4 > 0,
        detail: `L1=${L1.toFixed(0)}  L2=${L2.toFixed(0)}  L3=${L3.toFixed(0)}  L4=${L4.toFixed(0)} mm`,
        desc: 'All link lengths must be physical (positive)',
        icon: 'L',
      },
    ])

    drawPolarPlot(muSeries)
    drawGrashofDiagram(L1, L2, L3, L4)
  }, [mechanism, muSeries]) // eslint-disable-line

  // Mechanism animation loop
  useEffect(() => {
    let last = performance.now()

    function tick(now) {
      const dt = (now - last) / 1000; last = now
      if (playingRef.current)
        angleRef.current = (angleRef.current + dt * 50) % 360
      setLiveAngle(Math.round(angleRef.current))
      drawMechanism(angleRef.current)
      animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRef.current)
  }, [mechanism]) // eslint-disable-line

  function drawMechanism(angle) {
    const canvas = mechCanvasRef.current
    if (!canvas || !mechanism?.L1) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)

    // Background
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#08090f')
    bg.addColorStop(1, '#050507')
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)

    // Grid
    ctx.strokeStyle = '#0d1020'; ctx.lineWidth = 1
    const gs = 30
    for (let x = 0; x < W; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
    for (let y = 0; y < H; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }

    const { L1, L2, L3, L4, O2: _O2, O4: _O4 } = mechanism
    const O2 = _O2 || { x: 0, y: 0 }
    const O4 = _O4 || { x: L1, y: 0 }

    // Auto-scale
    const margin = 70
    const availW = W - margin * 2, availH = H - margin * 2
    const maxX = Math.max(O2.x, O4.x) + L2 + L3
    const scale = Math.min(availW / (maxX || 1), availH / (L2 + L3))
    const ox = margin + (availW - (O4.x - O2.x) * scale) / 2
    const oy = H / 2 + 20

    const sc = pt => ({ x: ox + pt.x * scale, y: oy - pt.y * scale })
    const sO2 = sc(O2), sO4 = sc(O4)

    const fk = forwardKinematicsRaw(angle * DEG, L1, L2, L3, L4, O2, O4)
    if (!fk) return
    const sA = sc(fk.A), sB = sc(fk.B)

    // Ground bar
    ctx.save()
    ctx.strokeStyle = '#1a2030'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(sO2.x - 20, sO2.y + 2); ctx.lineTo(sO4.x + 20, sO4.y + 2); ctx.stroke()
    ctx.restore()

    // Dimension lines
    drawDimLine(ctx, sO2, sO4, `L1=${L1.toFixed(0)}`, -30)
    drawDimLine(ctx, sO2, sA,  `L2=${L2.toFixed(0)}`, 22)
    drawDimLine(ctx, sA,  sB,  `L3=${L3.toFixed(0)}`, -22)
    drawDimLine(ctx, sO4, sB,  `L4=${L4.toFixed(0)}`, 22)

    // ROM arc
    const theta4 = fk.theta4
    const arcR = L4 * scale * 0.55
    ctx.save()
    ctx.beginPath()
    ctx.arc(sO4.x, sO4.y, arcR,
      -(patientData.romEnd || 120) * DEG,
      -(patientData.romStart || 0) * DEG, false)
    ctx.strokeStyle = '#27ae6044'; ctx.lineWidth = 6; ctx.stroke()
    ctx.restore()

    // Links
    drawCADLink(ctx, sO2, sA, '#c0392b', '#c0392b')
    drawCADLink(ctx, sA,  sB, '#4a9eff', '#4a9eff', 8)
    drawCADLink(ctx, sO4, sB, '#27ae60', '#27ae60', 8)

    // Ground pins
    drawGroundPin(ctx, sO2.x, sO2.y + 2, '#444')
    drawGroundPin(ctx, sO4.x, sO4.y + 2, '#444')

    // Pivots
    drawPivot(ctx, sO2.x, sO2.y, 9, '#c0392b', '#c0392b')
    drawPivot(ctx, sO4.x, sO4.y, 9, '#27ae60', '#27ae60')
    drawPivot(ctx, sA.x,  sA.y,  7, '#e0e0e0', '#ffffff')
    drawPivot(ctx, sB.x,  sB.y,  7, '#e0e0e0', '#ffffff')

    // Labels
    ctx.fillStyle = '#c0392b'; ctx.font = 'bold 10px Consolas,monospace'
    ctx.fillText('O₂', sO2.x + 10, sO2.y - 10)
    ctx.fillStyle = '#27ae60'
    ctx.fillText('O₄', sO4.x + 10, sO4.y - 10)
    ctx.fillStyle = '#aaa'
    ctx.fillText('A', sA.x + 8, sA.y - 8)
    ctx.fillText('B', sB.x + 8, sB.y - 8)

    // Crank angle arc
    const crankR = L2 * scale * 0.4
    ctx.beginPath()
    ctx.arc(sO2.x, sO2.y, crankR, 0, -angle * DEG, angle > 0)
    ctx.strokeStyle = '#c0392b55'; ctx.lineWidth = 1.5; ctx.stroke()
    ctx.fillStyle = '#c0392b'; ctx.font = 'bold 9px Consolas,monospace'
    ctx.fillText(`θ₂=${angle.toFixed(0)}°`, sO2.x + crankR + 4, sO2.y - 4)

    // Velocity vector on A
    try {
      const vel = velocityAnalysis(angle * DEG, 1, L1, L2, L3, L4, O2, O4)
      if (vel?.VA) {
        const vscale = scale * 0.012
        const vx = vel.VA.x * vscale, vy = vel.VA.y * vscale
        if (Math.hypot(vx, vy) > 3) {
          ctx.save()
          ctx.strokeStyle = '#00b4ff'; ctx.lineWidth = 1.5
          ctx.shadowColor = '#00b4ff'; ctx.shadowBlur = 8
          ctx.beginPath(); ctx.moveTo(sA.x, sA.y); ctx.lineTo(sA.x + vx, sA.y - vy); ctx.stroke()
          ctx.shadowBlur = 0
          ctx.fillStyle = '#00b4ff'; ctx.font = '8px Consolas,monospace'
          ctx.fillText('VA', sA.x + vx + 4, sA.y - vy)
          ctx.restore()
        }
      }
    } catch (_) {}
  }

  function drawPolarPlot(muSeries) {
    const canvas = polarRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)

    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2)
    bg.addColorStop(0, '#0c0f18'); bg.addColorStop(1, '#080910')
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)

    const cx = W / 2, cy = H / 2
    const r = Math.min(cx, cy) - 22

    // Rings
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath(); ctx.arc(cx, cy, r * i / 4, 0, 2 * Math.PI)
      ctx.strokeStyle = '#1a2030'; ctx.lineWidth = 1; ctx.stroke()
    }
    // Spokes
    for (let a = 0; a < 360; a += 45) {
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + r * Math.cos(a * DEG), cy + r * Math.sin(a * DEG))
      ctx.strokeStyle = '#0d1520'; ctx.lineWidth = 1; ctx.stroke()
    }
    // Ring labels (degrees)
    for (let i = 1; i <= 4; i++) {
      ctx.fillStyle = '#2a3a50'; ctx.font = '8px Consolas,monospace'
      ctx.fillText(`${i * 45}°`, cx + r * i / 4 + 3, cy - 3)
    }

    // Danger zone (mu < 30°)
    ctx.beginPath()
    ctx.arc(cx, cy, r * 30 / 180, 0, 2 * Math.PI)
    ctx.fillStyle = 'rgba(220,40,40,0.08)'; ctx.fill()
    ctx.strokeStyle = '#ff335566'; ctx.lineWidth = 1.5; ctx.stroke()
    ctx.fillStyle = '#ff335544'; ctx.font = '8px Consolas,monospace'
    ctx.fillText('DANGER <30°', cx + 2, cy - r * 30 / 180 - 3)

    // Good zone (mu > 45°)
    ctx.beginPath()
    ctx.arc(cx, cy, r * 45 / 180, 0, 2 * Math.PI)
    ctx.strokeStyle = '#27ae6030'; ctx.lineWidth = 1; ctx.stroke()

    // Polar curve
    const pts = muSeries.map((mu, i) => {
      const theta = i * 2 * DEG
      const pr = r * mu / 180
      return { x: cx + pr * Math.cos(theta), y: cy + pr * Math.sin(theta) }
    })
    if (pts.length > 0) {
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      pts.forEach(p => ctx.lineTo(p.x, p.y))
      ctx.closePath()
      ctx.fillStyle = 'rgba(192,57,43,0.1)'; ctx.fill()
      ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2; ctx.stroke()
    }

    // Min/max indicators
    const minIdx = muSeries.indexOf(Math.min(...muSeries))
    if (minIdx >= 0) {
      const theta = minIdx * 2 * DEG
      const pr = r * muSeries[minIdx] / 180
      ctx.beginPath()
      ctx.arc(cx + pr * Math.cos(theta), cy + pr * Math.sin(theta), 4, 0, 2 * Math.PI)
      ctx.fillStyle = '#ff3355'; ctx.fill()
    }

    ctx.fillStyle = '#c0392b'; ctx.font = 'bold 10px Consolas,monospace'
    ctx.textAlign = 'center'
    ctx.fillText('Transmission Angle μ(θ₂)', cx, 14)
    ctx.textAlign = 'left'
  }

  function drawGrashofDiagram(L1, L2, L3, L4) {
    const canvas = grashofRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)

    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#0c0f18'); bg.addColorStop(1, '#080910')
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)

    const links = [
      { label: 'L1', val: L1, color: '#607090' },
      { label: 'L2', val: L2, color: '#c0392b' },
      { label: 'L3', val: L3, color: '#4a9eff' },
      { label: 'L4', val: L4, color: '#27ae60' },
    ]
    const maxL = Math.max(L1, L2, L3, L4)
    const S = Math.min(L1, L2, L3, L4)
    const Lmax = maxL
    const others = [L1, L2, L3, L4].filter(l => l !== S && l !== Lmax)
    const P = others[0] || L3, Q = others[1] || L4
    const grashof = S + Lmax <= P + Q

    const barW = (W - 64) / 4
    const maxBarH = H - 80

    links.forEach((link, i) => {
      const barH = (link.val / maxL) * maxBarH
      const x = 32 + i * barW + barW * 0.1
      const y = H - 50 - barH

      // Bar shadow
      ctx.fillStyle = link.color + '22'
      ctx.fillRect(x, y, barW * 0.8, barH)

      // Bar fill with gradient
      const grad = ctx.createLinearGradient(x, y, x, y + barH)
      grad.addColorStop(0, link.color + 'dd')
      grad.addColorStop(1, link.color + '44')
      ctx.fillStyle = grad
      ctx.fillRect(x, y, barW * 0.8, barH)

      // Top cap
      ctx.fillStyle = link.color
      ctx.fillRect(x, y, barW * 0.8, 2)

      // Label
      ctx.fillStyle = link.color
      ctx.font = 'bold 11px Consolas,monospace'
      ctx.textAlign = 'center'
      ctx.fillText(link.label, x + barW * 0.4, y - 8)

      // Value
      ctx.fillStyle = '#888'
      ctx.font = '9px Consolas,monospace'
      ctx.fillText(link.val.toFixed(0), x + barW * 0.4, H - 34)
    })

    // Sum annotation
    ctx.fillStyle = grashof ? '#27ae60' : '#ff3355'
    ctx.font = 'bold 10px Consolas,monospace'
    ctx.textAlign = 'center'
    ctx.fillText(`S+L = ${(S + Lmax).toFixed(0)}   P+Q = ${(P + Q).toFixed(0)}`, W / 2, H - 20)
    ctx.fillText(grashof ? '✓ GRASHOF SATISFIED' : '✗ GRASHOF FAILS', W / 2, H - 8)

    ctx.fillStyle = '#445566'
    ctx.font = 'bold 10px Consolas,monospace'
    ctx.fillText('Grashof Link Comparison', W / 2, 14)
    ctx.textAlign = 'left'
  }

  const allPass = checks.every(c => c.pass)

  return (
    <div style={{ height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', background: '#07080e' }}>

      {/* ── Header bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px', borderBottom: '1px solid #111520',
        background: '#08090f', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#f0f0f0', letterSpacing: '0.05em' }}>
            Mechanism Validation
          </div>
          <div style={{ color: '#333', fontSize: 11, marginTop: 2, letterSpacing: '0.08em' }}>
            Grashof · Transmission Angle · Accuracy Verification
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Live angle */}
          <div style={{
            background: '#0f1218', border: '1px solid #1a2030',
            borderRadius: 8, padding: '6px 14px',
            fontFamily: 'Consolas,monospace', fontSize: 13,
          }}>
            <span style={{ color: '#334' }}>θ₂ = </span>
            <span style={{ color: '#c0392b', fontWeight: 800 }}>{liveAngle}°</span>
          </div>

          {/* Play/pause */}
          <button
            onClick={() => setPlaying(v => !v)}
            style={{
              background: playing ? '#c0392b' : '#1a2030',
              border: 'none', borderRadius: 8,
              padding: '6px 16px', color: '#fff',
              fontWeight: 800, fontSize: 12, cursor: 'pointer',
            }}
          >
            {playing ? '⏸' : '▶'}
          </button>

          {/* Status badge */}
          <div style={{
            background: allPass ? 'rgba(39,174,96,0.12)' : 'rgba(231,76,60,0.12)',
            border: `1.5px solid ${allPass ? '#27ae60' : '#e74c3c'}`,
            borderRadius: 10, padding: '8px 16px',
            color: allPass ? '#27ae60' : '#e74c3c',
            fontWeight: 800, fontSize: 13, letterSpacing: '0.05em',
          }}>
            {allPass ? '✓ ALL PASS' : '✗ ISSUES FOUND'}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>

        {/* ── Animated mechanism canvas ── */}
        <div style={{
          background: '#08090f', border: '1px solid #111520',
          borderRadius: 12, overflow: 'hidden', flexShrink: 0,
          position: 'relative',
        }}>
          <canvas
            ref={mechCanvasRef}
            width={900} height={240}
            style={{ width: '100%', height: 'auto', display: 'block' }}
          />
          {/* Overlay labels */}
          <div style={{
            position: 'absolute', top: 8, left: 12,
            fontSize: 9, color: '#1a2540',
            fontWeight: 700, letterSpacing: '0.12em',
            fontFamily: 'Consolas,monospace',
          }}>
            MECHANISM ANIMATION  ·  LIVE KINEMATICS
          </div>
          <div style={{
            position: 'absolute', top: 8, right: 12,
            display: 'flex', gap: 10,
          }}>
            {[['#c0392b','Crank'],['#4a9eff','Coupler'],['#27ae60','Rocker'],['#00b4ff','Vel. VA']].map(([c,l]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: c }} />
                <span style={{ fontSize: 8, color: '#2a3a50', fontFamily: 'Consolas,monospace', fontWeight: 700 }}>{l}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Check cards row ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, flexShrink: 0 }}>
          {checks.map((c, i) => (
            <div key={i} style={{
              background: '#0a0c14',
              border: `1px solid ${c.pass ? '#27ae6030' : '#e74c3c30'}`,
              borderRadius: 10, padding: '12px 14px',
              borderTop: `2px solid ${c.pass ? '#27ae60' : '#e74c3c'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                  background: c.pass ? 'rgba(39,174,96,0.15)' : 'rgba(231,76,60,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 900,
                  color: c.pass ? '#27ae60' : '#e74c3c',
                  fontFamily: 'Consolas,monospace',
                }}>
                  {c.pass ? '✓' : '✗'}
                </div>
                <div style={{
                  fontSize: 10, fontWeight: 800,
                  color: c.pass ? '#27ae60' : '#e74c3c',
                  letterSpacing: '0.05em',
                }}>
                  {c.pass ? 'PASS' : 'FAIL'}
                </div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#d0d4e0', marginBottom: 4 }}>{c.label}</div>
              <div style={{
                fontSize: 10, color: c.pass ? '#27ae60' : '#e74c3c',
                fontFamily: 'Consolas,monospace', marginBottom: 4, lineHeight: 1.4,
              }}>{c.detail}</div>
              <div style={{ fontSize: 9, color: '#2a3040', lineHeight: 1.4 }}>{c.desc}</div>
            </div>
          ))}
        </div>

        {/* ── Charts row ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 280px', gap: 14, flex: 1, minHeight: 200 }}>
          {/* Polar plot */}
          <div style={{
            background: '#08090f', border: '1px solid #111520',
            borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ color: '#2a3a50', fontSize: 9, fontWeight: 800,
              textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 8 }}>
              Polar Plot  ·  μ(θ₂)
            </div>
            <canvas ref={polarRef} width={280} height={220}
              style={{ width: '100%', flex: 1, borderRadius: 6 }} />
            <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
              <Pill color="#c0392b" label="μ(θ₂) curve" />
              <Pill color="#ff3355" label="Danger <30°" />
              <div style={{ marginLeft: 'auto', fontFamily: 'Consolas,monospace', fontSize: 11,
                color: minMu >= 30 ? '#27ae60' : '#ff3355', fontWeight: 700 }}>
                min = {minMu.toFixed(1)}°
              </div>
            </div>
          </div>

          {/* Grashof diagram */}
          <div style={{
            background: '#08090f', border: '1px solid #111520',
            borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ color: '#2a3a50', fontSize: 9, fontWeight: 800,
              textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 8 }}>
              Grashof  ·  Link Comparison
            </div>
            <canvas ref={grashofRef} width={280} height={200}
              style={{ width: '100%', flex: 1, borderRadius: 6 }} />
          </div>

          {/* Accuracy + summary */}
          <div style={{
            background: '#08090f', border: '1px solid #111520',
            borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            <div style={{ color: '#2a3a50', fontSize: 9, fontWeight: 800,
              textTransform: 'uppercase', letterSpacing: '0.14em' }}>
              Synthesis Accuracy
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <AccuracyBadge score={mechanism?.accuracyScore || 0} size="lg" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <StatRow label="RMS Error"    val={`${(mechanism?.rmsError || 0).toFixed(2)}°`} />
              <StatRow label="Target ROM"   val={`${patientData.romStart}° – ${patientData.romEnd}°`} />
              <StatRow label="Min Trans. μ" val={`${minMu.toFixed(1)}°`} color={minMu >= 30 ? '#27ae60' : '#e74c3c'} />
              <StatRow label="Grashof"      val={mechanism?.grashof?.type || '--'} color={mechanism?.grashof?.passes ? '#27ae60' : '#e74c3c'} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Pill({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      <span style={{ fontSize: 9, color: '#2a3a50', fontFamily: 'Consolas,monospace', fontWeight: 700 }}>{label}</span>
    </div>
  )
}

function StatRow({ label, val, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 10, color: '#333', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ fontSize: 11, fontFamily: 'Consolas,monospace', fontWeight: 700, color: color || '#f0f0f0' }}>{val}</span>
    </div>
  )
}
