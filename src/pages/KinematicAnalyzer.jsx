import { useEffect, useRef, useState, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from 'recharts'
import useMechanismStore from '../store/useMechanismStore'
import {
  forwardKinematicsRaw, velocityAnalysis, accelerationAnalysis,
  computeInstantCenters, computeCouplerCurve,
} from '../engine/synthesis'

const DEG    = Math.PI / 180
const RAD    = 180 / Math.PI
const OMEGA2 = 10   // rad/s

// ── colour palette ────────────────────────────────────────────────
const C = {
  crank:   '#c0392b',
  coupler: '#4a9eff',
  rocker:  '#00c851',
  ground:  '#3a4a5a',
  VA:      '#00b4ff',
  VB:      '#40d8ff',
  VBA:     '#80d0ff',
  AA:      '#ff9800',
  AB:      '#ffb74d',
  AAn:     '#ff6d00',
  AAt:     '#ffd54f',
  IC:      ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#c77dff','#ff9f1c'],
}

export default function KinematicAnalyzer() {
  const mechanism = useMechanismStore(s => s.mechanism)

  const mechCanvasRef = useRef(null)
  const velCanvasRef  = useRef(null)
  const accCanvasRef  = useRef(null)
  const animRef       = useRef(null)
  const angleRef      = useRef(0)
  const mechRef       = useRef(mechanism)

  const [liveAngle, setLiveAngle]     = useState(0)
  const [playing,   setPlaying]       = useState(true)
  const [speed,     setSpeed]         = useState(1)
  const [overlay,   setOverlay]       = useState('both')   // vel | acc | both | ic
  const [showCurve, setShowCurve]     = useState(true)

  const playingRef = useRef(playing)
  const speedRef   = useRef(speed)
  const overlayRef = useRef(overlay)
  const showCurveRef = useRef(showCurve)

  useEffect(() => { mechRef.current    = mechanism },  [mechanism])
  useEffect(() => { playingRef.current = playing },    [playing])
  useEffect(() => { speedRef.current   = speed },      [speed])
  useEffect(() => { overlayRef.current = overlay },    [overlay])
  useEffect(() => { showCurveRef.current = showCurve },[showCurve])

  // ── Pre-compute full-cycle data for charts ────────────────────
  const oscData = useMemo(() => {
    if (!mechanism?.L1) return []
    const { L1, L2, L3, L4, O2, O4 } = mechanism
    const rows = []
    for (let t = 0; t <= 360; t += 2) {
      const v = velocityAnalysis(t, OMEGA2, L1, L2, L3, L4, O2, O4)
      const a = accelerationAnalysis(t, OMEGA2, 0, L1, L2, L3, L4, O2, O4)
      rows.push({
        t,
        w3:  v ? +v.omega3.toFixed(3)  : 0,
        w4:  v ? +v.omega4.toFixed(3)  : 0,
        VA:  v ? +Math.sqrt(v.VA.x**2 + v.VA.y**2).toFixed(1) : 0,
        VB:  v ? +Math.sqrt(v.VB.x**2 + v.VB.y**2).toFixed(1) : 0,
        AA:  a ? +Math.sqrt(a.AA.x**2 + a.AA.y**2).toFixed(1) : 0,
        AB:  a ? +Math.sqrt(a.AB.x**2 + a.AB.y**2).toFixed(1) : 0,
        a3:  a ? +a.alpha3.toFixed(2) : 0,
        a4:  a ? +a.alpha4.toFixed(2) : 0,
      })
    }
    return rows
  }, [mechanism])

  // ── Animation loop ────────────────────────────────────────────
  useEffect(() => {
    let last = performance.now()
    function tick(now) {
      const dt = (now - last) / 1000
      last = now
      if (playingRef.current) {
        angleRef.current = (angleRef.current + dt * 55 * speedRef.current) % 360
      }
      const ang  = angleRef.current
      const mech = mechRef.current
      setLiveAngle(ang)
      try { drawMechanism(ang, mech) }    catch (_) {}
      try { drawVelPolygon(ang, mech) }   catch (_) {}
      try { drawAccPolygon(ang, mech) }   catch (_) {}
      animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRef.current)
  }, [])

  // ── Coordinate helpers ────────────────────────────────────────
  function tc(canvas, x, y) {
    const W = canvas.width, H = canvas.height
    return { x: W * 0.3 + x * 2.2, y: H * 0.65 - y * 2.2 }
  }

  // ════════════════════════════════════════════════════════════════
  // PANEL 1 — Main mechanism with live vectors
  // ════════════════════════════════════════════════════════════════
  function drawMechanism(ang, mech) {
    const canvas = mechCanvasRef.current
    if (!canvas || !mech?.L1) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)

    // Background
    const bg = ctx.createRadialGradient(W*0.35, H*0.5, 0, W*0.35, H*0.5, W*0.6)
    bg.addColorStop(0, '#0c1018'); bg.addColorStop(1, '#060a0d')
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)

    // Grid
    drawGrid(ctx, W, H)

    const { L1, L2, L3, L4, O2, O4 } = mech
    const fk = forwardKinematicsRaw(ang * DEG, L1, L2, L3, L4, O2, O4)
    if (!fk) return

    const pO2 = tc(canvas, O2.x, O2.y)
    const pO4 = tc(canvas, O4.x, O4.y)
    const pA  = tc(canvas, fk.A.x, fk.A.y)
    const pB  = tc(canvas, fk.B.x, fk.B.y)
    const pCP = tc(canvas, (fk.A.x+fk.B.x)/2, (fk.A.y+fk.B.y)/2)

    // Coupler curve
    if (showCurveRef.current) {
      const curve = computeCouplerCurve(L1, L2, L3, L4, O2, O4, 360)
      ctx.lineWidth = 1.2
      for (let i = 0; i < curve.length - 1; i++) {
        const p1 = tc(canvas, curve[i].x, curve[i].y)
        const p2 = tc(canvas, curve[i+1].x, curve[i+1].y)
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y)
        ctx.strokeStyle = `hsla(${200 + i/curve.length*60},75%,65%,0.3)`
        ctx.stroke()
      }
    }

    // Instant centres
    if (overlayRef.current === 'ic') {
      const ICs = computeInstantCenters(ang, L1, L2, L3, L4, O2, O4)
      if (ICs) {
        const keys = ['I12','I13','I14','I23','I24','I34']
        keys.forEach((k, i) => {
          const ic = ICs[k]
          if (!ic) return
          const p = tc(canvas, ic.x, ic.y)
          if (p.x < -80 || p.x > W+80 || p.y < -80 || p.y > H+80) return
          ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 2*Math.PI)
          ctx.strokeStyle = C.IC[i]; ctx.lineWidth = 2; ctx.stroke()
          ctx.fillStyle = C.IC[i]+'33'; ctx.fill()
          ctx.fillStyle = C.IC[i]; ctx.font = 'bold 10px Consolas,monospace'
          ctx.fillText(k, p.x+9, p.y-4)
        })
      }
    }

    // Ground bar
    drawGroundBar(ctx, pO2, pO4)

    // Dimension lines
    drawDim(ctx, pO2, pA,  `L2=${L2.toFixed(0)}`, C.crank)
    drawDim(ctx, pA,  pB,  `L3=${L3.toFixed(0)}`, C.coupler)
    drawDim(ctx, pO4, pB,  `L4=${L4.toFixed(0)}`, C.rocker)

    // CAD links
    drawCADLink(ctx, pO2, pA, C.crank,   8)
    drawCADLink(ctx, pA,  pB, C.coupler, 6)
    drawCADLink(ctx, pO4, pB, C.rocker,  8)

    // Velocity vectors
    const vel = velocityAnalysis(ang, OMEGA2, L1, L2, L3, L4, O2, O4)
    if (vel && (overlayRef.current === 'vel' || overlayRef.current === 'both')) {
      const vs = 0.6
      drawVec(ctx, pA,  vel.VA,  vs, C.VA,  `Va=${Math.sqrt(vel.VA.x**2+vel.VA.y**2).toFixed(0)}`)
      drawVec(ctx, pB,  vel.VB,  vs, C.VB,  `Vb=${Math.sqrt(vel.VB.x**2+vel.VB.y**2).toFixed(0)}`)
      drawVec(ctx, pCP, vel.VBA, vs, C.VBA, 'Vba')
      // ω labels
      drawOmegaArc(ctx, pO2, 32, ang,                '#c0392b', `ω₂=${OMEGA2}`)
      drawOmegaArc(ctx, pO4, 26, fk.theta4*RAD,      C.rocker, `ω₄=${vel.omega4.toFixed(1)}`)
    }

    // Acceleration vectors
    const acc = accelerationAnalysis(ang, OMEGA2, 0, L1, L2, L3, L4, O2, O4)
    if (acc && (overlayRef.current === 'acc' || overlayRef.current === 'both')) {
      const as = 0.032
      drawVec(ctx, pA,  acc.AA,   as, C.AA,  `Aa=${Math.sqrt(acc.AA.x**2+acc.AA.y**2).toFixed(0)}`)
      drawVec(ctx, pB,  acc.AB,   as, C.AB,  `Ab=${Math.sqrt(acc.AB.x**2+acc.AB.y**2).toFixed(0)}`)
      drawVec(ctx, pA,  acc.AA_n, as, C.AAn, 'Aa_n')
      drawVec(ctx, pA,  acc.AA_t, as, C.AAt, 'Aa_t')
    }

    // Pivots (on top)
    drawPivot(ctx, pO2, C.crank,   11, 'O₂', true)
    drawPivot(ctx, pO4, C.rocker,  11, 'O₄', true)
    drawPivot(ctx, pA,  C.coupler,  8, 'A',  false)
    drawPivot(ctx, pB,  C.coupler,  8, 'B',  false)

    // Coupler midpoint
    ctx.beginPath(); ctx.arc(pCP.x, pCP.y, 5, 0, 2*Math.PI)
    ctx.fillStyle = '#ff6b6b'; ctx.shadowBlur = 12; ctx.shadowColor='#ff6b6b'
    ctx.fill(); ctx.shadowBlur = 0

    // Theta2 arc
    drawOmegaArc(ctx, pO2, 32, ang, C.crank, `θ₂=${ang.toFixed(0)}°`)

    // HUD top-right
    drawMechHUD(ctx, W, ang, vel, acc)
  }

  // ════════════════════════════════════════════════════════════════
  // PANEL 2 — Velocity polygon (graphical construction)
  // ════════════════════════════════════════════════════════════════
  function drawVelPolygon(ang, mech) {
    const canvas = velCanvasRef.current
    if (!canvas || !mech?.L1) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)

    drawPanelBG(ctx, W, H, 'VELOCITY POLYGON')

    const { L1, L2, L3, L4, O2, O4 } = mech
    const vel = velocityAnalysis(ang, OMEGA2, L1, L2, L3, L4, O2, O4)
    if (!vel) return

    // Auto-scale
    const maxV = Math.max(
      Math.sqrt(vel.VA.x**2+vel.VA.y**2),
      Math.sqrt(vel.VB.x**2+vel.VB.y**2),
    )
    const S = maxV > 1 ? Math.min(W, H) * 0.35 / maxV : 1

    const ox = W * 0.45, oy = H * 0.52

    const ax = ox + vel.VA.x * S,  ay = oy - vel.VA.y * S
    const bx = ox + vel.VB.x * S,  by = oy - vel.VB.y * S

    // Construction: o -> a (VA)
    polyArrow(ctx, ox, oy, ax, ay, C.VA, `Va = ${Math.sqrt(vel.VA.x**2+vel.VA.y**2).toFixed(1)} mm/s`, true)
    // a -> b (VBA)
    polyArrow(ctx, ax, ay, bx, by, C.VBA, `Vba`, false)
    // o -> b (VB)
    polyArrow(ctx, ox, oy, bx, by, C.VB, `Vb = ${Math.sqrt(vel.VB.x**2+vel.VB.y**2).toFixed(1)} mm/s`, true)

    // Pole
    drawPole(ctx, ox, oy, 'o')
    // Points
    drawPolyPt(ctx, ax, ay, C.VA,  'a')
    drawPolyPt(ctx, bx, by, C.VB,  'b')

    // Omega readouts
    drawDataBox(ctx, W, H, [
      { label: 'ω₂ (input)',   val: `${OMEGA2} rad/s`,              color: C.crank   },
      { label: 'ω₃ coupler',   val: `${vel.omega3.toFixed(3)} rad/s`, color: C.coupler },
      { label: 'ω₄ rocker',    val: `${vel.omega4.toFixed(3)} rad/s`, color: C.rocker  },
      { label: '|Va|',          val: `${Math.sqrt(vel.VA.x**2+vel.VA.y**2).toFixed(1)} mm/s`, color: C.VA },
      { label: '|Vb|',          val: `${Math.sqrt(vel.VB.x**2+vel.VB.y**2).toFixed(1)} mm/s`, color: C.VB },
    ])

    // Scale legend
    ctx.fillStyle = '#2a3a4a'; ctx.font = '9px Consolas,monospace'
    ctx.fillText(`1 px = ${(1/S).toFixed(2)} mm/s`, 10, H - 10)
  }

  // ════════════════════════════════════════════════════════════════
  // PANEL 3 — Acceleration polygon
  // ════════════════════════════════════════════════════════════════
  function drawAccPolygon(ang, mech) {
    const canvas = accCanvasRef.current
    if (!canvas || !mech?.L1) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)

    drawPanelBG(ctx, W, H, 'ACCELERATION POLYGON')

    const { L1, L2, L3, L4, O2, O4 } = mech
    const acc = accelerationAnalysis(ang, OMEGA2, 0, L1, L2, L3, L4, O2, O4)
    if (!acc) return

    const maxA = Math.max(
      Math.sqrt(acc.AA.x**2+acc.AA.y**2),
      Math.sqrt(acc.AB.x**2+acc.AB.y**2),
      1,
    )
    const S = Math.min(W, H) * 0.32 / maxA

    const ox = W * 0.45, oy = H * 0.52

    // Normal component of AA
    const an_ex = ox + acc.AA_n.x * S,  an_ey = oy - acc.AA_n.y * S
    // Tangential component (from normal endpoint)
    const at_ex = an_ex + acc.AA_t.x * S, at_ey = an_ey - acc.AA_t.y * S
    // Total AA (should match at_ex, at_ey)
    const aa_ex = ox + acc.AA.x * S, aa_ey = oy - acc.AA.y * S
    // AB
    const ab_ex = ox + acc.AB.x * S, ab_ey = oy - acc.AB.y * S

    // Construction chain: o -> Aa_n -> Aa_t (= Aa total)
    polyArrow(ctx, ox,    oy,    an_ex, an_ey, C.AAn, 'Aa_n (centripetal)', false)
    polyArrow(ctx, an_ex, an_ey, at_ex, at_ey, C.AAt, 'Aa_t (tangential)',  false)
    // Total AA from pole
    polyArrow(ctx, ox, oy, aa_ex, aa_ey, C.AA,  `Aa = ${Math.sqrt(acc.AA.x**2+acc.AA.y**2).toFixed(0)} mm/s²`, true)
    // AB
    polyArrow(ctx, ox, oy, ab_ex, ab_ey, C.AB,  `Ab = ${Math.sqrt(acc.AB.x**2+acc.AB.y**2).toFixed(0)} mm/s²`, true)

    // Dashed closure line (n+t to total check)
    ctx.save(); ctx.setLineDash([4,4]); ctx.globalAlpha = 0.3
    ctx.beginPath(); ctx.moveTo(at_ex, at_ey); ctx.lineTo(aa_ex, aa_ey)
    ctx.strokeStyle = C.AAt; ctx.lineWidth = 1; ctx.stroke()
    ctx.restore()

    drawPole(ctx, ox, oy, "o'")
    drawPolyPt(ctx, aa_ex, aa_ey, C.AA,  "a'")
    drawPolyPt(ctx, ab_ex, ab_ey, C.AB,  "b'")
    drawPolyPt(ctx, an_ex, an_ey, C.AAn, "a_n")

    drawDataBox(ctx, W, H, [
      { label: 'α₃ coupler', val: `${acc.alpha3.toFixed(2)} rad/s²`, color: C.AA  },
      { label: 'α₄ rocker',  val: `${acc.alpha4.toFixed(2)} rad/s²`, color: C.AB  },
      { label: '|Aa|',        val: `${Math.sqrt(acc.AA.x**2+acc.AA.y**2).toFixed(0)} mm/s²`, color: C.AA },
      { label: '|Ab|',        val: `${Math.sqrt(acc.AB.x**2+acc.AB.y**2).toFixed(0)} mm/s²`, color: C.AB },
    ])

    ctx.fillStyle = '#2a3a4a'; ctx.font = '9px Consolas,monospace'
    ctx.fillText(`1 px = ${(1/S).toFixed(3)} mm/s²`, 10, H - 10)
  }

  // ── Render ────────────────────────────────────────────────────
  const vel = useMemo(() => {
    if (!mechanism?.L1) return null
    const { L1, L2, L3, L4, O2, O4 } = mechanism
    return velocityAnalysis(liveAngle, OMEGA2, L1, L2, L3, L4, O2, O4)
  }, [liveAngle, mechanism])

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#08090c' }}>

      {/* ── Left: Main mechanism (55%) ── */}
      <div style={{ flex: '0 0 55%', display: 'flex', flexDirection: 'column', borderRight: '1px solid #0f1820', padding: 12, gap: 8 }}>

        {/* Toolbar */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => setPlaying(v => !v)} style={btnStyle(playing ? '#3a0808' : '#0a1a0a', playing ? C.crank : C.rocker)}>
            {playing ? '|| Pause' : '> Play'}
          </button>

          <div style={{ display: 'flex', gap: 3, background: '#0d1117', borderRadius: 6, padding: 3 }}>
            {[0.25, 0.5, 1, 2, 4].map(s => (
              <button key={s} onClick={() => setSpeed(s)} style={btnStyle(speed===s ? '#1a2a1a' : 'transparent', speed===s ? '#00c851' : '#444')}>
                {s}x
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 3, background: '#0d1117', borderRadius: 6, padding: 3 }}>
            {[
              { id: 'vel',  label: 'Velocity',  color: C.VA  },
              { id: 'acc',  label: 'Accel',     color: C.AA  },
              { id: 'both', label: 'Both',       color: '#8b5cf6' },
              { id: 'ic',   label: 'Inst. Centers', color: C.IC[0] },
            ].map(o => (
              <button key={o.id} onClick={() => setOverlay(o.id)}
                style={btnStyle(overlay===o.id ? o.color+'22' : 'transparent', overlay===o.id ? o.color : '#444')}>
                {o.label}
              </button>
            ))}
          </div>

          <button onClick={() => setShowCurve(v => !v)}
            style={btnStyle(showCurve ? '#0d1a2a' : 'transparent', showCurve ? C.coupler : '#444')}>
            Curve
          </button>

          <div style={{ marginLeft: 'auto', fontFamily: 'Consolas,monospace', fontSize: 13, color: C.crank }}>
            θ₂ = {liveAngle.toFixed(1)}°
          </div>
        </div>

        {/* Mechanism canvas */}
        <div style={{ flex: 1, background: '#07090c', borderRadius: 10, border: '1px solid #0f1820', overflow: 'hidden' }}>
          <canvas ref={mechCanvasRef} width={780} height={500} style={{ width: '100%', height: '100%' }} />
        </div>

        {/* Legend row */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            [C.crank,   'Crank / Va'],
            [C.coupler, 'Coupler / Vba'],
            [C.rocker,  'Rocker / Vb'],
            [C.AA,      'Accel Aa'],
            [C.AB,      'Accel Ab'],
            [C.AAn,     'Aa_n (centripetal)'],
            [C.AAt,     'Aa_t (tangential)'],
          ].map(([color, label]) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 14, height: 3, background: color, borderRadius: 2 }} />
              <span style={{ color: color+'aa', fontSize: 10, fontWeight: 700 }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right: 3 stacked panels (45%) ── */}
      <div style={{ flex: '0 0 45%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Velocity polygon */}
        <div style={{ flex: '0 0 33.3%', borderBottom: '1px solid #0f1820', overflow: 'hidden' }}>
          <canvas ref={velCanvasRef} width={580} height={200} style={{ width: '100%', height: '100%' }} />
        </div>

        {/* Acceleration polygon */}
        <div style={{ flex: '0 0 33.3%', borderBottom: '1px solid #0f1820', overflow: 'hidden' }}>
          <canvas ref={accCanvasRef} width={580} height={200} style={{ width: '100%', height: '100%' }} />
        </div>

        {/* Oscilloscope */}
        <div style={{ flex: 1, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ color: '#2a3a4a', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em' }}>
            OSCILLOSCOPE  —  ω, |V|, |A| vs θ₂
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={oscData} margin={{ top: 4, right: 8, left: -22, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#0f1820" />
                <XAxis dataKey="t" stroke="#2a3a4a" tick={{ fontSize: 9 }} tickCount={7} />
                <YAxis stroke="#2a3a4a" tick={{ fontSize: 9 }} />
                <Tooltip
                  contentStyle={{ background: '#0d1117', border: '1px solid #1e2d40', borderRadius: 8, fontSize: 10 }}
                  labelStyle={{ color: '#4a6a8a' }}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <ReferenceLine x={Math.round(liveAngle)} stroke='rgba(255,255,255,0.25)' strokeDasharray="4 4" />
                <Line type="monotone" dataKey="w3"  stroke={C.coupler} dot={false} strokeWidth={1.5} name="ω₃" />
                <Line type="monotone" dataKey="w4"  stroke={C.rocker}  dot={false} strokeWidth={1.5} name="ω₄" />
                <Line type="monotone" dataKey="VA"  stroke={C.VA}      dot={false} strokeWidth={1.5} name="|Va|" />
                <Line type="monotone" dataKey="VB"  stroke={C.VB}      dot={false} strokeWidth={1.5} name="|Vb|" />
                <Line type="monotone" dataKey="AA"  stroke={C.AA}      dot={false} strokeWidth={1}   name="|Aa|" strokeDasharray="4 2" />
                <Line type="monotone" dataKey="AB"  stroke={C.AB}      dot={false} strokeWidth={1}   name="|Ab|" strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Shared canvas helpers ─────────────────────────────────────────

function drawGrid(ctx, W, H) {
  const minor = 30, major = 150
  ctx.lineWidth = 1
  for (let x = 0; x < W; x += minor) {
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H)
    ctx.strokeStyle = x % major === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.015)'
    ctx.stroke()
  }
  for (let y = 0; y < H; y += minor) {
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y)
    ctx.strokeStyle = y % major === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.015)'
    ctx.stroke()
  }
}

function drawPanelBG(ctx, W, H, title) {
  ctx.fillStyle = '#08090c'; ctx.fillRect(0, 0, W, H)
  // subtle grid
  ctx.strokeStyle = 'rgba(255,255,255,0.015)'; ctx.lineWidth = 1
  for (let x = 0; x < W; x += 25) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke() }
  for (let y = 0; y < H; y += 25) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke() }
  // Axes through centre
  const ox = W*0.45, oy = H*0.52
  ctx.save(); ctx.globalAlpha = 0.12; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.setLineDash([5,5])
  ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, H); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.stroke()
  ctx.restore()
  // Title
  ctx.fillStyle = '#1a2a3a'; ctx.font = 'bold 10px Consolas,monospace'
  ctx.fillText(title, 10, 14)
}

function drawGroundBar(ctx, p1, p2) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y
  const len = Math.sqrt(dx*dx+dy*dy)||1
  const nx = -dy/len, ny = dx/len
  ctx.strokeStyle = '#1e2a1e'; ctx.lineWidth = 10; ctx.lineCap = 'round'
  ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.stroke()
  ctx.strokeStyle = '#2d3d2d'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.stroke()
  for (let i = 0; i <= 7; i++) {
    const t = i/7
    const bx = p1.x+t*dx, by = p1.y+t*dy
    ctx.beginPath(); ctx.moveTo(bx+nx*8,by+ny*8); ctx.lineTo(bx+nx*17,by+ny*17)
    ctx.strokeStyle='#2d3d2d'; ctx.lineWidth=1.5; ctx.stroke()
  }
}

function drawCADLink(ctx, p1, p2, color, hw) {
  const dx = p2.x-p1.x, dy = p2.y-p1.y
  const len = Math.sqrt(dx*dx+dy*dy)||1
  const nx = -dy/len*hw, ny = dx/len*hw
  ctx.beginPath()
  ctx.moveTo(p1.x+nx, p1.y+ny)
  ctx.lineTo(p2.x+nx, p2.y+ny)
  ctx.arc(p2.x, p2.y, hw, Math.atan2(ny,nx), Math.atan2(-ny,-nx), false)
  ctx.lineTo(p1.x-nx, p1.y-ny)
  ctx.arc(p1.x, p1.y, hw, Math.atan2(-ny,-nx), Math.atan2(ny,nx), false)
  ctx.closePath()
  ctx.fillStyle = color+'22'; ctx.fill()
  ctx.strokeStyle = color+'cc'; ctx.lineWidth = 1.8
  ctx.shadowBlur = 6; ctx.shadowColor = color+'44'; ctx.stroke(); ctx.shadowBlur = 0
  ctx.setLineDash([5,5])
  ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y)
  ctx.strokeStyle = color+'33'; ctx.lineWidth = 1; ctx.stroke()
  ctx.setLineDash([])
}

function drawPivot(ctx, p, color, r, label, isGround) {
  ctx.beginPath(); ctx.arc(p.x,p.y,r+4,0,2*Math.PI)
  ctx.strokeStyle=color+'22'; ctx.lineWidth=1; ctx.stroke()
  ctx.beginPath(); ctx.arc(p.x,p.y,r,0,2*Math.PI)
  ctx.fillStyle=color+'28'; ctx.shadowBlur=12; ctx.shadowColor=color; ctx.fill()
  ctx.strokeStyle=color; ctx.lineWidth=2.5; ctx.stroke(); ctx.shadowBlur=0
  ctx.beginPath(); ctx.arc(p.x,p.y,3,0,2*Math.PI); ctx.fillStyle=color; ctx.fill()
  if (isGround) {
    const th=14
    ctx.beginPath()
    ctx.moveTo(p.x,p.y+r+2); ctx.lineTo(p.x-th/2,p.y+r+th+2); ctx.lineTo(p.x+th/2,p.y+r+th+2)
    ctx.closePath(); ctx.strokeStyle=color+'77'; ctx.lineWidth=1.5; ctx.stroke()
    ctx.beginPath(); ctx.moveTo(p.x-th/2-4,p.y+r+th+2); ctx.lineTo(p.x+th/2+4,p.y+r+th+2)
    ctx.strokeStyle=color+'55'; ctx.lineWidth=2; ctx.stroke()
  }
  if (label) {
    ctx.fillStyle='#ddeeff'; ctx.font='bold 11px Consolas,monospace'
    ctx.textAlign='center'; ctx.fillText(label, p.x, p.y-r-8); ctx.textAlign='left'
  }
}

function drawVec(ctx, origin, vec, scale, color, label) {
  if (!vec) return
  const mag = Math.sqrt(vec.x**2+vec.y**2)
  if (mag < 0.01) return
  const ex = origin.x + vec.x * scale
  const ey = origin.y - vec.y * scale
  const ang = Math.atan2(ey-origin.y, ex-origin.x)
  const hs = 11
  ctx.save(); ctx.globalAlpha = 0.92
  ctx.beginPath(); ctx.moveTo(origin.x,origin.y); ctx.lineTo(ex,ey)
  ctx.strokeStyle=color; ctx.lineWidth=2.5; ctx.lineCap='round'
  ctx.shadowBlur=8; ctx.shadowColor=color; ctx.stroke(); ctx.shadowBlur=0
  ctx.beginPath()
  ctx.moveTo(ex,ey)
  ctx.lineTo(ex-hs*Math.cos(ang-0.35), ey-hs*Math.sin(ang-0.35))
  ctx.lineTo(ex-hs*Math.cos(ang+0.35), ey-hs*Math.sin(ang+0.35))
  ctx.closePath(); ctx.fillStyle=color; ctx.fill()
  const lx = ex+9*Math.cos(ang), ly = ey+9*Math.sin(ang)
  ctx.font='bold 10px Consolas,monospace'
  const tw = ctx.measureText(label).width
  ctx.globalAlpha=0.72; ctx.fillStyle='#06090ccc'
  ctx.beginPath(); ctx.roundRect(lx-2,ly-12,tw+8,14,3); ctx.fill()
  ctx.globalAlpha=1; ctx.fillStyle=color
  ctx.fillText(label, lx+2, ly)
  ctx.restore()
}

function drawDim(ctx, p1, p2, text, color) {
  const dx = p2.x-p1.x, dy = p2.y-p1.y
  const len = Math.sqrt(dx*dx+dy*dy)||1
  const nx = -dy/len*20, ny = dx/len*20
  const ox1=p1.x+nx, oy1=p1.y+ny, ox2=p2.x+nx, oy2=p2.y+ny
  ctx.save(); ctx.globalAlpha=0.4
  ctx.strokeStyle=color; ctx.lineWidth=1; ctx.setLineDash([3,4])
  ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(ox1,oy1); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(p2.x,p2.y); ctx.lineTo(ox2,oy2); ctx.stroke()
  ctx.setLineDash([])
  ctx.beginPath(); ctx.moveTo(ox1,oy1); ctx.lineTo(ox2,oy2); ctx.stroke()
  dimArr(ctx, ox1,oy1, ox2,oy2, color)
  dimArr(ctx, ox2,oy2, ox1,oy1, color)
  ctx.globalAlpha=0.7; ctx.fillStyle=color; ctx.font='bold 9px Consolas,monospace'
  ctx.textAlign='center'; ctx.fillText(text, (ox1+ox2)/2, (oy1+oy2)/2-4)
  ctx.textAlign='left'; ctx.restore()
}

function dimArr(ctx, x1,y1,x2,y2,color) {
  const a=Math.atan2(y2-y1,x2-x1)
  ctx.beginPath()
  ctx.moveTo(x1,y1); ctx.lineTo(x1+7*Math.cos(a-0.4),y1+7*Math.sin(a-0.4))
  ctx.moveTo(x1,y1); ctx.lineTo(x1+7*Math.cos(a+0.4),y1+7*Math.sin(a+0.4))
  ctx.strokeStyle=color; ctx.lineWidth=1; ctx.stroke()
}

function drawOmegaArc(ctx, p, r, angleDeg, color, label) {
  ctx.save(); ctx.globalAlpha=0.6
  ctx.beginPath(); ctx.arc(p.x,p.y, r, 0, angleDeg*DEG, angleDeg<0)
  ctx.strokeStyle=color; ctx.lineWidth=1.5; ctx.stroke()
  ctx.globalAlpha=0.8; ctx.fillStyle=color; ctx.font='10px Consolas,monospace'
  ctx.fillText(label, p.x+r+4, p.y-4)
  ctx.restore()
}

function drawMechHUD(ctx, W, ang, vel, acc) {
  const lines = [
    { t: 'θ₂',   v: `${ang.toFixed(1)}°`,        c: C.crank   },
    vel ? { t:'ω₃', v: `${vel.omega3.toFixed(2)} r/s`, c: C.coupler } : null,
    vel ? { t:'ω₄', v: `${vel.omega4.toFixed(2)} r/s`, c: C.rocker  } : null,
    vel ? { t:'|Va|', v:`${Math.sqrt(vel.VA.x**2+vel.VA.y**2).toFixed(0)} mm/s`, c: C.VA } : null,
    vel ? { t:'|Vb|', v:`${Math.sqrt(vel.VB.x**2+vel.VB.y**2).toFixed(0)} mm/s`, c: C.VB } : null,
    acc ? { t:'|Aa|', v:`${Math.sqrt(acc.AA.x**2+acc.AA.y**2).toFixed(0)} mm/s²`, c: C.AA } : null,
    acc ? { t:'α₃',   v:`${acc.alpha3.toFixed(2)} r/s²`, c: C.AAt } : null,
  ].filter(Boolean)

  const bw=200, bh=lines.length*17+14, px=W-bw-8, py=8
  ctx.save(); ctx.globalAlpha=0.8
  ctx.fillStyle='#050810'; ctx.beginPath()
  ctx.roundRect(px,py,bw,bh,6); ctx.fill()
  ctx.strokeStyle='#1e2d40'; ctx.lineWidth=1; ctx.stroke()
  ctx.globalAlpha=1; ctx.font='11px Consolas,monospace'
  lines.forEach((l,i) => {
    ctx.fillStyle = l.c
    ctx.fillText(`${l.t} = ${l.v}`, px+10, py+14+i*17)
  })
  ctx.restore()
}

function polyArrow(ctx, x1,y1,x2,y2, color, label, bold) {
  const ang = Math.atan2(y2-y1, x2-x1)
  const hs = bold ? 13 : 9
  ctx.save()
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2)
  ctx.strokeStyle=color; ctx.lineWidth=bold?2.5:1.8; ctx.lineCap='round'
  ctx.shadowBlur=bold?8:0; ctx.shadowColor=color; ctx.stroke(); ctx.shadowBlur=0
  ctx.beginPath()
  ctx.moveTo(x2,y2)
  ctx.lineTo(x2-hs*Math.cos(ang-0.35), y2-hs*Math.sin(ang-0.35))
  ctx.lineTo(x2-hs*Math.cos(ang+0.35), y2-hs*Math.sin(ang+0.35))
  ctx.closePath(); ctx.fillStyle=color; ctx.fill()
  if (label) {
    const lx = x2+10*Math.cos(ang), ly = y2+10*Math.sin(ang)
    ctx.font = bold ? 'bold 11px Consolas,monospace' : '9px Consolas,monospace'
    const tw = ctx.measureText(label).width
    ctx.globalAlpha=0.65; ctx.fillStyle='#060910cc'
    ctx.beginPath(); ctx.roundRect(lx-2,ly-12,tw+8,15,3); ctx.fill()
    ctx.globalAlpha=1; ctx.fillStyle=color
    ctx.fillText(label, lx+2, ly)
  }
  ctx.restore()
}

function drawPole(ctx, x, y, label) {
  ctx.fillStyle='#888'; ctx.font='bold 13px Consolas,monospace'
  ctx.fillText(label, x-18, y+5)
  ctx.beginPath(); ctx.arc(x,y,4,0,2*Math.PI)
  ctx.fillStyle='#555'; ctx.fill()
  ctx.strokeStyle='#888'; ctx.lineWidth=1.5; ctx.stroke()
}

function drawPolyPt(ctx, x, y, color, label) {
  ctx.beginPath(); ctx.arc(x,y,5,0,2*Math.PI)
  ctx.fillStyle=color+'44'; ctx.fill()
  ctx.strokeStyle=color; ctx.lineWidth=2; ctx.stroke()
  ctx.fillStyle=color; ctx.font='bold 11px Consolas,monospace'
  ctx.fillText(label, x+9, y+4)
}

function drawDataBox(ctx, W, H, rows) {
  const bw=200, bh=rows.length*17+14, px=W-bw-8, py=8
  ctx.save(); ctx.globalAlpha=0.85
  ctx.fillStyle='#050810'; ctx.beginPath(); ctx.roundRect(px,py,bw,bh,6); ctx.fill()
  ctx.strokeStyle='#1e2d40'; ctx.lineWidth=1; ctx.stroke()
  ctx.globalAlpha=1; ctx.font='11px Consolas,monospace'
  rows.forEach((r,i) => {
    ctx.fillStyle=r.color
    ctx.fillText(`${r.label}: ${r.val}`, px+10, py+14+i*17)
  })
  ctx.restore()
}

function btnStyle(bg, color='#fff') {
  return {
    padding: '4px 10px', borderRadius: 5, border: 'none',
    background: bg, color, fontWeight: 700, cursor: 'pointer',
    fontSize: 11, letterSpacing: '0.03em',
  }
}
