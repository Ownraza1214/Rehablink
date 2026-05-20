import { useState, useEffect, useRef, useMemo } from 'react'
import useMechanismStore from '../store/useMechanismStore'
const { setActivePage, setPatient, setPrecisionPoints } = useMechanismStore.getState()
import {
  chebyshevSpacing, burmesterSynthesis, grashofCheck,
  computeRMSError, forwardKinematicsRaw,
} from '../engine/synthesis'

const DEG = Math.PI / 180

// ── Condition evaluator ───────────────────────────────────────────────────────
function evaluateN(n, romStart, romEnd) {
  try {
    const outPts  = chebyshevSpacing(n, romStart, romEnd)
    const inPts   = chebyshevSpacing(n, 0, 270)
    const precision = inPts.map((ti, i) => ({ theta_in: ti, theta_out: outPts[i] }))
    const synth   = burmesterSynthesis(precision, { d: 150, angleOffset: 0 })
    const grashof = grashofCheck(synth.L1, synth.L2, synth.L3, synth.L4)
    const { rmsError, accuracyScore } = computeRMSError(
      { ...synth, O4: synth.O4 }, precision, romStart, romEnd,
    )
    // Min transmission angle
    let minMu = 180
    for (let t = 0; t <= 360; t += 4) {
      const fk = forwardKinematicsRaw(t * DEG, synth.L1, synth.L2, synth.L3, synth.L4, synth.O2, synth.O4)
      if (fk) {
        const mu = Math.abs(fk.theta3 - fk.theta4) % Math.PI
        minMu = Math.min(minMu, Math.min(mu, Math.PI - mu) * 180 / Math.PI)
      }
    }

    const conditions = [
      { id: 'grashof', label: 'Grashof Condition',     pass: grashof.passes,       val: grashof.type,                  need: 'Crank-rocker type (S+L ≤ P+Q)' },
      { id: 'mu',      label: 'Transmission Angle',    pass: minMu >= 30,           val: `μ_min = ${minMu.toFixed(1)}°`,need: 'Needs μ ≥ 30° for good force transfer' },
      { id: 'acc',     label: 'Synthesis Accuracy',    pass: accuracyScore >= 80,   val: `${accuracyScore.toFixed(1)}%`, need: 'Needs ≥ 80% accuracy (RMS < 5°)' },
      { id: 'pos',     label: 'Link Dimensions',       pass: synth.L1 > 0 && synth.L2 > 0 && synth.L3 > 0 && synth.L4 > 0,
        val: `L1=${synth.L1.toFixed(0)} L2=${synth.L2.toFixed(0)} L3=${synth.L3.toFixed(0)} L4=${synth.L4.toFixed(0)}`,
        need: 'All links must be positive (physical)',
      },
    ]
    const score = conditions.filter(c => c.pass).length
    return { n, precision, synth, grashof, minMu, accuracyScore, rmsError, conditions, score }
  } catch (e) {
    return { n, error: e.message, score: 0, conditions: [], precision: [] }
  }
}

// ── Anatomy canvas ────────────────────────────────────────────────────────────
function drawAnatomy(canvas, romStart, romEnd, precision) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)

  // Blueprint background
  ctx.fillStyle = '#050f28'; ctx.fillRect(0, 0, W, H)

  // Grid
  const GS = 20
  ctx.lineWidth = 0.4
  for (let x = 0; x <= W; x += GS) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H)
    ctx.strokeStyle = x % (GS * 5) === 0 ? '#0e2248' : '#081530'
    ctx.stroke()
  }
  for (let y = 0; y <= H; y += GS) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y)
    ctx.strokeStyle = y % (GS * 5) === 0 ? '#0e2248' : '#081530'
    ctx.stroke()
  }

  const cx = W * 0.42
  const kneeY = H * 0.46
  const femurLen = H * 0.29
  const tibiaLen = H * 0.32

  // ── Femur ──
  const hip = { x: cx, y: kneeY - femurLen }
  ctx.save()
  // Femur body gradient
  const fGrad = ctx.createLinearGradient(cx - 20, hip.y, cx + 20, kneeY)
  fGrad.addColorStop(0, '#1a3a5c')
  fGrad.addColorStop(0.5, '#1e4470')
  fGrad.addColorStop(1, '#162e4a')
  ctx.fillStyle = fGrad

  ctx.beginPath()
  ctx.moveTo(cx - 8, hip.y)
  ctx.bezierCurveTo(cx - 13, hip.y + femurLen * 0.25, cx - 12, hip.y + femurLen * 0.6, cx - 20, kneeY - 8)
  ctx.lineTo(cx - 20, kneeY + 4)
  ctx.lineTo(cx + 20, kneeY + 4)
  ctx.lineTo(cx + 20, kneeY - 8)
  ctx.bezierCurveTo(cx + 12, hip.y + femurLen * 0.6, cx + 13, hip.y + femurLen * 0.25, cx + 8, hip.y)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#3a7ab8'; ctx.lineWidth = 1.5; ctx.stroke()
  ctx.restore()

  // Femoral condyles (rounded ends)
  ctx.save()
  const condGrad = ctx.createRadialGradient(cx, kneeY, 2, cx, kneeY, 22)
  condGrad.addColorStop(0, '#2a5080')
  condGrad.addColorStop(1, '#162e4a')
  ctx.fillStyle = condGrad
  ctx.beginPath(); ctx.arc(cx - 11, kneeY, 11, 0, 2 * Math.PI); ctx.fill(); ctx.strokeStyle = '#3a7ab8'; ctx.lineWidth = 1; ctx.stroke()
  ctx.beginPath(); ctx.arc(cx + 11, kneeY, 11, 0, 2 * Math.PI); ctx.fill(); ctx.stroke()
  ctx.restore()

  // Hip ball joint
  ctx.save()
  ctx.beginPath(); ctx.arc(cx, hip.y, 14, 0, 2 * Math.PI)
  const hGrad = ctx.createRadialGradient(cx - 4, hip.y - 4, 0, cx, hip.y, 14)
  hGrad.addColorStop(0, '#3a7ab8'); hGrad.addColorStop(1, '#162e4a')
  ctx.fillStyle = hGrad; ctx.fill()
  ctx.strokeStyle = '#3a7ab8'; ctx.lineWidth = 1.5; ctx.stroke()
  ctx.restore()

  // ── Cartilage layer ──
  ctx.save()
  ctx.beginPath(); ctx.arc(cx, kneeY + 2, 25, 0, Math.PI)
  ctx.strokeStyle = '#4a9eff44'; ctx.lineWidth = 5; ctx.stroke()
  ctx.restore()

  // ── Patella ──
  ctx.save()
  ctx.beginPath(); ctx.ellipse(cx - 32, kneeY - 2, 9, 12, -0.3, 0, 2 * Math.PI)
  ctx.fillStyle = '#1a3a5c'; ctx.fill()
  ctx.strokeStyle = '#4a9eff66'; ctx.lineWidth = 1.2; ctx.stroke()
  // Patella label
  ctx.fillStyle = '#2a6090'; ctx.font = '8px Consolas,monospace'
  ctx.fillText('Patella', cx - 60, kneeY - 2)
  ctx.restore()

  // ── ACL / PCL cross ──
  ctx.save()
  ctx.globalAlpha = 0.25; ctx.strokeStyle = '#ff6b35'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(cx - 10, kneeY - 8); ctx.lineTo(cx + 10, kneeY + 8); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx + 10, kneeY - 8); ctx.lineTo(cx - 10, kneeY + 8); ctx.stroke()
  ctx.globalAlpha = 0.18; ctx.fillStyle = '#ff6b35'
  ctx.font = 'bold 7px Consolas,monospace'; ctx.fillText('ACL', cx + 10, kneeY - 10)
  ctx.globalAlpha = 1
  ctx.restore()

  // ── ROM arc (thick, gradient) ──
  const arcR = tibiaLen * 0.75
  const startA = -Math.PI / 2 + romStart * DEG
  const endA   = -Math.PI / 2 + romEnd   * DEG

  // Background arc (range track)
  ctx.save()
  ctx.beginPath(); ctx.arc(cx, kneeY, arcR, -Math.PI / 2, Math.PI / 2 * 0.6)
  ctx.strokeStyle = '#0c1f45'; ctx.lineWidth = 14; ctx.stroke()

  // Colored ROM sweep
  const steps = 60
  for (let i = 0; i < steps; i++) {
    const t  = i / steps
    const t2 = (i + 1) / steps
    const a1 = startA + (endA - startA) * t
    const a2 = startA + (endA - startA) * t2
    const hue = 120 + t * 30  // green → lime
    ctx.beginPath(); ctx.arc(cx, kneeY, arcR, a1, a2)
    ctx.strokeStyle = `hsla(${hue}, 80%, 45%, 0.7)`
    ctx.lineWidth = 13; ctx.stroke()
  }
  ctx.restore()

  // ROM arc border
  ctx.save()
  ctx.beginPath(); ctx.arc(cx, kneeY, arcR, startA, endA)
  ctx.strokeStyle = '#27ae6088'; ctx.lineWidth = 15
  ctx.globalAlpha = 0.3; ctx.stroke(); ctx.globalAlpha = 1
  ctx.restore()

  // ── Tibia at ROM midpoint ──
  const midA   = -Math.PI / 2 + ((romStart + romEnd) / 2) * DEG
  const tibEnd = {
    x: cx + tibiaLen * Math.cos(midA),
    y: kneeY + tibiaLen * Math.sin(midA),
  }

  ctx.save()
  const tGrad = ctx.createLinearGradient(cx, kneeY, tibEnd.x, tibEnd.y)
  tGrad.addColorStop(0, '#1e4470'); tGrad.addColorStop(1, '#132e52')
  ctx.strokeStyle = '#3a7ab8'; ctx.lineWidth = 13; ctx.lineCap = 'round'
  ctx.beginPath(); ctx.moveTo(cx, kneeY); ctx.lineTo(tibEnd.x, tibEnd.y); ctx.stroke()
  ctx.strokeStyle = '#2a5a90'; ctx.lineWidth = 10
  ctx.beginPath(); ctx.moveTo(cx, kneeY); ctx.lineTo(tibEnd.x, tibEnd.y); ctx.stroke()

  // Tibia ankle joint
  ctx.beginPath(); ctx.arc(tibEnd.x, tibEnd.y, 8, 0, 2 * Math.PI)
  ctx.fillStyle = '#162e4a'; ctx.fill()
  ctx.strokeStyle = '#3a7ab8'; ctx.lineWidth = 1.2; ctx.stroke()
  ctx.restore()

  // ── Start / End angle arcs ──
  const angR2 = arcR + 20
  ctx.save()
  ctx.setLineDash([5, 4])
  // Start line
  ctx.beginPath()
  ctx.moveTo(cx, kneeY)
  ctx.lineTo(cx + angR2 * Math.cos(startA), kneeY + angR2 * Math.sin(startA))
  ctx.strokeStyle = '#c0392b66'; ctx.lineWidth = 1; ctx.stroke()
  // End line
  ctx.beginPath()
  ctx.moveTo(cx, kneeY)
  ctx.lineTo(cx + angR2 * Math.cos(endA), kneeY + angR2 * Math.sin(endA))
  ctx.strokeStyle = '#27ae6066'; ctx.lineWidth = 1; ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()

  // Angle labels
  ctx.save()
  ctx.font = 'bold 9px Consolas,monospace'
  const sLx = cx + (arcR + 26) * Math.cos(startA)
  const sLy = kneeY + (arcR + 26) * Math.sin(startA)
  ctx.fillStyle = '#c0392b'; ctx.fillText(`${romStart}°`, sLx - 6, sLy + 4)
  const eLx = cx + (arcR + 26) * Math.cos(endA)
  const eLy = kneeY + (arcR + 26) * Math.sin(endA)
  ctx.fillStyle = '#27ae60'; ctx.fillText(`${romEnd}°`, eLx - 6, eLy + 4)
  ctx.restore()

  // ── Precision points on arc ──
  const PCOLS = ['#ff6b35', '#ffd93d', '#6bcb77', '#4a9eff', '#c07fff']
  precision.forEach((pt, i) => {
    const a  = -Math.PI / 2 + pt.theta_out * DEG
    const px = cx + arcR * Math.cos(a)
    const py = kneeY + arcR * Math.sin(a)

    // Spoke from knee
    ctx.save()
    ctx.setLineDash([4, 4])
    ctx.beginPath(); ctx.moveTo(cx, kneeY); ctx.lineTo(px, py)
    ctx.strokeStyle = PCOLS[i] + '55'; ctx.lineWidth = 1; ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()

    // Crosshair marker
    ctx.save()
    ctx.beginPath()
    ctx.arc(px, py, 7, 0, 2 * Math.PI)
    ctx.fillStyle = PCOLS[i] + '33'; ctx.fill()
    ctx.strokeStyle = PCOLS[i]; ctx.lineWidth = 1.5; ctx.stroke()
    // Inner dot
    ctx.beginPath(); ctx.arc(px, py, 2.5, 0, 2 * Math.PI)
    ctx.fillStyle = PCOLS[i]; ctx.fill()
    ctx.restore()

    // Label + leader
    const lx = px + 12 * Math.cos(a)
    const ly = py + 12 * Math.sin(a)
    ctx.save()
    ctx.font = 'bold 9px Consolas,monospace'
    const txt = `P${i + 1}: ${pt.theta_out.toFixed(1)}°`
    const tw  = ctx.measureText(txt).width
    ctx.fillStyle = '#050f28cc'
    ctx.fillRect(lx - 2, ly - 9, tw + 6, 12)
    ctx.fillStyle = PCOLS[i]
    ctx.fillText(txt, lx, ly)
    ctx.restore()
  })

  // ── Bone labels ──
  ctx.save()
  ctx.font = 'bold 9px Consolas,monospace'; ctx.fillStyle = '#2a6090'
  // Femur label with leader
  ctx.fillText('Femur', cx + 24, hip.y + femurLen * 0.3)
  ctx.beginPath()
  ctx.moveTo(cx + 22, hip.y + femurLen * 0.3 - 5)
  ctx.lineTo(cx + 18, hip.y + femurLen * 0.3 - 5)
  ctx.strokeStyle = '#1a4060'; ctx.lineWidth = 0.8; ctx.stroke()
  // Tibia
  ctx.fillStyle = '#2a6090'
  ctx.fillText('Tibia', tibEnd.x + 8, (kneeY + tibEnd.y) / 2)
  // Knee
  ctx.fillStyle = '#3a7ab866'
  ctx.font = '8px Consolas,monospace'
  ctx.fillText('Knee Joint', cx + 24, kneeY + 4)
  ctx.restore()

  // ── ROM dimension arc ──
  const dimArcR = arcR + 36
  ctx.save()
  ctx.beginPath(); ctx.arc(cx, kneeY, dimArcR, startA, endA)
  ctx.strokeStyle = '#f0e06033'; ctx.lineWidth = 1; ctx.stroke()
  // Arrow tips
  const midArc = (startA + endA) / 2
  ctx.fillStyle = '#f0e060'; ctx.font = 'bold 10px Consolas,monospace'; ctx.textAlign = 'center'
  ctx.fillText(`ROM ${romEnd - romStart}°`, cx + dimArcR * Math.cos(midArc), kneeY + dimArcR * Math.sin(midArc) - 6)
  ctx.textAlign = 'left'
  ctx.restore()

  // ── Title block ──
  ctx.save()
  ctx.fillStyle = '#060f24'; ctx.fillRect(0, H - 36, W, 36)
  ctx.strokeStyle = '#0e2248'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, H - 36); ctx.lineTo(W, H - 36); ctx.stroke()
  ctx.font = '8px Consolas,monospace'; ctx.fillStyle = '#1a3a60'
  ctx.fillText('REHABLINK  ·  KNEE ROM ANATOMY', 10, H - 22)
  ctx.fillText(`PATIENT ROM: ${romStart}° → ${romEnd}°  ·  CHEBYSHEV N=${precision.length}  ·  CAD DIAGRAM`, 10, H - 10)
  // Border
  ctx.strokeStyle = '#0e2248'; ctx.lineWidth = 2
  ctx.strokeRect(3, 3, W - 6, H - 6)
  ctx.restore()
}

// ── Main component ────────────────────────────────────────────────────────────
export default function PatientSetup() {
  const patientData     = useMechanismStore(s => s.patientData)
  const precisionPoints = useMechanismStore(s => s.precisionPoints)

  const [form,      setForm]      = useState({ ...patientData })
  const [selN,      setSelN]      = useState(precisionPoints.length || 3)
  const canvasRef = useRef(null)

  // Evaluate all N options whenever ROM changes
  const advisor = useMemo(() => [3, 4, 5].map(n => evaluateN(n, form.romStart, form.romEnd)),
    [form.romStart, form.romEnd])

  // Best N = highest score, tie-break by accuracy
  const bestN = useMemo(() => {
    const sorted = [...advisor].sort((a, b) =>
      b.score - a.score || (b.accuracyScore || 0) - (a.accuracyScore || 0))
    return sorted[0]?.n ?? 3
  }, [advisor])

  // Current precision points based on selN
  const currentAdvisor = advisor.find(a => a.n === selN)

  // Sync precision points to store on selN or ROM change
  useEffect(() => {
    const adv = advisor.find(a => a.n === selN)
    if (adv?.precision?.length) setPrecisionPoints(adv.precision)
  }, [selN, advisor])

  // Redraw anatomy canvas
  useEffect(() => {
    const adv = advisor.find(a => a.n === selN)
    drawAnatomy(canvasRef.current, form.romStart, form.romEnd, adv?.precision || [])
  }, [form.romStart, form.romEnd, selN, advisor])

  const handleSave = () => {
    setPatient({ ...form })
    setActivePage('synthesis')
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#060810', display: 'flex', flexDirection: 'column' }}>

      {/* ── Header ── */}
      <div style={{
        padding: '14px 22px', borderBottom: '1px solid #0e1520',
        background: '#07090f', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#f0f0f0', letterSpacing: '0.05em' }}>
            Patient Configuration
          </div>
          <div style={{ color: '#2a3a50', fontSize: 11, marginTop: 2, letterSpacing: '0.08em' }}>
            ROM · Chebyshev Precision Points · Condition Verification
          </div>
        </div>
        <div style={{
          background: '#0d1220', border: '1px solid #1a2540',
          borderRadius: 8, padding: '6px 14px', fontSize: 10,
          color: '#2a3a60', fontFamily: 'Consolas,monospace', fontWeight: 700, letterSpacing: '0.1em',
        }}>
          PIEAS  ·  CEP  ·  MECH. MACHINES
        </div>
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '420px 1fr', minHeight: 0, overflow: 'hidden' }}>

        {/* ── Left: Form + Advisor ── */}
        <div style={{
          borderRight: '1px solid #0e1520',
          overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 0,
        }}>

          {/* Patient info */}
          <Section label="Patient Information" icon="01">
            <CadField label="Patient Name" type="text" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Patient Alpha" />
            <CadField label="Injury / Condition" type="text" value={form.injury}
              onChange={e => setForm(f => ({ ...f, injury: e.target.value }))}
              placeholder="e.g. ACL Reconstruction" />
          </Section>

          {/* ROM sliders */}
          <Section label="Range of Motion" icon="02">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <RomSlider
                label="Start Angle" min={0} max={30} step={5}
                value={form.romStart}
                onChange={v => setForm(f => ({ ...f, romStart: v }))}
                color="#c0392b" unit="°"
              />
              <RomSlider
                label="End Angle" min={60} max={130} step={5}
                value={form.romEnd}
                onChange={v => setForm(f => ({ ...f, romEnd: v }))}
                color="#27ae60" unit="°"
              />
            </div>
            <div style={{
              marginTop: 10, background: '#0a0d18', borderRadius: 8,
              padding: '10px 14px', display: 'flex', gap: 20,
            }}>
              <Stat label="ROM Range"      val={`${form.romEnd - form.romStart}°`} color="#4a9eff" />
              <Stat label="Start"          val={`${form.romStart}°`}               color="#c0392b" />
              <Stat label="End"            val={`${form.romEnd}°`}                 color="#27ae60" />
            </div>
          </Section>

          {/* Precision point advisor */}
          <Section label="Precision Point Advisor" icon="03">
            <div style={{ marginBottom: 10, color: '#2a3a50', fontSize: 10, lineHeight: 1.6, letterSpacing: '0.04em' }}>
              Chebyshev spacing minimizes structural error. Select N and verify all 4 design conditions satisfy below.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {advisor.map(adv => {
                const active = selN === adv.n
                const isRec  = bestN === adv.n
                return (
                  <button
                    key={adv.n}
                    onClick={() => setSelN(adv.n)}
                    style={{
                      background: active ? '#0e1e38' : '#090c18',
                      border: `1.5px solid ${active ? '#2a5090' : isRec ? '#1a3050' : '#0d1428'}`,
                      borderRadius: 10, padding: '10px 14px',
                      cursor: 'pointer', textAlign: 'left',
                      outline: 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      {/* N badge */}
                      <div style={{
                        width: 30, height: 30, borderRadius: 8,
                        background: active ? '#c0392b' : '#1a2030',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 900, color: active ? '#fff' : '#334',
                        fontFamily: 'Consolas,monospace', flexShrink: 0,
                      }}>
                        {adv.n}
                      </div>
                      <div>
                        <div style={{ color: active ? '#f0f0f0' : '#555', fontSize: 12, fontWeight: 700 }}>
                          N = {adv.n} Precision Points
                        </div>
                        {adv.accuracyScore != null && (
                          <div style={{ fontSize: 10, color: '#2a4060', fontFamily: 'Consolas,monospace' }}>
                            Accuracy {adv.accuracyScore.toFixed(1)}%  ·  μ_min {adv.minMu.toFixed(1)}°  ·  {adv.score}/4 conditions
                          </div>
                        )}
                        {adv.error && (
                          <div style={{ fontSize: 10, color: '#663' }}>Synthesis failed</div>
                        )}
                      </div>
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                        {isRec && (
                          <div style={{
                            background: '#27ae6022', border: '1px solid #27ae6044',
                            borderRadius: 5, padding: '2px 8px',
                            fontSize: 8, color: '#27ae60', fontWeight: 800, letterSpacing: '0.1em',
                          }}>
                            BEST
                          </div>
                        )}
                        {adv.score === 4 && (
                          <div style={{
                            background: '#4a9eff22', border: '1px solid #4a9eff44',
                            borderRadius: 5, padding: '2px 8px',
                            fontSize: 8, color: '#4a9eff', fontWeight: 800, letterSpacing: '0.1em',
                          }}>
                            ALL PASS
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Condition pills */}
                    {adv.conditions.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                        {adv.conditions.map(cond => (
                          <div key={cond.id} style={{
                            background: cond.pass ? '#0a1e12' : '#1a0c0a',
                            border: `1px solid ${cond.pass ? '#27ae6025' : '#c0392b25'}`,
                            borderRadius: 6, padding: '5px 8px',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                              <div style={{
                                width: 14, height: 14, borderRadius: 4, flexShrink: 0,
                                background: cond.pass ? '#27ae6033' : '#c0392b33',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 8, color: cond.pass ? '#27ae60' : '#c0392b',
                              }}>
                                {cond.pass ? '✓' : '✗'}
                              </div>
                              <span style={{ fontSize: 9, fontWeight: 700, color: cond.pass ? '#27ae60' : '#c0392b', letterSpacing: '0.04em' }}>
                                {cond.id === 'grashof' ? 'Grashof' : cond.id === 'mu' ? 'Trans. Angle' : cond.id === 'acc' ? 'Accuracy' : 'Links'}
                              </span>
                            </div>
                            <div style={{ fontSize: 8, color: '#334', fontFamily: 'Consolas,monospace' }}>
                              {cond.val}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Condition legend */}
            <div style={{
              marginTop: 10, background: '#080b14', borderRadius: 8, padding: '10px 12px',
              borderLeft: '2px solid #1a3050',
            }}>
              <div style={{ fontSize: 9, color: '#1e3050', fontWeight: 800, letterSpacing: '0.1em', marginBottom: 6 }}>
                DESIGN CONDITIONS REQUIRED
              </div>
              {[
                ['Grashof',          'S+L ≤ P+Q  →  crank completes full rotation'],
                ['Trans. Angle ≥30°','Force transfer efficiency (no mechanical advantage loss)'],
                ['Accuracy ≥80%',    'RMS deviation from target ROM ≤ 5°'],
                ['Links > 0',        'All link dimensions physically realizable'],
              ].map(([name, desc]) => (
                <div key={name} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                  <div style={{ width: 4, height: 4, borderRadius: 1, background: '#1a3a60', flexShrink: 0, marginTop: 5 }} />
                  <div>
                    <span style={{ fontSize: 9, color: '#2a4a70', fontWeight: 700 }}>{name}: </span>
                    <span style={{ fontSize: 9, color: '#1a2a40' }}>{desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Precision points table */}
          <Section label={`Chebyshev Points  (N = ${selN})`} icon="04">
            <table style={{ width: '100%', borderSpacing: 0 }}>
              <thead>
                <tr>
                  {['Pt', 'θ_in (crank °)', 'θ_out (rocker °)', 'Status'].map(h => (
                    <th key={h} style={{ fontSize: 9, color: '#1a2a40', fontFamily: 'Consolas,monospace',
                      fontWeight: 800, letterSpacing: '0.08em', textAlign: 'left',
                      padding: '3px 6px', borderBottom: '1px solid #0e1828' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(currentAdvisor?.precision || []).map((pt, i) => {
                  const PCOLS = ['#ff6b35', '#ffd93d', '#6bcb77', '#4a9eff', '#c07fff']
                  const inRom = pt.theta_out >= form.romStart - 2 && pt.theta_out <= form.romEnd + 2
                  return (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#080b14' }}>
                      <td style={{ padding: '6px 6px', fontFamily: 'Consolas,monospace', fontSize: 11,
                        fontWeight: 700, color: PCOLS[i % 5] }}>P{i + 1}</td>
                      <td style={{ padding: '6px 6px', fontFamily: 'Consolas,monospace', fontSize: 11, color: '#c0392b' }}>
                        {pt.theta_in.toFixed(2)}°</td>
                      <td style={{ padding: '6px 6px', fontFamily: 'Consolas,monospace', fontSize: 11, color: '#27ae60' }}>
                        {pt.theta_out.toFixed(2)}°</td>
                      <td style={{ padding: '6px 6px' }}>
                        <span style={{
                          fontSize: 8, fontWeight: 800, letterSpacing: '0.08em',
                          color: inRom ? '#27ae60' : '#c0392b',
                          background: inRom ? '#27ae6015' : '#c0392b15',
                          padding: '2px 6px', borderRadius: 4,
                        }}>
                          {inRom ? 'IN ROM' : 'OUT'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Section>

          {/* Save button */}
          <div style={{ padding: '16px 20px', borderTop: '1px solid #0e1520', flexShrink: 0 }}>
            <button
              onClick={handleSave}
              style={{
                width: '100%', padding: '14px 0',
                background: 'linear-gradient(135deg, #c0392b 0%, #1a3a8a 100%)',
                border: 'none', borderRadius: 10,
                color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer',
                letterSpacing: '0.1em', boxShadow: '0 0 24px #c0392b44',
                transition: 'opacity 0.15s',
              }}
            >
              SAVE  &amp;  PROCEED TO SYNTHESIS  →
            </button>
          </div>
        </div>

        {/* ── Right: Anatomy canvas ── */}
        <div style={{
          background: '#040810',
          display: 'flex', flexDirection: 'column',
          padding: '16px', overflow: 'hidden',
        }}>
          <div style={{
            fontSize: 9, color: '#1a2a40', fontWeight: 800,
            letterSpacing: '0.16em', marginBottom: 10, textTransform: 'uppercase',
          }}>
            Knee Anatomy  ·  ROM Visualization  ·  Chebyshev Precision Points
          </div>
          <div style={{ flex: 1, position: 'relative', borderRadius: 10, overflow: 'hidden',
            border: '1px solid #0c1830' }}>
            <canvas ref={canvasRef} width={700} height={620}
              style={{ width: '100%', height: '100%', display: 'block' }} />
          </div>

          {/* Stats strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 10 }}>
            {[
              { label: 'ROM Range',    val: `${form.romEnd - form.romStart}°`, color: '#4a9eff' },
              { label: 'Target Flex.', val: `${form.romEnd}°`,                  color: '#27ae60' },
              { label: 'N Points',     val: String(selN),                       color: '#ffd93d' },
              { label: 'Conditions',   val: `${currentAdvisor?.score || 0}/4`,  color: (currentAdvisor?.score || 0) === 4 ? '#27ae60' : '#c0392b' },
            ].map(s => (
              <div key={s.label} style={{
                background: '#07090f', border: '1px solid #0e1520',
                borderRadius: 8, padding: '8px 12px',
                borderTop: `2px solid ${s.color}22`,
              }}>
                <div style={{ fontSize: 9, color: '#1a2a40', letterSpacing: '0.1em', marginBottom: 3 }}>{s.label}</div>
                <div style={{ fontSize: 16, fontFamily: 'Consolas,monospace', fontWeight: 900, color: s.color }}>{s.val}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function Section({ label, icon, children }) {
  return (
    <div style={{ padding: '14px 18px', borderBottom: '1px solid #0e1520' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{
          width: 20, height: 20, borderRadius: 5,
          background: '#0e1828', border: '1px solid #1a2a40',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 8, color: '#2a4060', fontFamily: 'Consolas,monospace', fontWeight: 800,
        }}>
          {icon}
        </div>
        <div style={{ fontSize: 10, color: '#2a3a50', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
          {label}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {children}
      </div>
    </div>
  )
}

function CadField({ label, ...props }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: '#2a3a50', fontWeight: 800, letterSpacing: '0.12em',
        textTransform: 'uppercase', marginBottom: 5 }}>{label}</div>
      <input
        {...props}
        style={{
          width: '100%', boxSizing: 'border-box',
          background: '#08101e', border: '1px solid #1a2840',
          borderRadius: 7, padding: '9px 12px',
          color: '#c8d8e8', fontSize: 13, outline: 'none',
          fontFamily: 'Consolas,monospace',
          transition: 'border-color 0.15s',
        }}
        onFocus={e => { e.target.style.borderColor = '#2a5090' }}
        onBlur={e  => { e.target.style.borderColor = '#1a2840' }}
      />
    </div>
  )
}

function RomSlider({ label, min, max, step, value, onChange, color, unit }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 9, color: '#2a3a50', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          {label}
        </span>
        <span style={{ fontSize: 13, fontFamily: 'Consolas,monospace', fontWeight: 900, color }}>
          {value}{unit}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)}
        style={{ width: '100%', accentColor: color, cursor: 'pointer' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        <span style={{ fontSize: 8, color: '#1a2a40' }}>{min}°</span>
        <span style={{ fontSize: 8, color: '#1a2a40' }}>{max}°</span>
      </div>
    </div>
  )
}

function Stat({ label, val, color }) {
  return (
    <div>
      <div style={{ fontSize: 8, color: '#1a2a40', letterSpacing: '0.1em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 15, fontFamily: 'Consolas,monospace', fontWeight: 900, color }}>{val}</div>
    </div>
  )
}
