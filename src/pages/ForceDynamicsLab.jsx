import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts'
import useMechanismStore from '../store/useMechanismStore'
import {
  computeForces, computeTorqueSeries,
  computePeakTorque, computeAvgMA, recommendedMotorPower,
} from '../engine/forceAnalysis'
import { forwardKinematicsRaw, computeCouplerCurve } from '../engine/synthesis'

const DEG    = Math.PI / 180
const OMEGA2 = 10

// ── colour palette ────────────────────────────────────────────────
const C = {
  crank:   '#c0392b',
  coupler: '#4a9eff',
  rocker:  '#00c851',
  RO2:     '#ff6b6b',
  RA:      '#c0392b',
  RB:      '#06b6d4',
  RO4:     '#27ae60',
  shaking: '#ff3355',
  torque:  '#c0392b',
  MA:      '#00c851',
  power:   '#ff9800',
}

export default function ForceDynamicsLab() {
  const mechanism = useMechanismStore(s => s.mechanism)

  const canvasRef = useRef(null)
  const animRef   = useRef(null)
  const angleRef  = useRef(0)
  const mechRef   = useRef(mechanism)

  const [liveAngle, setLiveAngle] = useState(0)
  const [playing,   setPlaying]   = useState(true)
  const [speed,     setSpeed]     = useState(1)
  const [showForce, setShowForce] = useState(true)
  const [showInertia, setShowInertia] = useState(true)
  const [zoom,      setZoom]      = useState(1)

  const zoomRef = useRef(1)
  const panRef  = useRef({ x: 0, y: 0 })
  const dragRef = useRef({ active: false, lastX: 0, lastY: 0 })

  const playingRef    = useRef(playing)
  const speedRef      = useRef(speed)
  const showForceRef  = useRef(showForce)
  const showInertiaRef= useRef(showInertia)

  useEffect(() => { mechRef.current        = mechanism },   [mechanism])
  useEffect(() => { playingRef.current     = playing },     [playing])
  useEffect(() => { speedRef.current       = speed },       [speed])
  useEffect(() => { showForceRef.current   = showForce },   [showForce])
  useEffect(() => { showInertiaRef.current = showInertia }, [showInertia])

  // ── Zoom / Pan handlers ───────────────────────────────────────
  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.15 : 0.87
    const nz = Math.max(0.2, Math.min(8, zoomRef.current * factor))
    zoomRef.current = nz
    setZoom(nz)
  }, [])

  const handleMouseDown = useCallback((e) => {
    dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY }
  }, [])

  const handleMouseMove = useCallback((e) => {
    if (!dragRef.current.active) return
    panRef.current.x += e.clientX - dragRef.current.lastX
    panRef.current.y += e.clientY - dragRef.current.lastY
    dragRef.current.lastX = e.clientX
    dragRef.current.lastY = e.clientY
  }, [])

  const handleMouseUp   = useCallback(() => { dragRef.current.active = false }, [])

  const resetView = () => {
    zoomRef.current = 1
    panRef.current  = { x: 0, y: 0 }
    setZoom(1)
  }

  // ── Pre-compute full-cycle series ─────────────────────────────
  const seriesData = useMemo(() => {
    if (!mechanism?.L1) return []
    const raw = computeTorqueSeries(mechanism, OMEGA2)
    return raw.map(s => ({
      t:      s.theta2,
      torque: +s.torque.toFixed(3),
      power:  +s.power.toFixed(2),
      MA:     +s.MA.toFixed(4),
    }))
  }, [mechanism])

  const metrics = useMemo(() => {
    if (!seriesData.length) return { peak: 0, avgMA: 0, power: 0 }
    return {
      peak:  +computePeakTorque(seriesData.map(s => ({ torque: s.torque }))).toFixed(3),
      avgMA: +computeAvgMA(seriesData.map(s => ({ MA: s.MA }))).toFixed(3),
      power: +recommendedMotorPower(seriesData.map(s => ({ power: s.power }))).toFixed(1),
    }
  }, [seriesData])

  // ── Animation loop ────────────────────────────────────────────
  useEffect(() => {
    let last = performance.now()
    function tick(now) {
      const dt = (now - last) / 1000
      last = now
      if (playingRef.current)
        angleRef.current = (angleRef.current + dt * 55 * speedRef.current) % 360
      setLiveAngle(angleRef.current)
      try { drawForceCanvas(angleRef.current, mechRef.current) } catch (_) {}
      animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRef.current)
  }, [])

  // ── CAD force canvas ──────────────────────────────────────────
  function drawForceCanvas(ang, mech) {
    const canvas = canvasRef.current
    if (!canvas || !mech?.L1) return
    const ctx   = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)

    // Background
    const bg = ctx.createRadialGradient(W*0.38,H*0.5,0, W*0.38,H*0.5, W*0.6)
    bg.addColorStop(0, '#0c1018'); bg.addColorStop(1, '#060a0d')
    ctx.fillStyle = bg; ctx.fillRect(0,0,W,H)
    drawGrid(ctx, W, H)

    const { L1, L2, L3, L4, O2, O4 } = mech
    const z = zoomRef.current, p = panRef.current
    const tc = (x,y) => ({ x: W*0.3 + p.x + x*2.6*z, y: H*0.68 + p.y - y*2.6*z })

    // Coupler curve (subtle)
    const curve = computeCouplerCurve(L1, L2, L3, L4, O2, O4, 360)
    ctx.save(); ctx.globalAlpha = 0.18; ctx.lineWidth = 1
    for (let i = 0; i < curve.length-1; i++) {
      const p1 = tc(curve[i].x,   curve[i].y)
      const p2 = tc(curve[i+1].x, curve[i+1].y)
      ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y)
      ctx.strokeStyle = `hsl(${200+i/curve.length*60},70%,60%)`
      ctx.stroke()
    }
    ctx.restore()

    const fk = forwardKinematicsRaw(ang * DEG, L1, L2, L3, L4, O2, O4)
    if (!fk) return

    const forces = computeForces(ang, OMEGA2, 0, mech)

    const pO2 = tc(O2.x,   O2.y)
    const pO4 = tc(O4.x,   O4.y)
    const pA  = tc(fk.A.x, fk.A.y)
    const pB  = tc(fk.B.x, fk.B.y)
    const pCP = tc((fk.A.x+fk.B.x)/2, (fk.A.y+fk.B.y)/2)

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

    // ── Force arrows ──────────────────────────────────────────
    if (forces && showForceRef.current) {
      const fs = 9
      drawForceVec(ctx, pO2, forces.R_O2,  fs, C.RO2,     'R_O2')
      drawForceVec(ctx, pA,  forces.R_A,   fs, C.RA,      'R_A')
      drawForceVec(ctx, pB,  forces.R_B,   fs, C.RB,      'R_B')
      drawForceVec(ctx, pO4, forces.R_O4,  fs, C.RO4,     'R_O4')
      drawForceVec(ctx, pO2, forces.shaking, fs*1.4, C.shaking, 'F_shake')
    }

    // ── Torque arc on crank ───────────────────────────────────
    if (forces) {
      const tSign = forces.T_crank >= 0 ? 1 : -1
      ctx.save()
      ctx.beginPath()
      ctx.arc(pO2.x, pO2.y, 38, 0, tSign * Math.PI * 0.8, tSign < 0)
      ctx.strokeStyle = forces.T_crank >= 0 ? '#c0392b' : '#06b6d4'
      ctx.lineWidth = 3; ctx.setLineDash([5,3]); ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()

      // Torque label
      ctx.fillStyle = forces.T_crank >= 0 ? '#c0392b' : '#06b6d4'
      ctx.font = 'bold 11px Consolas,monospace'
      ctx.fillText(`T=${forces.T_crank.toFixed(2)}N·m`, pO2.x+44, pO2.y-8)
    }

    // Pivots
    drawPivot(ctx, pO2, C.crank,   11, 'O₂', true)
    drawPivot(ctx, pO4, C.rocker,  11, 'O₄', true)
    drawPivot(ctx, pA,  C.coupler,  8, 'A',  false)
    drawPivot(ctx, pB,  C.coupler,  8, 'B',  false)

    // Coupler midpoint
    ctx.beginPath(); ctx.arc(pCP.x, pCP.y, 5, 0, 2*Math.PI)
    ctx.fillStyle = '#ff6b6b'; ctx.shadowBlur = 12; ctx.shadowColor = '#ff6b6b'
    ctx.fill(); ctx.shadowBlur = 0

    // θ₂ arc
    ctx.save(); ctx.globalAlpha = 0.6
    ctx.beginPath(); ctx.arc(pO2.x, pO2.y, 30, 0, ang*DEG, false)
    ctx.strokeStyle = C.crank; ctx.lineWidth = 1.5; ctx.stroke()
    ctx.restore()

    // HUD
    if (forces) drawForceHUD(ctx, W, ang, forces)
  }

  function drawForceHUD(ctx, W, ang, f) {
    const maColor = f.MA > 0.5 ? C.rocker : f.MA > 0.3 ? C.power : C.shaking
    const rows = [
      { t: 'θ₂',    v: `${ang.toFixed(1)}°`,        c: C.crank   },
      { t: 'μ',     v: `${f.mu.toFixed(1)}°`,        c: C.coupler },
      { t: 'MA',    v: f.MA.toFixed(4),               c: maColor   },
      { t: 'T_in',  v: `${f.T_crank.toFixed(2)} N·m`, c: C.torque  },
      { t: 'F_in',  v: `${f.F_input.toFixed(1)} N`,   c: C.RO2     },
      { t: 'F_out', v: `${f.F_output.toFixed(1)} N`,  c: C.RO4     },
      { t: 'Power', v: `${f.motorPower.toFixed(1)} W`, c: C.power  },
      { t: '|F_sh|',v: `${Math.sqrt(f.shaking.x**2+f.shaking.y**2).toFixed(1)} N`, c: C.shaking },
    ]
    const bw=212, bh=rows.length*17+14, px=W-bw-8, py=8
    ctx.save(); ctx.globalAlpha=0.85
    ctx.fillStyle='#050810'
    ctx.beginPath(); ctx.roundRect(px,py,bw,bh,6); ctx.fill()
    ctx.strokeStyle='#1e2d40'; ctx.lineWidth=1; ctx.stroke()
    ctx.globalAlpha=1; ctx.font='11px Consolas,monospace'
    rows.forEach((r,i) => { ctx.fillStyle=r.c; ctx.fillText(`${r.t} = ${r.v}`, px+10, py+14+i*17) })
    ctx.restore()
  }

  // ── Live forces for metric pills ─────────────────────────────
  const liveForces = useMemo(() => {
    if (!mechanism?.L1) return null
    return computeForces(liveAngle, OMEGA2, 0, mechanism)
  }, [liveAngle, mechanism])

  const maColor = !liveForces ? '#888'
    : liveForces.MA > 0.5 ? C.rocker
    : liveForces.MA > 0.3 ? C.power
    : C.shaking

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#08090c' }}>

      {/* ── Metric strip ── */}
      <div style={{ display: 'flex', gap: 10, padding: '10px 14px 0', flexShrink: 0 }}>
        {[
          { label: 'Peak Torque',    value: metrics.peak,  unit: 'N·m', color: C.torque  },
          { label: 'Avg. Mech. Adv', value: metrics.avgMA, unit: '',    color: C.MA      },
          { label: 'Motor Power',    value: metrics.power, unit: 'W',   color: C.power   },
          { label: 'Live MA',        value: liveForces ? liveForces.MA.toFixed(3) : '-', unit: '', color: maColor },
          { label: 'Live Torque',    value: liveForces ? liveForces.T_crank.toFixed(2) : '-', unit: 'N·m', color: C.torque },
          { label: 'F_shaking',      value: liveForces ? Math.sqrt(liveForces.shaking.x**2+liveForces.shaking.y**2).toFixed(1) : '-', unit: 'N', color: C.shaking },
        ].map(m => (
          <div key={m.label} style={{
            flex: 1, background: '#0d1117', border: `1px solid ${m.color}22`,
            borderRadius: 8, padding: '8px 12px',
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: m.color+'88', marginBottom: 3 }}>
              {m.label.toUpperCase()}
            </div>
            <div style={{ fontFamily: 'Consolas,monospace', fontWeight: 900, fontSize: 17, color: m.color }}>
              {m.value}<span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3, color: m.color+'88' }}>{m.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', gap: 0, overflow: 'hidden', padding: '10px 14px 14px' }}>

        {/* Left: Force canvas (55%) */}
        <div style={{ flex: '0 0 55%', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 10 }}>

          {/* Canvas toolbar */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={() => setPlaying(v => !v)}
              style={btnStyle(playing ? '#3a0808' : '#0a1a0a', playing ? C.crank : C.rocker)}>
              {playing ? '|| Pause' : '> Play'}
            </button>

            <div style={{ display: 'flex', gap: 3, background: '#0d1117', borderRadius: 6, padding: 3 }}>
              {[0.25, 0.5, 1, 2, 4].map(s => (
                <button key={s} onClick={() => setSpeed(s)}
                  style={btnStyle(speed===s ? '#1a2a1a' : 'transparent', speed===s ? C.rocker : '#444')}>
                  {s}x
                </button>
              ))}
            </div>

            <button onClick={() => setShowForce(v => !v)}
              style={btnStyle(showForce ? '#2a0a0a' : 'transparent', showForce ? C.RO2 : '#444')}>
              Force Arrows
            </button>

            {/* Zoom controls */}
            <div style={{ display: 'flex', gap: 3, background: '#0d1117', borderRadius: 6, padding: 3, alignItems: 'center' }}>
              <button onClick={() => { const nz=Math.min(8,zoomRef.current*1.25); zoomRef.current=nz; setZoom(nz) }}
                style={btnStyle('#0d1117','#aac')} title="Zoom in">＋</button>
              <span style={{ fontFamily:'Consolas,monospace', fontSize:11, color:'#557', minWidth:38, textAlign:'center' }}>
                {(zoom*100).toFixed(0)}%
              </span>
              <button onClick={() => { const nz=Math.max(0.2,zoomRef.current*0.8); zoomRef.current=nz; setZoom(nz) }}
                style={btnStyle('#0d1117','#aac')} title="Zoom out">－</button>
              <button onClick={resetView}
                style={btnStyle('#0d1117','#aac')} title="Reset view">⊡</button>
            </div>

            <div style={{ marginLeft: 'auto', fontFamily: 'Consolas,monospace', fontSize: 12, color: C.crank }}>
              θ₂ = {liveAngle.toFixed(1)}°
            </div>
          </div>

          {/* Canvas */}
          <div
            style={{ flex: 1, background: '#07090c', borderRadius: 10, border: '1px solid #0f1820', overflow: 'hidden', cursor: dragRef.current?.active ? 'grabbing' : 'grab' }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <canvas ref={canvasRef} width={720} height={430} style={{ width: '100%', height: '100%', pointerEvents: 'none' }} />
          </div>

          {/* Force legend */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {[
              [C.RO2,     'R_O2 (ground 2)'],
              [C.RA,      'R_A  (pin A)'],
              [C.RB,      'R_B  (pin B)'],
              [C.RO4,     'R_O4 (ground 4)'],
              [C.shaking, 'F_shaking'],
              [C.torque,  'T_crank (arc)'],
            ].map(([color, label]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 14, height: 3, background: color, borderRadius: 2 }} />
                <span style={{ color: color+'aa', fontSize: 10, fontWeight: 700 }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Charts (45%) */}
        <div style={{ flex: '0 0 45%', display: 'flex', flexDirection: 'column', gap: 10, borderLeft: '1px solid #0f1820', paddingLeft: 10 }}>

          {/* Torque + Power chart */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ color: '#2a3a4a', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em' }}>
              INPUT TORQUE &amp; POWER  vs  θ₂
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={seriesData} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
                  <defs>
                    <linearGradient id="torqueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.torque} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={C.torque} stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="powerGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.power} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={C.power} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#0f1820" />
                  <XAxis dataKey="t" stroke="#2a3a4a" tick={{ fontSize: 9 }} tickCount={7}
                    label={{ value: 'θ₂ (deg)', position: 'insideBottom', offset: -2, fill: '#2a3a4a', fontSize: 9 }} />
                  <YAxis stroke="#2a3a4a" tick={{ fontSize: 9 }} />
                  <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid #1e2d40', borderRadius: 8, fontSize: 10 }}
                    labelStyle={{ color: '#4a6a8a' }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
                  <ReferenceLine x={Math.round(liveAngle)} stroke="rgba(255,255,255,0.3)" strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="torque" stroke={C.torque} fill="url(#torqueGrad)"
                    strokeWidth={2} dot={false} name="T (N·m)" />
                  <Area type="monotone" dataKey="power"  stroke={C.power}  fill="url(#powerGrad)"
                    strokeWidth={1.5} dot={false} name="P (W)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Mechanical Advantage chart */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ color: '#2a3a4a', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em' }}>
              MECHANICAL ADVANTAGE  vs  θ₂
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={seriesData} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#0f1820" />
                  <XAxis dataKey="t" stroke="#2a3a4a" tick={{ fontSize: 9 }} tickCount={7} />
                  <YAxis stroke="#2a3a4a" tick={{ fontSize: 9 }} domain={[0, 1.2]} />
                  <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid #1e2d40', borderRadius: 8, fontSize: 10 }}
                    labelStyle={{ color: '#4a6a8a' }} />
                  <ReferenceLine y={0.5} stroke={C.rocker}  strokeDasharray="4 4"
                    label={{ value: 'MA=0.5 good', position: 'insideTopRight', fill: C.rocker,  fontSize: 9 }} />
                  <ReferenceLine y={0.3} stroke={C.power}   strokeDasharray="4 4"
                    label={{ value: 'MA=0.3 min',  position: 'insideTopRight', fill: C.power,   fontSize: 9 }} />
                  <ReferenceLine x={Math.round(liveAngle)} stroke="rgba(255,255,255,0.3)" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="MA" stroke={C.MA} dot={false} strokeWidth={2} name="MA" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* MA zone legend */}
            <div style={{ display: 'flex', gap: 12 }}>
              {[['> 0.5',C.rocker,'Good'],['0.3–0.5',C.power,'Caution'],['< 0.3',C.shaking,'Poor']].map(([label,color,desc]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 10, height: 10, background: color, borderRadius: 2 }} />
                  <span style={{ color, fontSize: 10, fontWeight: 700 }}>{label}</span>
                  <span style={{ color: '#3a4a5a', fontSize: 10 }}>({desc})</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

// ── Canvas helpers ────────────────────────────────────────────────

function drawGrid(ctx, W, H) {
  ctx.lineWidth = 1
  for (let x = 0; x < W; x += 30) {
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H)
    ctx.strokeStyle = x % 150 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.015)'
    ctx.stroke()
  }
  for (let y = 0; y < H; y += 30) {
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y)
    ctx.strokeStyle = y % 150 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.015)'
    ctx.stroke()
  }
}

function drawGroundBar(ctx, p1, p2) {
  const dx = p2.x-p1.x, dy = p2.y-p1.y
  const len = Math.sqrt(dx*dx+dy*dy)||1
  const nx = -dy/len, ny = dx/len
  ctx.strokeStyle='#1e2a1e'; ctx.lineWidth=12; ctx.lineCap='round'
  ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.stroke()
  ctx.strokeStyle='#2d3d2d'; ctx.lineWidth=2
  ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.stroke()
  for (let i=0; i<=7; i++) {
    const t=i/7, bx=p1.x+t*dx, by=p1.y+t*dy
    ctx.beginPath(); ctx.moveTo(bx+nx*8,by+ny*8); ctx.lineTo(bx+nx*18,by+ny*18)
    ctx.strokeStyle='#2d3d2d'; ctx.lineWidth=1.5; ctx.stroke()
  }
}

function drawCADLink(ctx, p1, p2, color, hw) {
  const dx=p2.x-p1.x, dy=p2.y-p1.y
  const len=Math.sqrt(dx*dx+dy*dy)||1
  const nx=-dy/len*hw, ny=dx/len*hw
  ctx.beginPath()
  ctx.moveTo(p1.x+nx,p1.y+ny); ctx.lineTo(p2.x+nx,p2.y+ny)
  ctx.arc(p2.x,p2.y,hw,Math.atan2(ny,nx),Math.atan2(-ny,-nx),false)
  ctx.lineTo(p1.x-nx,p1.y-ny)
  ctx.arc(p1.x,p1.y,hw,Math.atan2(-ny,-nx),Math.atan2(ny,nx),false)
  ctx.closePath()
  ctx.fillStyle=color+'22'; ctx.fill()
  ctx.strokeStyle=color+'cc'; ctx.lineWidth=1.8
  ctx.shadowBlur=6; ctx.shadowColor=color+'44'; ctx.stroke(); ctx.shadowBlur=0
  ctx.setLineDash([5,5])
  ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y)
  ctx.strokeStyle=color+'33'; ctx.lineWidth=1; ctx.stroke()
  ctx.setLineDash([])
}

function drawPivot(ctx, p, color, r, label, isGround) {
  ctx.beginPath(); ctx.arc(p.x,p.y,r+4,0,2*Math.PI)
  ctx.strokeStyle=color+'22'; ctx.lineWidth=1; ctx.stroke()
  ctx.beginPath(); ctx.arc(p.x,p.y,r,0,2*Math.PI)
  ctx.fillStyle=color+'28'; ctx.shadowBlur=12; ctx.shadowColor=color
  ctx.fill(); ctx.strokeStyle=color; ctx.lineWidth=2.5; ctx.stroke(); ctx.shadowBlur=0
  ctx.beginPath(); ctx.arc(p.x,p.y,3,0,2*Math.PI); ctx.fillStyle=color; ctx.fill()
  if (isGround) {
    const th=14
    ctx.beginPath()
    ctx.moveTo(p.x,p.y+r+2); ctx.lineTo(p.x-th/2,p.y+r+th+2); ctx.lineTo(p.x+th/2,p.y+r+th+2)
    ctx.closePath(); ctx.strokeStyle=color+'77'; ctx.lineWidth=1.5; ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(p.x-th/2-4,p.y+r+th+2); ctx.lineTo(p.x+th/2+4,p.y+r+th+2)
    ctx.strokeStyle=color+'55'; ctx.lineWidth=2; ctx.stroke()
  }
  if (label) {
    ctx.fillStyle='#ddeeff'; ctx.font='bold 11px Consolas,monospace'
    ctx.textAlign='center'; ctx.fillText(label,p.x,p.y-r-8); ctx.textAlign='left'
  }
}

function drawForceVec(ctx, origin, vec, scale, color, label) {
  if (!vec) return
  const mag = Math.sqrt(vec.x**2+vec.y**2)
  if (mag < 0.001) return
  const ex = origin.x + vec.x * scale
  const ey = origin.y - vec.y * scale
  const ang = Math.atan2(ey-origin.y, ex-origin.x)
  const hs = 13

  ctx.save(); ctx.globalAlpha = 0.92
  // Glow stem
  ctx.beginPath(); ctx.moveTo(origin.x,origin.y); ctx.lineTo(ex,ey)
  ctx.strokeStyle=color; ctx.lineWidth=3; ctx.lineCap='round'
  ctx.shadowBlur=10; ctx.shadowColor=color; ctx.stroke(); ctx.shadowBlur=0
  // Arrowhead
  ctx.beginPath()
  ctx.moveTo(ex,ey)
  ctx.lineTo(ex-hs*Math.cos(ang-0.35),ey-hs*Math.sin(ang-0.35))
  ctx.lineTo(ex-hs*Math.cos(ang+0.35),ey-hs*Math.sin(ang+0.35))
  ctx.closePath(); ctx.fillStyle=color; ctx.fill()
  // Label pill
  const lx=ex+10*Math.cos(ang), ly=ey+10*Math.sin(ang)
  const str=`${label}=${mag.toFixed(1)}N`
  ctx.font='bold 10px Consolas,monospace'
  const tw=ctx.measureText(str).width
  ctx.globalAlpha=0.72; ctx.fillStyle='#06090ccc'
  ctx.beginPath(); ctx.roundRect(lx-2,ly-12,tw+8,15,3); ctx.fill()
  ctx.globalAlpha=1; ctx.fillStyle=color
  ctx.fillText(str,lx+2,ly)
  ctx.restore()
}

function drawDim(ctx, p1, p2, text, color) {
  const dx=p2.x-p1.x, dy=p2.y-p1.y
  const len=Math.sqrt(dx*dx+dy*dy)||1
  const nx=-dy/len*20, ny=dx/len*20
  const ox1=p1.x+nx,oy1=p1.y+ny,ox2=p2.x+nx,oy2=p2.y+ny
  ctx.save(); ctx.globalAlpha=0.38
  ctx.strokeStyle=color; ctx.lineWidth=1; ctx.setLineDash([3,4])
  ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(ox1,oy1); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(p2.x,p2.y); ctx.lineTo(ox2,oy2); ctx.stroke()
  ctx.setLineDash([])
  ctx.beginPath(); ctx.moveTo(ox1,oy1); ctx.lineTo(ox2,oy2); ctx.stroke()
  dimArr(ctx,ox1,oy1,ox2,oy2,color); dimArr(ctx,ox2,oy2,ox1,oy1,color)
  ctx.globalAlpha=0.65; ctx.fillStyle=color; ctx.font='bold 9px Consolas,monospace'
  ctx.textAlign='center'; ctx.fillText(text,(ox1+ox2)/2,(oy1+oy2)/2-4)
  ctx.textAlign='left'; ctx.restore()
}

function dimArr(ctx,x1,y1,x2,y2,color) {
  const a=Math.atan2(y2-y1,x2-x1)
  ctx.beginPath()
  ctx.moveTo(x1,y1); ctx.lineTo(x1+7*Math.cos(a-0.4),y1+7*Math.sin(a-0.4))
  ctx.moveTo(x1,y1); ctx.lineTo(x1+7*Math.cos(a+0.4),y1+7*Math.sin(a+0.4))
  ctx.strokeStyle=color; ctx.lineWidth=1; ctx.stroke()
}

function btnStyle(bg, color='#fff') {
  return {
    padding: '4px 10px', borderRadius: 5, border: 'none',
    background: bg, color, fontWeight: 700, cursor: 'pointer',
    fontSize: 11, letterSpacing: '0.03em',
  }
}
