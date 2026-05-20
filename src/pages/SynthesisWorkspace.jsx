import { useEffect, useRef, useCallback, useState } from 'react'
import useMechanismStore from '../store/useMechanismStore'
const { setActivePage, setMechanism, updateLinkLength } = useMechanismStore.getState()
import {
  burmesterSynthesis, grashofCheck,
  computeCouplerCurve, forwardKinematicsRaw, computeRMSError,
  velocityAnalysis, accelerationAnalysis,
} from '../engine/synthesis'
import TransmissionGauge from '../components/TransmissionGauge'
import AccuracyBadge from '../components/AccuracyBadge'

const SCALE = 2.5
const DEG   = Math.PI / 180
const RAD   = 180 / Math.PI

// ── Vector display modes ──────────────────────────────────────────
const VECTOR_MODES = [
  { id: 'none',   label: 'None',         color: '#555' },
  { id: 'vel',    label: 'Velocity',     color: '#00b4ff' },
  { id: 'accel',  label: 'Acceleration', color: '#ff9800' },
  { id: 'force',  label: 'Force',        color: '#c0392b' },
  { id: 'all',    label: 'All Vectors',  color: '#8b5cf6' },
]

const LINK_MASS = 0.3 // kg per link (approx)

export default function SynthesisWorkspace() {
  const mechanism       = useMechanismStore(s => s.mechanism)
  const precisionPoints = useMechanismStore(s => s.precisionPoints)
  const patientData     = useMechanismStore(s => s.patientData)

  const canvasRef = useRef(null)
  const animRef   = useRef(null)
  const angleRef  = useRef(0)           // FIX: was useRef(crankAngle) — crankAngle not in scope
  const mechRef   = useRef(mechanism)

  const [localAngle, setLocalAngle] = useState(0)
  const [mu,         setMu]         = useState(45)
  const [playing,    setPlaying]    = useState(true)
  const [speed,      setSpeed]      = useState(1)          // 0.25 – 4x
  const [vectorMode, setVectorMode] = useState('vel')
  const [showCurve,  setShowCurve]  = useState(true)
  const [showDims,   setShowDims]   = useState(true)
  const [showGrid,   setShowGrid]   = useState(true)
  const [showIC,     setShowIC]     = useState(false)
  const [nPts,       setNPts]       = useState(3)

  const playingRef    = useRef(playing)
  const speedRef      = useRef(speed)
  const vectorModeRef = useRef(vectorMode)
  const showCurveRef  = useRef(showCurve)
  const showDimsRef   = useRef(showDims)
  const showGridRef   = useRef(showGrid)
  const showICRef     = useRef(showIC)

  // Keep all refs in sync
  useEffect(() => { mechRef.current     = mechanism },   [mechanism])
  useEffect(() => { playingRef.current  = playing },     [playing])
  useEffect(() => { speedRef.current    = speed },       [speed])
  useEffect(() => { vectorModeRef.current = vectorMode },[vectorMode])
  useEffect(() => { showCurveRef.current  = showCurve }, [showCurve])
  useEffect(() => { showDimsRef.current   = showDims },  [showDims])
  useEffect(() => { showGridRef.current   = showGrid },  [showGrid])
  useEffect(() => { showICRef.current     = showIC },    [showIC])

  // Auto-synthesize when precision points change
  useEffect(() => { runSynthesis() }, [precisionPoints])

  function runSynthesis() {
    try {
      if (!precisionPoints.length) return
      const synth   = burmesterSynthesis(precisionPoints, { d: 150, angleOffset: 0 })
      const grashof = grashofCheck(synth.L1, synth.L2, synth.L3, synth.L4)
      const { rmsError, accuracyScore } = computeRMSError(
        { ...synth, O4: synth.O4 }, precisionPoints,
        patientData.romStart, patientData.romEnd,
      )
      setMechanism({ ...synth, grashof, rmsError, accuracyScore })
    } catch (e) {
      console.warn('[Synthesis]', e.message)
    }
  }

  // Animation loop — single RAF, refs for all mutable state
  useEffect(() => {
    let last = performance.now()
    function tick(now) {
      const dt = (now - last) / 1000
      last = now
      if (playingRef.current) {
        angleRef.current = (angleRef.current + dt * 60 * speedRef.current) % 360
      }
      setLocalAngle(angleRef.current)
      try { drawFrame(angleRef.current, mechRef.current) } catch (_) {}
      animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRef.current)
  }, [])

  const toCanvas = useCallback((x, y) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const W = canvas.width, H = canvas.height
    return { x: W * 0.28 + x * SCALE, y: H * 0.70 - y * SCALE }
  }, [])

  // ── Main draw ─────────────────────────────────────────────────
  function drawFrame(angle, mech) {
    const canvas = canvasRef.current
    if (!canvas || !mech?.L1) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)

    // Background gradient
    const bg = ctx.createRadialGradient(W * 0.4, H * 0.5, 0, W * 0.4, H * 0.5, W * 0.7)
    bg.addColorStop(0, '#0d1117')
    bg.addColorStop(1, '#060a0d')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // Grid
    if (showGridRef.current) drawGrid(ctx, W, H)

    // Axes
    drawAxes(ctx, W, H)

    const { L1, L2, L3, L4, O2, O4 } = mech

    // Coupler curve
    if (showCurveRef.current) drawCouplerCurve(ctx, mech, patientData)

    // FK
    const fk = forwardKinematicsRaw(angle * DEG, L1, L2, L3, L4, O2, O4)
    if (!fk) return

    const pO2 = toCanvas(O2.x, O2.y)
    const pO4 = toCanvas(O4.x, O4.y)
    const pA  = toCanvas(fk.A.x, fk.A.y)
    const pB  = toCanvas(fk.B.x, fk.B.y)
    const pCP = toCanvas((fk.A.x + fk.B.x) / 2, (fk.A.y + fk.B.y) / 2)

    // Dimension lines
    if (showDimsRef.current) {
      drawDimLine(ctx, pO2, pA,  L2.toFixed(0) + ' mm', '#c0392b')
      drawDimLine(ctx, pA,  pB,  L3.toFixed(0) + ' mm', '#4a9eff')
      drawDimLine(ctx, pO4, pB,  L4.toFixed(0) + ' mm', '#00c851')
      drawGroundDim(ctx, pO2, pO4, L1.toFixed(0) + ' mm')
    }

    // CAD links (filled rounded rects)
    drawCADLink(ctx, pO2, pA,  '#c0392b', 8,  false)   // crank
    drawCADLink(ctx, pA,  pB,  '#2a4a6b', 6,  false)   // coupler
    drawCADLink(ctx, pO4, pB,  '#1a4a2a', 8,  false)   // rocker

    // Ground bar
    drawGroundBar(ctx, pO2, pO4)

    // Vector overlays
    const vm = vectorModeRef.current
    const omega2 = 10 * speedRef.current
    const velData   = (vm === 'vel' || vm === 'all' || vm === 'force') ? velocityAnalysis(angle, omega2, L1, L2, L3, L4, O2, O4) : null
    const accelData = (vm === 'accel' || vm === 'all' || vm === 'force') ? accelerationAnalysis(angle, omega2, 0, L1, L2, L3, L4, O2, O4) : null

    if (vm === 'vel' || vm === 'all') {
      if (velData) {
        const velScale = 0.6
        drawVector(ctx, pA,  velData.VA,  velScale, '#00b4ff', 'Va',    true)
        drawVector(ctx, pB,  velData.VB,  velScale, '#00e5ff', 'Vb',    true)
        drawVector(ctx, pA,  velData.VBA, velScale, '#80d8ff', 'Vba',   false)
      }
    }
    if (vm === 'accel' || vm === 'all') {
      if (accelData) {
        const aScale = 0.04
        drawVector(ctx, pA,  accelData.AA,  aScale, '#ff9800', 'Aa',   true)
        drawVector(ctx, pB,  accelData.AB,  aScale, '#ffb74d', 'Ab',   true)
        // Normal + tangential components
        drawVector(ctx, pA,  accelData.AA_n, aScale, '#ff6d00', 'Aa_n', false)
        drawVector(ctx, pA,  accelData.AA_t, aScale, '#ffd54f', 'Aa_t', false)
      }
    }
    if (vm === 'force' || vm === 'all') {
      if (accelData) {
        const fScale = 0.04 * LINK_MASS
        const FA = { x: accelData.AA.x * LINK_MASS, y: accelData.AA.y * LINK_MASS }
        const FB = { x: accelData.AB.x * LINK_MASS, y: accelData.AB.y * LINK_MASS }
        drawVector(ctx, pA,  FA, fScale * 28, '#e91e63', 'Fa (N)', true)
        drawVector(ctx, pB,  FB, fScale * 28, '#f48fb1', 'Fb (N)', true)
        drawVector(ctx, pCP, FB, fScale * 14, '#ad1457', 'Fc',     false)
      }
    }

    // Instant centers
    if (showICRef.current) drawInstantCenters(ctx, angle, mech)

    // CAD pivots (on top of vectors)
    drawCADPivot(ctx, pO2, '#c0392b', 11, 'O2', true)
    drawCADPivot(ctx, pO4, '#00c851', 11, 'O4', true)
    drawCADPivot(ctx, pA,  '#4a9eff', 8,  'A',  false)
    drawCADPivot(ctx, pB,  '#4a9eff', 8,  'B',  false)

    // Coupler point
    ctx.beginPath(); ctx.arc(pCP.x, pCP.y, 5, 0, 2 * Math.PI)
    ctx.fillStyle = '#ff6b6b'
    ctx.shadowBlur = 14; ctx.shadowColor = '#ff6b6b'; ctx.fill(); ctx.shadowBlur = 0

    // HUD overlay
    drawHUD(ctx, W, H, angle, velData, accelData, vm, mech)

    // Transmission angle
    setMu(computeMu(angle, mech))
  }

  // ── Sub-draw functions ────────────────────────────────────────

  function drawGrid(ctx, W, H) {
    const minor = 25 * SCALE, major = 100 * SCALE
    ctx.lineWidth = 1
    for (let x = 0; x < W; x += minor) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H)
      ctx.strokeStyle = (Math.round(x / minor) % 4 === 0) ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)'
      ctx.stroke()
    }
    for (let y = 0; y < H; y += minor) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y)
      ctx.strokeStyle = (Math.round(y / minor) % 4 === 0) ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)'
      ctx.stroke()
    }
  }

  function drawAxes(ctx, W, H) {
    const origin = toCanvas(0, 0)
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1.5
    ctx.setLineDash([6, 6])
    ctx.beginPath(); ctx.moveTo(origin.x, 0); ctx.lineTo(origin.x, H); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, origin.y); ctx.lineTo(W, origin.y); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.font = '10px Consolas,monospace'
    ctx.fillText('x', origin.x + 6, origin.y - 8)
    ctx.fillText('y', origin.x + 6, origin.y - 20)
  }

  function drawCouplerCurve(ctx, mech, pd) {
    const { L1, L2, L3, L4, O2, O4 } = mech
    const curve = computeCouplerCurve(L1, L2, L3, L4, O2, O4, 360)
    if (curve.length < 2) return

    // Gradient stroke by ROM deviation
    ctx.lineWidth = 2
    for (let i = 0; i < curve.length - 1; i++) {
      const pt  = curve[i]
      const pt2 = curve[i + 1]
      const p1  = toCanvas(pt.x,  pt.y)
      const p2  = toCanvas(pt2.x, pt2.y)
      const mid = (pd.romStart + pd.romEnd) / 2
      const dev = Math.min(1, Math.abs(pt.theta4 - mid) / Math.max(1, pd.romEnd - pd.romStart))
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y)
      ctx.strokeStyle = `rgba(${Math.round(dev * 180)},${Math.round((1 - dev) * 120 + 80)},255,0.5)`
      ctx.stroke()
    }
  }

  function drawGroundBar(ctx, p1, p2) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y
    const len = Math.sqrt(dx * dx + dy * dy) + 0.001
    const nx = -dy / len, ny = dx / len

    ctx.strokeStyle = '#1e2a1e'; ctx.lineWidth = 10; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke()
    ctx.strokeStyle = '#2a3a2a'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke()

    // Hatch marks below ground bar
    const count = 6
    for (let i = 0; i <= count; i++) {
      const t = i / count
      const bx = p1.x + t * dx, by = p1.y + t * dy
      ctx.beginPath()
      ctx.moveTo(bx + nx * 8, by + ny * 8)
      ctx.lineTo(bx + nx * 16, by + ny * 16)
      ctx.strokeStyle = '#2a3a2a'; ctx.lineWidth = 1.5; ctx.stroke()
    }
  }

  function drawCADLink(ctx, p1, p2, color, halfW, dashed) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y
    const len = Math.sqrt(dx * dx + dy * dy) + 0.001
    const ux = dx / len, uy = dy / len
    const nx = -uy * halfW, ny = ux * halfW

    ctx.save()
    if (dashed) ctx.setLineDash([8, 4])

    // Body fill
    ctx.beginPath()
    ctx.moveTo(p1.x + nx, p1.y + ny)
    ctx.lineTo(p2.x + nx, p2.y + ny)
    ctx.arc(p2.x, p2.y, halfW, Math.atan2(ny, nx), Math.atan2(-ny, -nx), false)
    ctx.lineTo(p1.x - nx, p1.y - ny)
    ctx.arc(p1.x, p1.y, halfW, Math.atan2(-ny, -nx), Math.atan2(ny, nx), false)
    ctx.closePath()
    ctx.fillStyle = color + '22'
    ctx.fill()
    ctx.strokeStyle = color + 'cc'; ctx.lineWidth = 1.5; ctx.stroke()

    // Center line
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y)
    ctx.strokeStyle = color + '55'; ctx.lineWidth = 1; ctx.setLineDash([4, 4])
    ctx.stroke(); ctx.setLineDash([])

    ctx.restore()
  }

  function drawCADPivot(ctx, p, color, r, label, isGround) {
    // Outer ring
    ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, 2 * Math.PI)
    ctx.strokeStyle = color + '44'; ctx.lineWidth = 1; ctx.stroke()

    // Main circle
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI)
    ctx.fillStyle = color + '33'
    ctx.shadowBlur = 12; ctx.shadowColor = color
    ctx.fill()
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke()
    ctx.shadowBlur = 0

    // Inner dot
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 2 * Math.PI)
    ctx.fillStyle = color; ctx.fill()

    // Ground triangle
    if (isGround) {
      const th = 14
      ctx.beginPath()
      ctx.moveTo(p.x, p.y + r + 2)
      ctx.lineTo(p.x - th / 2, p.y + r + th)
      ctx.lineTo(p.x + th / 2, p.y + r + th)
      ctx.closePath()
      ctx.strokeStyle = color + '88'; ctx.lineWidth = 1.5; ctx.stroke()
      // Ground line
      ctx.beginPath()
      ctx.moveTo(p.x - th / 2 - 4, p.y + r + th)
      ctx.lineTo(p.x + th / 2 + 4, p.y + r + th)
      ctx.strokeStyle = color + '66'; ctx.lineWidth = 2; ctx.stroke()
    }

    if (label) {
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 11px Consolas,monospace'
      ctx.textAlign = 'center'
      ctx.fillText(label, p.x, p.y - r - 8)
      ctx.textAlign = 'left'
    }
  }

  // Dimension line with arrows
  function drawDimLine(ctx, p1, p2, text, color) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y
    const len = Math.sqrt(dx * dx + dy * dy) + 0.001
    const nx = -dy / len * 18, ny = dx / len * 18

    // Offset line
    const ox1 = p1.x + nx, oy1 = p1.y + ny
    const ox2 = p2.x + nx, oy2 = p2.y + ny

    ctx.save()
    ctx.globalAlpha = 0.5
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([3, 3])
    // Extension lines
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(ox1, oy1); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(p2.x, p2.y); ctx.lineTo(ox2, oy2); ctx.stroke()
    // Dim line
    ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(ox1, oy1); ctx.lineTo(ox2, oy2); ctx.stroke()
    // Arrows
    drawDimArrow(ctx, ox1, oy1, ox2, oy2, color)
    drawDimArrow(ctx, ox2, oy2, ox1, oy1, color)
    // Label
    ctx.fillStyle = color; ctx.font = '9px Consolas,monospace'
    ctx.globalAlpha = 0.8
    ctx.textAlign = 'center'
    ctx.fillText(text, (ox1 + ox2) / 2, (oy1 + oy2) / 2 - 5)
    ctx.textAlign = 'left'
    ctx.restore()
  }

  function drawGroundDim(ctx, p1, p2, text) {
    ctx.save()
    ctx.globalAlpha = 0.35
    const my = Math.max(p1.y, p2.y) + 28
    ctx.strokeStyle = '#888'; ctx.lineWidth = 1; ctx.setLineDash([3, 3])
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p1.x, my + 4); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(p2.x, p2.y); ctx.lineTo(p2.x, my + 4); ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(p1.x, my); ctx.lineTo(p2.x, my); ctx.stroke()
    drawDimArrow(ctx, p1.x, my, p2.x, my, '#888')
    drawDimArrow(ctx, p2.x, my, p1.x, my, '#888')
    ctx.fillStyle = '#888'; ctx.font = '9px Consolas,monospace'
    ctx.textAlign = 'center'
    ctx.fillText(text, (p1.x + p2.x) / 2, my - 5)
    ctx.textAlign = 'left'
    ctx.restore()
  }

  function drawDimArrow(ctx, x1, y1, x2, y2, color) {
    const ang = Math.atan2(y2 - y1, x2 - x1)
    const hs = 6
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x1 + hs * Math.cos(ang - 0.4), y1 + hs * Math.sin(ang - 0.4))
    ctx.moveTo(x1, y1)
    ctx.lineTo(x1 + hs * Math.cos(ang + 0.4), y1 + hs * Math.sin(ang + 0.4))
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke()
  }

  // Vector arrow with label and magnitude
  function drawVector(ctx, origin, vec, scale, color, label, showMag) {
    if (!vec) return
    const mag = Math.sqrt(vec.x * vec.x + vec.y * vec.y)
    if (mag < 0.01) return

    const ex = origin.x + vec.x * scale
    const ey = origin.y - vec.y * scale
    const ang = Math.atan2(ey - origin.y, ex - origin.x)
    const hs  = 12

    // Dashed stem
    ctx.save()
    ctx.globalAlpha = 0.85
    ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(ex, ey)
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineCap = 'round'
    ctx.shadowBlur = 6; ctx.shadowColor = color
    ctx.stroke()

    // Arrowhead
    ctx.beginPath()
    ctx.moveTo(ex, ey)
    ctx.lineTo(ex - hs * Math.cos(ang - 0.35), ey - hs * Math.sin(ang - 0.35))
    ctx.lineTo(ex - hs * Math.cos(ang + 0.35), ey - hs * Math.sin(ang + 0.35))
    ctx.closePath()
    ctx.fillStyle = color; ctx.fill()
    ctx.shadowBlur = 0

    // Label background pill
    const lx = ex + 8 * Math.cos(ang), ly = ey + 8 * Math.sin(ang)
    const labelStr = showMag ? `${label}=${mag.toFixed(1)}` : label
    ctx.font = 'bold 10px Consolas,monospace'
    const tw = ctx.measureText(labelStr).width
    ctx.globalAlpha = 0.75
    ctx.fillStyle = '#0a0a0acc'
    ctx.beginPath()
    ctx.roundRect(lx - 2, ly - 11, tw + 8, 15, 3)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.fillStyle = color
    ctx.fillText(labelStr, lx + 2, ly)
    ctx.restore()
  }

  function drawInstantCenters(ctx, angle, mech) {
    const { L1, L2, L3, L4, O2, O4 } = mech
    const fk = forwardKinematicsRaw(angle * DEG, L1, L2, L3, L4, O2, O4)
    if (!fk) return

    const centers = [
      { pt: O2, label: 'I12' },
      { pt: O4, label: 'I14' },
      { pt: fk.A, label: 'I23' },
      { pt: fk.B, label: 'I34' },
    ]
    for (const { pt, label } of centers) {
      const p = toCanvas(pt.x, pt.y)
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 2 * Math.PI)
      ctx.strokeStyle = '#8b5cf6'; ctx.lineWidth = 1.5; ctx.stroke()
      ctx.fillStyle = '#8b5cf666'; ctx.fill()
      ctx.fillStyle = '#8b5cf6'; ctx.font = '9px Consolas,monospace'
      ctx.fillText(label, p.x + 9, p.y + 4)
    }
  }

  // HUD info overlay (top-right of canvas)
  function drawHUD(ctx, W, H, angle, vel, accel, vm, mech) {
    const lines = [
      `Theta2 = ${angle.toFixed(1)} deg`,
      `omega2 = ${(10 * speedRef.current).toFixed(1)} rad/s`,
    ]
    if (vel) {
      const vA = Math.sqrt(vel.VA.x ** 2 + vel.VA.y ** 2)
      const vB = Math.sqrt(vel.VB.x ** 2 + vel.VB.y ** 2)
      lines.push(`|Va| = ${vA.toFixed(1)} mm/s`)
      lines.push(`|Vb| = ${vB.toFixed(1)} mm/s`)
      lines.push(`w3 = ${vel.omega3.toFixed(2)} rad/s`)
      lines.push(`w4 = ${vel.omega4.toFixed(2)} rad/s`)
    }
    if (accel && (vm === 'accel' || vm === 'force' || vm === 'all')) {
      const aA = Math.sqrt(accel.AA.x ** 2 + accel.AA.y ** 2)
      const aB = Math.sqrt(accel.AB.x ** 2 + accel.AB.y ** 2)
      lines.push(`|Aa| = ${aA.toFixed(1)} mm/s²`)
      lines.push(`|Ab| = ${aB.toFixed(1)} mm/s²`)
    }
    if (vm === 'force' && accel) {
      const fA = Math.sqrt(accel.AA.x ** 2 + accel.AA.y ** 2) * LINK_MASS
      const fB = Math.sqrt(accel.AB.x ** 2 + accel.AB.y ** 2) * LINK_MASS
      lines.push(`Fa = ${fA.toFixed(2)} N`)
      lines.push(`Fb = ${fB.toFixed(2)} N`)
    }

    const padX = 10, padY = 10, lineH = 17
    const boxW = 190, boxH = lines.length * lineH + 14

    ctx.save()
    ctx.globalAlpha = 0.82
    ctx.fillStyle = '#05090d'
    ctx.beginPath()
    ctx.roundRect(W - boxW - padX, padY, boxW, boxH, 6)
    ctx.fill()
    ctx.strokeStyle = '#1e2d40'; ctx.lineWidth = 1; ctx.stroke()
    ctx.globalAlpha = 1

    ctx.font = '11px Consolas,monospace'
    lines.forEach((line, i) => {
      const isAngle = line.startsWith('Theta') || line.startsWith('omega')
      ctx.fillStyle = isAngle ? '#00b4ff' : line.startsWith('|V') || line.startsWith('w') ? '#00b4ff' :
        line.startsWith('|A') ? '#ff9800' : line.startsWith('F') ? '#e91e63' : '#8899aa'
      ctx.fillText(line, W - boxW - padX + 10, padY + 13 + i * lineH)
    })
    ctx.restore()
  }

  function computeMu(angle, mech) {
    if (!mech?.L1) return 90
    const { L1, L2, L3, L4, O2, O4 } = mech
    const fk = forwardKinematicsRaw(angle * DEG, L1, L2, L3, L4, O2, O4)
    if (!fk) return 90
    const mu = Math.abs(fk.theta3 - fk.theta4) % Math.PI
    return Math.min(mu, Math.PI - mu) * RAD
  }

  // ── Derived state ──────────────────────────────────────────────
  const grashof      = mechanism?.grashof    || { type: ' - ', passes: false }
  const accuracyScore = mechanism?.accuracyScore ?? 0
  const rmsError      = mechanism?.rmsError     ?? 0

  const handleLinkSlider = (key, value) => {
    updateLinkLength(key, value)
    runSynthesis()
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#08090c' }}>

      {/* ── Canvas column (65%) ── */}
      <div style={{ flex: '0 0 65%', display: 'flex', flexDirection: 'column', padding: 14, gap: 10 }}>

        {/* Toolbar */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Play / Pause */}
          <button
            onClick={() => setPlaying(v => !v)}
            style={btnStyle(playing ? '#c0392b' : '#1e2a1e')}
          >
            {playing ? '|| Pause' : '> Play'}
          </button>

          {/* Speed */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#111', borderRadius: 6, padding: '4px 10px' }}>
            <span style={{ color: '#555', fontSize: 11, fontWeight: 700 }}>SPD</span>
            {[0.25, 0.5, 1, 2, 4].map(s => (
              <button key={s}
                onClick={() => setSpeed(s)}
                style={{
                  padding: '3px 8px', borderRadius: 4, border: 'none',
                  background: speed === s ? '#c0392b' : 'transparent',
                  color: speed === s ? '#fff' : '#555',
                  fontWeight: 700, fontSize: 11, cursor: 'pointer',
                }}
              >{s}x</button>
            ))}
          </div>

          {/* Vector mode pills */}
          <div style={{ display: 'flex', gap: 4, background: '#0f1117', borderRadius: 6, padding: 4 }}>
            {VECTOR_MODES.map(vm => (
              <button key={vm.id}
                onClick={() => setVectorMode(vm.id)}
                style={{
                  padding: '4px 12px', borderRadius: 4, border: 'none',
                  background: vectorMode === vm.id ? vm.color + '33' : 'transparent',
                  color: vectorMode === vm.id ? vm.color : '#444',
                  fontWeight: 700, fontSize: 11, cursor: 'pointer',
                  borderBottom: vectorMode === vm.id ? `2px solid ${vm.color}` : '2px solid transparent',
                  transition: 'all 0.15s',
                }}
              >{vm.label}</button>
            ))}
          </div>

          {/* Toggle buttons */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 5 }}>
            {[
              { label: 'Curve',  val: showCurve,  set: setShowCurve },
              { label: 'Dims',   val: showDims,   set: setShowDims  },
              { label: 'Grid',   val: showGrid,   set: setShowGrid  },
              { label: 'IC',     val: showIC,     set: setShowIC    },
            ].map(t => (
              <button key={t.label}
                onClick={() => t.set(v => !v)}
                style={btnStyle(t.val ? '#1e2a3a' : '#111', t.val ? '#4a9eff' : '#444')}
              >{t.label}</button>
            ))}
          </div>
        </div>

        {/* Canvas */}
        <div style={{
          flex: 1, background: '#08090c', borderRadius: 10,
          border: '1px solid #151d28', overflow: 'hidden', position: 'relative',
        }}>
          <canvas ref={canvasRef} width={900} height={560} style={{ width: '100%', height: '100%' }} />

          {/* Precision point count pills */}
          <div style={{ position: 'absolute', bottom: 12, left: 12, display: 'flex', gap: 6 }}>
            <span style={{ color: '#333', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', alignSelf: 'center' }}>PREC PTS</span>
            {[3, 4, 5].map(n => (
              <button key={n}
                onClick={() => setNPts(n)}
                style={{
                  width: 28, height: 28, borderRadius: 6, border: 'none',
                  background: nPts === n ? '#c0392b' : '#1a1a1a',
                  color: nPts === n ? '#fff' : '#555',
                  fontWeight: 700, cursor: 'pointer', fontSize: 13,
                }}
              >{n}</button>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 14, fontSize: 11 }}>
          {[
            { color: '#c0392b', label: 'Crank (L2)' },
            { color: '#4a9eff', label: 'Coupler (L3)' },
            { color: '#00c851', label: 'Rocker (L4)' },
            { color: '#555',    label: 'Ground (L1)' },
            { color: '#00b4ff', label: 'Velocity' },
            { color: '#ff9800', label: 'Acceleration' },
            { color: '#e91e63', label: 'Force' },
          ].map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 16, height: 3, background: item.color, borderRadius: 2 }} />
              <span style={{ color: '#3a4a5a' }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right panel (35%) ── */}
      <div style={{
        flex: '0 0 35%', padding: 14, overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: 12,
        borderLeft: '1px solid #111820', background: '#0a0c10',
      }}>

        {/* Accuracy */}
        <Panel label="Synthesis Accuracy">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <AccuracyBadge score={accuracyScore} size="lg" />
            <div>
              <div style={{ color: '#3a4a5a', fontSize: 11 }}>RMS Error</div>
              <div style={{ fontFamily: 'Consolas,monospace', fontWeight: 700, color: '#c8d8e8', fontSize: 15 }}>
                {rmsError.toFixed(2)} deg
              </div>
            </div>
          </div>
        </Panel>

        {/* Grashof */}
        <Panel label="Grashof Condition">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{
              background: grashof.passes ? 'rgba(0,200,81,0.12)' : 'rgba(192,57,43,0.12)',
              color: grashof.passes ? '#00c851' : '#c0392b',
              border: `1px solid ${grashof.passes ? '#00c85133' : '#c0392b33'}`,
              borderRadius: 999, padding: '4px 14px', fontWeight: 800, fontSize: 12,
            }}>
              {grashof.passes ? 'PASS' : 'FAIL'}
            </span>
            <span style={{ color: '#8899aa', fontSize: 12 }}>{grashof.type}</span>
          </div>
        </Panel>

        {/* Transmission angle gauge */}
        <Panel label={`Transmission Angle  mu = ${mu.toFixed(1)} deg`}>
          <TransmissionGauge angle={mu} width={260} height={120} />
        </Panel>

        {/* Link length sliders */}
        <Panel label="Link Lengths (mm)">
          {[
            { key: 'L1', label: 'L1  Ground',  color: '#4a5568', min: 80,  max: 400 },
            { key: 'L2', label: 'L2  Crank',   color: '#c0392b', min: 20,  max: 200 },
            { key: 'L3', label: 'L3  Coupler', color: '#4a9eff', min: 40,  max: 350 },
            { key: 'L4', label: 'L4  Rocker',  color: '#00c851', min: 30,  max: 300 },
          ].map(({ key, label, color, min, max }) => (
            <div key={key} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color, fontSize: 12, fontWeight: 700 }}>{label}</span>
                <span style={{ fontFamily: 'Consolas,monospace', fontSize: 13, color: '#c8d8e8' }}>
                  {(mechanism?.[key] || 0).toFixed(1)}
                </span>
              </div>
              <input
                type="range" min={min} max={max} step="1"
                value={mechanism?.[key] || min}
                onChange={e => handleLinkSlider(key, +e.target.value)}
                style={{ width: '100%', accentColor: color }}
              />
            </div>
          ))}
        </Panel>

        {/* Vector info panel */}
        <Panel label="Vector Analysis">
          <div style={{ fontSize: 12, color: '#4a5a6a', lineHeight: 1.8, fontFamily: 'Consolas,monospace' }}>
            <div style={{ color: '#00b4ff' }}>VELOCITY</div>
            <div>Va  — crank pin A</div>
            <div>Vb  — rocker pin B</div>
            <div>Vba — coupler relative</div>
            <div style={{ color: '#ff9800', marginTop: 6 }}>ACCELERATION</div>
            <div>Aa, Aa_n (centripetal)</div>
            <div>Aa_t (tangential), Ab</div>
            <div style={{ color: '#e91e63', marginTop: 6 }}>FORCE  (F=m·a)</div>
            <div>Fa, Fb, Fc (coupler center)</div>
            <div style={{ color: '#555', marginTop: 6 }}>m = {LINK_MASS} kg / link</div>
          </div>
        </Panel>

        {/* Optimizer */}
        <button
          onClick={() => setActivePage('optimizer')}
          style={{
            background: 'linear-gradient(135deg,#c0392b,#922b21)',
            border: 'none', borderRadius: 8, padding: '13px 0',
            color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer',
            letterSpacing: '0.08em', boxShadow: '0 0 20px rgba(192,57,43,0.3)',
          }}
        >
          Run Optimizer *
        </button>
      </div>
    </div>
  )
}

// ── UI helpers ────────────────────────────────────────────────────

function btnStyle(bg, color = '#fff') {
  return {
    padding: '5px 12px', borderRadius: 6, border: 'none',
    background: bg, color,
    fontWeight: 700, cursor: 'pointer', fontSize: 11,
    letterSpacing: '0.05em',
  }
}

function Panel({ label, children }) {
  return (
    <div style={{ background: '#0d1117', border: '1px solid #151d28', borderRadius: 10, padding: 14 }}>
      <div style={{ color: '#2a3a4a', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>
        {label}
      </div>
      {children}
    </div>
  )
}
