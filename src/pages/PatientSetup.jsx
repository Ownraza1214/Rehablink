import { useState, useEffect, useRef, useCallback } from 'react'
import useMechanismStore from '../store/useMechanismStore'
const { setActivePage, setPatient, setPrecisionPoints, setMechanism } = useMechanismStore.getState()
import {
  chebyshevSpacing, burmesterSynthesis, grashofCheck,
  computeRMSError, forwardKinematicsRaw,
} from '../engine/synthesis'

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

// ── Grid search ───────────────────────────────────────────────────────────────
function computeMu(theta3, theta4) {
  const mu = Math.abs(theta3 - theta4) % Math.PI
  return Math.min(mu, Math.PI - mu) * RAD
}

function findBestMechanisms(romStart, romEnd) {
  const dValues    = [70, 90, 110, 130, 150, 180, 210, 250, 300]
  const offsets    = [-60, -45, -30, -15, 0, 15, 30, 45, 60]
  const nValues    = [3, 4, 5]
  const results    = []

  for (const n of nValues) {
    const outPts   = chebyshevSpacing(n, romStart, romEnd)
    const inPts    = chebyshevSpacing(n, 0, 270)
    const precision = inPts.map((ti, i) => ({ theta_in: ti, theta_out: outPts[i] }))

    for (const d of dValues) {
      for (const offset of offsets) {
        try {
          const synth = burmesterSynthesis(precision, { d, angleOffset: offset })
          if (!synth) continue
          const { L1, L2, L3, L4, O2, O4 } = synth
          if (L1 <= 5 || L2 <= 5 || L3 <= 5 || L4 <= 5) continue

          const grashof = grashofCheck(L1, L2, L3, L4)

          let minMu = 180, valid = true
          for (let t = 0; t <= 360; t += 6) {
            const fk = forwardKinematicsRaw(t * DEG, L1, L2, L3, L4, O2, O4)
            if (!fk) { valid = false; break }
            minMu = Math.min(minMu, computeMu(fk.theta3, fk.theta4))
          }
          if (!valid) continue

          const { rmsError, accuracyScore } = computeRMSError({ ...synth }, precision, romStart, romEnd)

          let score = 0
          if (grashof.passes)    score += 50
          if (minMu >= 30)       score += 25
          if (minMu >= 45)       score += 10
          if (accuracyScore >= 80) score += 15
          if (accuracyScore >= 90) score += 10
          score += Math.min(minMu, 60) * 0.35
          score += Math.min(accuracyScore, 100) * 0.12

          const passCount = [
            grashof.passes,
            minMu >= 30,
            accuracyScore >= 80,
            L1 > 0 && L2 > 0 && L3 > 0 && L4 > 0,
          ].filter(Boolean).length

          results.push({ n, d, offset, synth, grashof, minMu, accuracyScore, rmsError, precision, score, passCount })
        } catch (_) {}
      }
    }
  }

  results.sort((a, b) => b.score - a.score)

  // Pick top 5 with diversity
  const top = [], seen = new Set()
  for (const r of results) {
    if (top.length >= 5) break
    const key = `${r.n}_${Math.round(r.score / 3)}`
    if (!seen.has(key)) { seen.add(key); top.push(r) }
  }
  if (top.length === 0) top.push(...results.slice(0, 3))
  return top
}

// ── Canvas drawing ────────────────────────────────────────────────────────────
const LINK_COLORS = { crank: '#4a9eff', coupler: '#ffd93d', rocker: '#6bcb77', ground: '#3a6090' }

function autoScale(synth, W, H) {
  const span = synth.L1 + Math.max(synth.L2, synth.L3, synth.L4) * 1.4
  return Math.min(W * 0.52, H * 0.42) / span
}

function drawFrame(ctx, sol, theta2, W, H) {
  if (!sol?.synth) return
  const { L1, L2, L3, L4, O2, O4 } = sol.synth
  const S = autoScale(sol.synth, W, H)
  const ox = W * 0.28, oy = H * 0.54

  const tx = p => ox + p.x * S
  const ty = p => oy - p.y * S

  const fk = forwardKinematicsRaw(theta2, L1, L2, L3, L4, O2, O4)
  if (!fk) return

  const pO2 = { x: tx(O2), y: ty(O2) }
  const pO4 = { x: tx(O4), y: ty(O4) }
  const pA  = { x: tx(fk.A), y: ty(fk.A) }
  const pB  = { x: tx(fk.B), y: ty(fk.B) }

  const thickLink = (p1, p2, col, hw) => {
    const dx = p2.x - p1.x, dy = p2.y - p1.y
    const len = Math.hypot(dx, dy)
    if (len < 1) return
    const nx = (-dy / len) * hw, ny = (dx / len) * hw
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(p1.x + nx, p1.y + ny); ctx.lineTo(p2.x + nx, p2.y + ny)
    ctx.lineTo(p2.x - nx, p2.y - ny); ctx.lineTo(p1.x - nx, p1.y - ny)
    ctx.closePath()
    ctx.fillStyle = col + '18'; ctx.fill()
    ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.stroke()
    ctx.restore()
  }

  const pivot = (p, r, col) => {
    ctx.save()
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI)
    ctx.fillStyle = col + '22'; ctx.fill()
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke()
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.32, 0, 2 * Math.PI)
    ctx.fillStyle = col; ctx.fill()
    ctx.restore()
  }

  const groundPin = (p, col) => {
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(p.x - 9, p.y + 8); ctx.lineTo(p.x, p.y); ctx.lineTo(p.x + 9, p.y + 8)
    ctx.moveTo(p.x - 9, p.y + 8); ctx.lineTo(p.x + 9, p.y + 8); ctx.stroke()
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath()
      ctx.moveTo(p.x + i * 4 - 4, p.y + 8); ctx.lineTo(p.x + i * 4, p.y + 14)
      ctx.stroke()
    }
    ctx.restore()
  }

  const hw = Math.max(3.5, S * 7)

  // Ground dashed line
  ctx.save(); ctx.setLineDash([5, 4])
  ctx.strokeStyle = LINK_COLORS.ground + '44'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(pO2.x, pO2.y); ctx.lineTo(pO4.x, pO4.y); ctx.stroke()
  ctx.setLineDash([]); ctx.restore()

  thickLink(pO2, pA, LINK_COLORS.crank, hw)
  thickLink(pA, pB, LINK_COLORS.coupler, hw * 0.85)
  thickLink(pO4, pB, LINK_COLORS.rocker, hw)

  const pr = Math.max(5, S * 9)
  pivot(pA, pr * 0.65, LINK_COLORS.crank)
  pivot(pB, pr * 0.65, LINK_COLORS.rocker)
  pivot(pO2, pr, LINK_COLORS.crank)
  pivot(pO4, pr, LINK_COLORS.rocker)

  groundPin(pO2, LINK_COLORS.crank)
  groundPin(pO4, LINK_COLORS.rocker)

  // Dimension labels
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const mCrank = mid(pO2, pA), mCoup = mid(pA, pB), mRock = mid(pO4, pB)
  ctx.save(); ctx.font = '9px Consolas,monospace'
  const lbl = (p, text, col) => {
    ctx.fillStyle = col + 'aa'
    ctx.fillText(text, p.x + 5, p.y - 5)
  }
  lbl(mCrank, `L2=${L2.toFixed(0)}mm`, LINK_COLORS.crank)
  lbl(mCoup,  `L3=${L3.toFixed(0)}mm`, LINK_COLORS.coupler)
  lbl(mRock,  `L4=${L4.toFixed(0)}mm`, LINK_COLORS.rocker)
  ctx.fillStyle = LINK_COLORS.ground + '55'
  ctx.fillText(`L1=${L1.toFixed(0)}mm`, (pO2.x + pO4.x) / 2 - 20, Math.max(pO2.y, pO4.y) + 22)
  // Node labels
  ctx.font = 'bold 10px Consolas,monospace'
  const nlbl = (p, t, col) => { ctx.fillStyle = col + '88'; ctx.fillText(t, p.x - 18, p.y - pr - 5) }
  nlbl(pO2, 'O₂', LINK_COLORS.crank)
  nlbl(pO4, 'O₄', LINK_COLORS.rocker)
  ctx.fillStyle = LINK_COLORS.crank + '77'; ctx.fillText('A', pA.x + pr + 2, pA.y - 4)
  ctx.fillStyle = LINK_COLORS.rocker + '77'; ctx.fillText('B', pB.x + pr + 2, pB.y - 4)
  ctx.restore()
}

function drawCanvas(canvas, solutions, activeIdx, theta2) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)

  ctx.fillStyle = '#050f28'; ctx.fillRect(0, 0, W, H)
  const GS = 20; ctx.lineWidth = 0.35
  for (let x = 0; x <= W; x += GS) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H)
    ctx.strokeStyle = x % (GS * 5) === 0 ? '#0e2248' : '#081530'; ctx.stroke()
  }
  for (let y = 0; y <= H; y += GS) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y)
    ctx.strokeStyle = y % (GS * 5) === 0 ? '#0e2248' : '#081530'; ctx.stroke()
  }

  if (!solutions || solutions.length === 0) {
    ctx.fillStyle = '#1a3560'; ctx.font = '12px Consolas,monospace'
    ctx.textAlign = 'center'
    ctx.fillText('Computing optimal mechanisms…', W / 2, H / 2 - 10)
    ctx.fillStyle = '#0f1e3a'; ctx.font = '10px Consolas,monospace'
    ctx.fillText('Grid search: N={3,4,5} × d={9 values} × offset={9 values}', W / 2, H / 2 + 12)
    ctx.textAlign = 'left'
  } else {
    const sol = solutions[activeIdx] || solutions[0]
    drawFrame(ctx, sol, theta2, W, H)
  }

  // Title block
  const sol = solutions?.[activeIdx] || solutions?.[0]
  ctx.fillStyle = '#040d20'; ctx.fillRect(0, H - 36, W, 36)
  ctx.strokeStyle = '#0c1e3a'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, H - 36); ctx.lineTo(W, H - 36); ctx.stroke()
  ctx.font = '8px Consolas,monospace'; ctx.fillStyle = '#1a3a60'
  if (sol) {
    ctx.fillText(
      `REHABLINK · MECHANISM · SOL ${activeIdx + 1}/${solutions.length} · N=${sol.n} · d=${sol.d}mm · offset=${sol.offset}°`,
      10, H - 22,
    )
    ctx.fillText(
      `Grashof: ${sol.grashof.passes ? '✓ PASS' : '✗ FAIL'} · μ_min=${sol.minMu.toFixed(1)}° · Accuracy=${sol.accuracyScore.toFixed(1)}% · ${sol.passCount}/4 conditions`,
      10, H - 10,
    )
  } else {
    ctx.fillText('REHABLINK · BURMESTER FOUR-BAR SYNTHESIS · AWAITING SEARCH', 10, H - 14)
  }
  ctx.strokeStyle = '#0e2248'; ctx.lineWidth = 2
  ctx.strokeRect(3, 3, W - 6, H - 6)
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PatientSetup() {
  const patientData = useMechanismStore(s => s.patientData)

  const [form,      setForm]      = useState({ ...patientData })
  const [solutions, setSolutions] = useState([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [searching, setSearching] = useState(false)
  const [playing,   setPlaying]   = useState(true)

  const canvasRef   = useRef(null)
  const angleRef    = useRef(0)
  const rafRef      = useRef(null)
  const playRef     = useRef(true)
  const solRef      = useRef([])
  const idxRef      = useRef(0)
  const debounceRef = useRef(null)

  // Keep refs in sync
  useEffect(() => { solRef.current = solutions }, [solutions])
  useEffect(() => { idxRef.current = activeIdx }, [activeIdx])
  useEffect(() => { playRef.current = playing }, [playing])

  // Grid search — debounced on ROM change
  const runSearch = useCallback((rs, re) => {
    setSearching(true)
    setSolutions([])
    // Use setTimeout(0) so React renders "searching" state first
    setTimeout(() => {
      const found = findBestMechanisms(rs, re)
      setSolutions(found)
      setActiveIdx(0)
      if (found.length > 0) {
        const best = found[0]
        setPrecisionPoints(best.precision)
        setMechanism({
          ...best.synth,
          grashof:       best.grashof,
          minMu:         best.minMu,
          rmsError:      best.rmsError,
          accuracyScore: best.accuracyScore,
        })
      }
      setSearching(false)
    }, 0)
  }, [])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(form.romStart, form.romEnd), 450)
    return () => clearTimeout(debounceRef.current)
  }, [form.romStart, form.romEnd, runSearch])

  // Animation loop
  useEffect(() => {
    const loop = () => {
      if (playRef.current) {
        angleRef.current = (angleRef.current + 0.012) % (2 * Math.PI)
      }
      drawCanvas(canvasRef.current, solRef.current, idxRef.current, angleRef.current)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(rafRef.current) }
  }, [])

  const applySolution = (sol, idx) => {
    setActiveIdx(idx)
    setPrecisionPoints(sol.precision)
    setMechanism({
      ...sol.synth,
      grashof:       sol.grashof,
      minMu:         sol.minMu,
      rmsError:      sol.rmsError,
      accuracyScore: sol.accuracyScore,
    })
  }

  const handleSave = () => {
    setPatient({ ...form })
    setActivePage('synthesis')
  }

  const activeSol = solutions[activeIdx]
  const condColors = ['#4a9eff', '#ffd93d', '#27ae60', '#c07fff']
  const condLabels = ['Grashof', 'Trans.Angle ≥30°', 'Accuracy ≥80%', 'Links > 0']

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#060810', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{
        padding: '12px 22px', borderBottom: '1px solid #0e1520',
        background: '#07090f', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#e8eaf0', letterSpacing: '0.05em' }}>
            Patient Configuration
          </div>
          <div style={{ color: '#253548', fontSize: 10, marginTop: 1, letterSpacing: '0.08em' }}>
            Auto Grid Search · Chebyshev Precision Points · One-Click Apply
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {searching && (
            <div style={{
              background: '#0d1830', border: '1px solid #1a3060',
              borderRadius: 6, padding: '4px 12px', fontSize: 9,
              color: '#4a9eff', fontFamily: 'Consolas,monospace', fontWeight: 700,
              letterSpacing: '0.1em', animation: 'none',
            }}>
              ⟳ SEARCHING…
            </div>
          )}
          {solutions.length > 0 && !searching && (
            <div style={{
              background: '#0a1e12', border: '1px solid #27ae6044',
              borderRadius: 6, padding: '4px 12px', fontSize: 9,
              color: '#27ae60', fontFamily: 'Consolas,monospace', fontWeight: 700,
              letterSpacing: '0.1em',
            }}>
              {solutions.filter(s => s.passCount === 4).length > 0
                ? `✓ ${solutions.filter(s => s.passCount === 4).length} VALID`
                : `⚠ BEST: ${solutions[0]?.passCount || 0}/4`}
            </div>
          )}
          <div style={{
            background: '#0d1220', border: '1px solid #1a2540',
            borderRadius: 8, padding: '5px 12px', fontSize: 9,
            color: '#253548', fontFamily: 'Consolas,monospace', fontWeight: 700,
            letterSpacing: '0.1em',
          }}>
            PIEAS · CEP · MECH. MACHINES
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '400px 1fr', minHeight: 0, overflow: 'hidden' }}>

        {/* ── Left Panel ── */}
        <div style={{ borderRight: '1px solid #0e1520', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

          {/* Patient info */}
          <Section label="Patient Information" num="01">
            <CadField label="Patient Name" type="text" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Patient Alpha" />
            <CadField label="Injury / Condition" type="text" value={form.injury}
              onChange={e => setForm(f => ({ ...f, injury: e.target.value }))}
              placeholder="e.g. ACL Reconstruction" />
          </Section>

          {/* ROM */}
          <Section label="Range of Motion (ROM)" num="02">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <RomSlider label="Start Angle" min={0} max={30} step={5}
                value={form.romStart}
                onChange={v => setForm(f => ({ ...f, romStart: v }))}
                color="#c0392b" />
              <RomSlider label="End Angle" min={60} max={130} step={5}
                value={form.romEnd}
                onChange={v => setForm(f => ({ ...f, romEnd: v }))}
                color="#27ae60" />
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 0, background: '#07090f', borderRadius: 8, overflow: 'hidden', border: '1px solid #0d1828' }}>
              {[
                { l: 'START', v: `${form.romStart}°`,                c: '#c0392b' },
                { l: 'END',   v: `${form.romEnd}°`,                  c: '#27ae60' },
                { l: 'RANGE', v: `${form.romEnd - form.romStart}°`,  c: '#4a9eff' },
                { l: 'MID',   v: `${((form.romStart + form.romEnd) / 2).toFixed(0)}°`, c: '#ffd93d' },
              ].map((s, i) => (
                <div key={i} style={{ flex: 1, padding: '8px 0', textAlign: 'center',
                  borderRight: i < 3 ? '1px solid #0d1828' : 'none' }}>
                  <div style={{ fontSize: 7, color: '#1a2a40', letterSpacing: '0.1em', marginBottom: 2 }}>{s.l}</div>
                  <div style={{ fontSize: 14, fontFamily: 'Consolas,monospace', fontWeight: 900, color: s.c }}>{s.v}</div>
                </div>
              ))}
            </div>
          </Section>

          {/* Solutions */}
          <Section label="Auto-Generated Solutions" num="03">
            <div style={{ fontSize: 9, color: '#1e3050', lineHeight: 1.6, marginBottom: 8 }}>
              Grid search over <span style={{ color: '#2a5080' }}>N∈{'{3,4,5}'}</span> ×{' '}
              <span style={{ color: '#2a5080' }}>d∈[70–300mm]</span> ×{' '}
              <span style={{ color: '#2a5080' }}>offset∈[−60°…+60°]</span> — best result auto-applied.
            </div>

            {searching ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#1a3060', fontSize: 11, fontFamily: 'Consolas,monospace' }}>
                ⟳  Running grid search (243 combinations)…
              </div>
            ) : solutions.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', color: '#1a2540', fontSize: 10 }}>
                No valid mechanism found. Try widening ROM range.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {solutions.map((sol, idx) => {
                  const isActive = idx === activeIdx
                  const allPass  = sol.passCount === 4
                  const condPass = [
                    sol.grashof.passes,
                    sol.minMu >= 30,
                    sol.accuracyScore >= 80,
                    sol.synth.L1 > 0 && sol.synth.L2 > 0 && sol.synth.L3 > 0 && sol.synth.L4 > 0,
                  ]
                  return (
                    <div key={idx} style={{
                      background: isActive ? '#0a1628' : '#070a14',
                      border: `1.5px solid ${isActive ? '#2a5090' : allPass ? '#1a3a2a' : '#0d1428'}`,
                      borderRadius: 10, padding: '10px 12px',
                      cursor: 'pointer', transition: 'border-color 0.15s',
                    }}
                      onClick={() => applySolution(sol, idx)}
                    >
                      {/* Top row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                          background: isActive ? '#c0392b' : '#0e1828',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 900, color: isActive ? '#fff' : '#2a4060',
                          fontFamily: 'Consolas,monospace',
                        }}>
                          {idx + 1}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: isActive ? '#e0e8f0' : '#3a5070' }}>
                            N={sol.n}  ·  d={sol.d}mm  ·  offset={sol.offset}°
                          </div>
                          <div style={{ fontSize: 9, color: '#1a3050', fontFamily: 'Consolas,monospace', marginTop: 1 }}>
                            μ_min={sol.minMu.toFixed(1)}°  ·  Acc={sol.accuracyScore.toFixed(1)}%  ·  score={sol.score.toFixed(0)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          {idx === 0 && (
                            <div style={{ background: '#27ae6022', border: '1px solid #27ae6044', borderRadius: 4, padding: '2px 7px', fontSize: 7, color: '#27ae60', fontWeight: 800, letterSpacing: '0.1em' }}>
                              BEST
                            </div>
                          )}
                          {allPass && (
                            <div style={{ background: '#4a9eff22', border: '1px solid #4a9eff44', borderRadius: 4, padding: '2px 7px', fontSize: 7, color: '#4a9eff', fontWeight: 800, letterSpacing: '0.1em' }}>
                              4/4
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Condition chips */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                        {condLabels.map((lbl, ci) => (
                          <div key={ci} style={{
                            background: condPass[ci] ? '#0a1e12' : '#160c0a',
                            border: `1px solid ${condPass[ci] ? '#27ae6030' : '#c0392b30'}`,
                            borderRadius: 5, padding: '4px 6px', textAlign: 'center',
                          }}>
                            <div style={{ fontSize: 8, color: condPass[ci] ? '#27ae60' : '#c0392b', fontWeight: 700, marginBottom: 1 }}>
                              {condPass[ci] ? '✓' : '✗'}
                            </div>
                            <div style={{ fontSize: 7, color: condPass[ci] ? '#1a3a20' : '#3a1010', letterSpacing: '0.04em' }}>
                              {lbl.split(' ')[0]}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Apply button */}
                      <button
                        onClick={e => { e.stopPropagation(); applySolution(sol, idx) }}
                        style={{
                          width: '100%', marginTop: 8, padding: '7px 0',
                          background: isActive
                            ? 'linear-gradient(90deg, #c0392b 0%, #1a3a8a 100%)'
                            : '#0c1428',
                          border: `1px solid ${isActive ? 'transparent' : '#1a2840'}`,
                          borderRadius: 6, color: isActive ? '#fff' : '#2a4060',
                          fontSize: 9, fontWeight: 800, cursor: 'pointer',
                          letterSpacing: '0.12em', transition: 'all 0.15s',
                        }}
                      >
                        {isActive ? '✓  APPLIED' : '  APPLY THIS SOLUTION'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </Section>

          {/* Active solution details */}
          {activeSol && (
            <Section label="Applied Solution Details" num="04">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {[
                  { l: 'L1 (Ground)',  v: `${activeSol.synth.L1.toFixed(1)} mm`, c: LINK_COLORS.ground },
                  { l: 'L2 (Crank)',   v: `${activeSol.synth.L2.toFixed(1)} mm`, c: LINK_COLORS.crank  },
                  { l: 'L3 (Coupler)', v: `${activeSol.synth.L3.toFixed(1)} mm`, c: LINK_COLORS.coupler },
                  { l: 'L4 (Rocker)',  v: `${activeSol.synth.L4.toFixed(1)} mm`, c: LINK_COLORS.rocker  },
                  { l: 'μ_min',        v: `${activeSol.minMu.toFixed(1)}°`,      c: activeSol.minMu >= 45 ? '#27ae60' : activeSol.minMu >= 30 ? '#f39c12' : '#c0392b' },
                  { l: 'Accuracy',     v: `${activeSol.accuracyScore.toFixed(1)}%`, c: activeSol.accuracyScore >= 80 ? '#27ae60' : '#c0392b' },
                ].map(s => (
                  <div key={s.l} style={{ background: '#07090f', borderRadius: 6, padding: '7px 10px', border: '1px solid #0d1828', borderLeft: `2px solid ${s.c}33` }}>
                    <div style={{ fontSize: 8, color: '#1a2a40', letterSpacing: '0.1em', marginBottom: 2 }}>{s.l}</div>
                    <div style={{ fontSize: 13, fontFamily: 'Consolas,monospace', fontWeight: 900, color: s.c }}>{s.v}</div>
                  </div>
                ))}
              </div>

              {/* Precision points */}
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 8, color: '#1a2a40', fontWeight: 800, letterSpacing: '0.1em', marginBottom: 6 }}>
                  CHEBYSHEV PRECISION POINTS (N={activeSol.n})
                </div>
                <table style={{ width: '100%', borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      {['Pt', 'θ_in (crank)', 'θ_out (rocker)'].map(h => (
                        <th key={h} style={{ fontSize: 8, color: '#1a2840', fontFamily: 'Consolas,monospace',
                          fontWeight: 800, letterSpacing: '0.06em', textAlign: 'left',
                          padding: '3px 6px', borderBottom: '1px solid #0e1828' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeSol.precision.map((pt, i) => {
                      const PCOLS = ['#ff6b35', '#ffd93d', '#6bcb77', '#4a9eff', '#c07fff']
                      return (
                        <tr key={i} style={{ background: i % 2 ? '#080b14' : 'transparent' }}>
                          <td style={{ padding: '5px 6px', fontFamily: 'Consolas,monospace', fontSize: 10,
                            fontWeight: 800, color: PCOLS[i % 5] }}>P{i + 1}</td>
                          <td style={{ padding: '5px 6px', fontFamily: 'Consolas,monospace', fontSize: 10, color: '#c0392b' }}>
                            {pt.theta_in.toFixed(2)}°</td>
                          <td style={{ padding: '5px 6px', fontFamily: 'Consolas,monospace', fontSize: 10, color: '#27ae60' }}>
                            {pt.theta_out.toFixed(2)}°</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* Save button */}
          <div style={{ padding: '14px 18px', borderTop: '1px solid #0e1520', marginTop: 'auto', flexShrink: 0 }}>
            <button onClick={handleSave} style={{
              width: '100%', padding: '13px 0',
              background: solutions.length > 0
                ? 'linear-gradient(135deg, #c0392b 0%, #1a3a8a 100%)'
                : '#0c1428',
              border: 'none', borderRadius: 10,
              color: solutions.length > 0 ? '#fff' : '#2a4060',
              fontWeight: 800, fontSize: 12, cursor: solutions.length > 0 ? 'pointer' : 'default',
              letterSpacing: '0.1em',
              boxShadow: solutions.length > 0 ? '0 0 22px #c0392b33' : 'none',
              transition: 'opacity 0.15s',
            }}>
              SAVE  &amp;  PROCEED TO SYNTHESIS  →
            </button>
          </div>
        </div>

        {/* ── Right Panel: Animated Canvas ── */}
        <div style={{ background: '#040810', display: 'flex', flexDirection: 'column', padding: 14, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 8, color: '#1a2a40', fontWeight: 800, letterSpacing: '0.16em' }}>
              FOUR-BAR MECHANISM  ·  LIVE SIMULATION  ·  BURMESTER SYNTHESIS
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setPlaying(p => !p)} style={{
                background: playing ? '#0a1e12' : '#0e1020',
                border: `1px solid ${playing ? '#27ae6044' : '#334'}`,
                borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                fontSize: 9, color: playing ? '#27ae60' : '#445', fontWeight: 700,
                letterSpacing: '0.08em',
              }}>
                {playing ? '⏸ PAUSE' : '▶ PLAY'}
              </button>
              {solutions.length > 1 && solutions.map((_, i) => (
                <button key={i} onClick={() => applySolution(solutions[i], i)} style={{
                  background: i === activeIdx ? '#0e1e38' : '#080c18',
                  border: `1px solid ${i === activeIdx ? '#2a5090' : '#0d1428'}`,
                  borderRadius: 5, padding: '4px 8px', cursor: 'pointer',
                  fontSize: 8, color: i === activeIdx ? '#4a9eff' : '#2a3a50', fontWeight: 800,
                }}>
                  S{i + 1}
                </button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, borderRadius: 10, overflow: 'hidden', border: '1px solid #0c1830', position: 'relative' }}>
            <canvas ref={canvasRef} width={760} height={600}
              style={{ width: '100%', height: '100%', display: 'block' }} />
          </div>

          {/* Stats strip */}
          {activeSol && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 7, marginTop: 10 }}>
              {[
                { l: 'Solution',   v: `${activeIdx + 1}/${solutions.length}`, c: '#4a9eff' },
                { l: 'Grashof',    v: activeSol.grashof.passes ? 'PASS' : 'FAIL', c: activeSol.grashof.passes ? '#27ae60' : '#c0392b' },
                { l: 'μ_min',      v: `${activeSol.minMu.toFixed(1)}°`, c: activeSol.minMu >= 45 ? '#27ae60' : activeSol.minMu >= 30 ? '#f39c12' : '#c0392b' },
                { l: 'Accuracy',   v: `${activeSol.accuracyScore.toFixed(1)}%`, c: activeSol.accuracyScore >= 80 ? '#27ae60' : '#c0392b' },
                { l: 'Conditions', v: `${activeSol.passCount}/4`, c: activeSol.passCount === 4 ? '#27ae60' : activeSol.passCount >= 3 ? '#f39c12' : '#c0392b' },
              ].map(s => (
                <div key={s.l} style={{ background: '#07090f', border: '1px solid #0e1520', borderRadius: 7, padding: '7px 10px', borderTop: `2px solid ${s.c}22` }}>
                  <div style={{ fontSize: 8, color: '#1a2a40', letterSpacing: '0.08em', marginBottom: 2 }}>{s.l}</div>
                  <div style={{ fontSize: 13, fontFamily: 'Consolas,monospace', fontWeight: 900, color: s.c }}>{s.v}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function Section({ label, num, children }) {
  return (
    <div style={{ padding: '13px 16px', borderBottom: '1px solid #0e1520' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <div style={{
          width: 18, height: 18, borderRadius: 4,
          background: '#0e1828', border: '1px solid #1a2a40',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 7, color: '#2a4060', fontFamily: 'Consolas,monospace', fontWeight: 800,
        }}>{num}</div>
        <div style={{ fontSize: 9, color: '#253548', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
          {label}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>{children}</div>
    </div>
  )
}

function CadField({ label, ...props }) {
  return (
    <div>
      <div style={{ fontSize: 8, color: '#253548', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <input {...props} style={{
        width: '100%', boxSizing: 'border-box',
        background: '#08101e', border: '1px solid #1a2840',
        borderRadius: 6, padding: '8px 11px',
        color: '#c8d8e8', fontSize: 12, outline: 'none',
        fontFamily: 'Consolas,monospace', transition: 'border-color 0.15s',
      }}
        onFocus={e => { e.target.style.borderColor = '#2a5090' }}
        onBlur={e  => { e.target.style.borderColor = '#1a2840' }}
      />
    </div>
  )
}

function RomSlider({ label, min, max, step, value, onChange, color }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 8, color: '#253548', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</span>
        <span style={{ fontSize: 13, fontFamily: 'Consolas,monospace', fontWeight: 900, color }}>{value}°</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)}
        style={{ width: '100%', accentColor: color, cursor: 'pointer' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 1 }}>
        <span style={{ fontSize: 7, color: '#1a2a40' }}>{min}°</span>
        <span style={{ fontSize: 7, color: '#1a2a40' }}>{max}°</span>
      </div>
    </div>
  )
}
