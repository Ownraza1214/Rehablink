import { useState, useRef, useEffect } from 'react'
import { jsPDF } from 'jspdf'
import useMechanismStore from '../store/useMechanismStore'
import AccuracyBadge from '../components/AccuracyBadge'
import { forwardKinematicsRaw } from '../engine/synthesis'

const DEG = Math.PI / 180

// ── Blueprint canvas ──────────────────────────────────────────────────────────
function drawBlueprint(canvas, mechanism, patientData) {
  if (!canvas || !mechanism?.L1) return
  const ctx = canvas.getContext('2d')
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)

  // Blueprint background
  ctx.fillStyle = '#07132b'; ctx.fillRect(0, 0, W, H)

  // Grid lines
  const GS = 20
  ctx.strokeStyle = '#0c1f45'; ctx.lineWidth = 0.5
  for (let x = 0; x < W; x += GS) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
  for (let y = 0; y < H; y += GS) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
  // Major grid
  ctx.strokeStyle = '#102040'; ctx.lineWidth = 1
  for (let x = 0; x < W; x += GS * 5) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
  for (let y = 0; y < H; y += GS * 5) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }

  const { L1, L2, L3, L4, O2: _O2, O4: _O4 } = mechanism
  const O2 = _O2 || { x: 0, y: 0 }
  const O4 = _O4 || { x: L1, y: 0 }

  // Compute FK at 45° for a good display angle
  const fk = forwardKinematicsRaw(45 * DEG, L1, L2, L3, L4, O2, O4)
  if (!fk) return

  const margin = 60
  const availW = W - margin * 2, availH = H - margin * 2 - 50
  const span = Math.max(L1, L2 + L3) * 1.1
  const scale = Math.min(availW, availH) / span
  const ox = margin + availW / 2 - (O4.x / 2) * scale
  const oy = H / 2 + 30

  const sc = pt => ({ x: ox + pt.x * scale, y: oy - pt.y * scale })
  const sO2 = sc(O2), sO4 = sc(O4)
  const sA  = sc(fk.A), sB  = sc(fk.B)

  function drawLink(p1, p2, color, w = 7) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y
    const len = Math.hypot(dx, dy)
    if (len < 1) return
    const nx = (-dy / len) * w, ny = (dx / len) * w

    ctx.save()
    ctx.fillStyle = color + '33'
    ctx.strokeStyle = color; ctx.lineWidth = 1.5

    ctx.beginPath()
    ctx.moveTo(p1.x + nx, p1.y + ny)
    ctx.lineTo(p2.x + nx, p2.y + ny)
    ctx.arc(p2.x, p2.y, w, Math.atan2(ny, nx), Math.atan2(-ny, -nx), false)
    ctx.lineTo(p1.x - nx, p1.y - ny)
    ctx.arc(p1.x, p1.y, w, Math.atan2(-ny, -nx), Math.atan2(ny, nx), false)
    ctx.closePath()
    ctx.fill(); ctx.stroke()
    ctx.restore()
  }

  function drawDim(p1, p2, label, off, side = 1) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y
    const len = Math.hypot(dx, dy)
    if (len < 1) return
    const nx = (-dy / len) * off * side, ny = (dx / len) * off * side
    const a1 = { x: p1.x + nx, y: p1.y + ny }
    const a2 = { x: p2.x + nx, y: p2.y + ny }
    const mid = { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 }

    ctx.save()
    ctx.strokeStyle = '#f0e060'; ctx.fillStyle = '#f0e060'
    ctx.lineWidth = 0.8; ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(p1.x, p1.y); ctx.lineTo(a1.x, a1.y)
    ctx.moveTo(p2.x, p2.y); ctx.lineTo(a2.x, a2.y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y)
    ctx.lineWidth = 1; ctx.stroke()

    // Arrowheads
    const angle = Math.atan2(a2.y - a1.y, a2.x - a1.x)
    ;[[a1, angle], [a2, angle + Math.PI]].forEach(([p, ang]) => {
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.x + 6 * Math.cos(ang + 2.5), p.y + 6 * Math.sin(ang + 2.5))
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.x + 6 * Math.cos(ang - 2.5), p.y + 6 * Math.sin(ang - 2.5))
      ctx.stroke()
    })

    ctx.font = 'bold 9px Consolas,monospace'; ctx.textAlign = 'center'
    ctx.fillText(label, mid.x, mid.y - 5)
    ctx.restore()
  }

  function drawPiv(p, r, color, label) {
    ctx.save()
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI)
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke()
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.35, 0, 2 * Math.PI)
    ctx.fillStyle = color; ctx.fill()
    ctx.font = 'bold 10px Consolas,monospace'; ctx.fillStyle = '#a0c8f0'
    ctx.textAlign = 'center'; ctx.fillText(label, p.x, p.y - r - 5)
    ctx.restore()
  }

  function groundHatch(p) {
    const s = 10
    ctx.save()
    ctx.strokeStyle = '#4080b0'; ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(p.x - s, p.y); ctx.lineTo(p.x + s, p.y)
    ctx.moveTo(p.x - s, p.y); ctx.lineTo(p.x - s / 2, p.y + s)
    ctx.lineTo(p.x + s / 2, p.y + s); ctx.lineTo(p.x + s, p.y)
    ctx.stroke()
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath()
      ctx.moveTo(p.x + i * 5 - 4, p.y + s)
      ctx.lineTo(p.x + i * 5 - 8, p.y + s + 5)
      ctx.stroke()
    }
    ctx.restore()
  }

  // Ground bar
  ctx.strokeStyle = '#2060a0'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(sO2.x - 15, sO2.y + 2); ctx.lineTo(sO4.x + 15, sO4.y + 2); ctx.stroke()
  groundHatch(sO2)
  groundHatch(sO4)

  // Links
  drawLink(sO2, sA, '#ff6060', 8)   // crank - red
  drawLink(sA,  sB, '#60a0ff', 7)   // coupler - blue
  drawLink(sO4, sB, '#60e060', 7)   // rocker - green

  // Dimension lines
  drawDim(sO2, sO4, `L1=${L1.toFixed(1)}mm`, 32, -1)
  drawDim(sO2, sA,  `L2=${L2.toFixed(1)}mm`, 20, 1)
  drawDim(sA,  sB,  `L3=${L3.toFixed(1)}mm`, 20, -1)
  drawDim(sO4, sB,  `L4=${L4.toFixed(1)}mm`, 20, 1)

  // Pivots
  drawPiv(sO2, 8, '#ff6060', 'O₂')
  drawPiv(sO4, 8, '#60e060', 'O₄')
  drawPiv(sA,  6, '#a0c0e0', 'A')
  drawPiv(sB,  6, '#a0c0e0', 'B')

  // Centre lines through pivots
  ctx.strokeStyle = '#1a3a60'; ctx.lineWidth = 0.6; ctx.setLineDash([8, 4])
  ;[sO2, sO4, sA, sB].forEach(p => {
    ctx.beginPath(); ctx.moveTo(p.x - 20, p.y); ctx.lineTo(p.x + 20, p.y); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(p.x, p.y - 20); ctx.lineTo(p.x, p.y + 20); ctx.stroke()
  })
  ctx.setLineDash([])

  // Title block (bottom)
  ctx.fillStyle = '#102040'; ctx.fillRect(0, H - 48, W, 48)
  ctx.strokeStyle = '#1a4080'; ctx.lineWidth = 1
  ctx.strokeRect(0, H - 48, W, 48)

  const col = (n, label, val, color = '#a0c8f0') => {
    const x = 16 + n * 140
    ctx.fillStyle = '#3060a0'; ctx.font = '8px Consolas,monospace'
    ctx.textAlign = 'left'; ctx.fillText(label.toUpperCase(), x, H - 34)
    ctx.fillStyle = color; ctx.font = 'bold 10px Consolas,monospace'
    ctx.fillText(val, x, H - 22)
  }
  col(0, 'PROJECT', 'RehabLink CPM Device', '#e0eeff')
  col(1, 'PATIENT', patientData.name || 'N/A', '#a0c8f0')
  col(2, 'ROM', `${patientData.romStart}° → ${patientData.romEnd}°`, '#80ff80')
  col(3, 'DATE', new Date().toLocaleDateString(), '#a0c8f0')
  col(4, 'SCALE', '1 : 1  (mm)', '#a0c8f0')

  ctx.fillStyle = '#3060a0'; ctx.font = 'bold 9px Consolas,monospace'; ctx.textAlign = 'right'
  ctx.fillText('PIEAS  ·  MECHANICS OF MACHINES', W - 14, H - 22)

  // Border frame
  ctx.strokeStyle = '#1a4080'; ctx.lineWidth = 2
  ctx.strokeRect(4, 4, W - 8, H - 8)
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ExportFabrication() {
  const mechanism       = useMechanismStore(s => s.mechanism)
  const patientData     = useMechanismStore(s => s.patientData)
  const precisionPoints = useMechanismStore(s => s.precisionPoints)

  const [exporting, setExporting] = useState(false)
  const [exported,  setExported]  = useState('')
  const canvasRef = useRef(null)

  useEffect(() => {
    drawBlueprint(canvasRef.current, mechanism, patientData)
  }, [mechanism, patientData])

  const m = mechanism || {}

  // ── PDF export ──────────────────────────────────────────────────────────────
  async function exportPDF() {
    setExporting(true)
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

    doc.setFillColor(10, 15, 26)
    doc.rect(0, 0, 210, 40, 'F')
    doc.setTextColor(0, 180, 255)
    doc.setFontSize(22); doc.setFont('helvetica', 'bold')
    doc.text('RehabLink  -  CPM Linkage Report', 15, 18)
    doc.setFontSize(11); doc.setTextColor(160, 174, 192)
    doc.text('PIEAS . Mechanics of Machines . CEP', 15, 28)
    doc.text(`Patient: ${patientData.name || 'N/A'}  |  Date: ${new Date().toLocaleDateString()}`, 15, 35)

    doc.setFillColor(17, 24, 39)
    doc.rect(0, 44, 210, 30, 'F')
    doc.setTextColor(255, 255, 255); doc.setFontSize(13); doc.setFont('helvetica', 'bold')
    doc.text('Patient Data', 15, 55)
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(160, 174, 192)
    doc.text(`Name: ${patientData.name}`, 15, 63)
    doc.text(`Injury: ${patientData.injury}`, 80, 63)
    doc.text(`ROM: ${patientData.romStart}deg - ${patientData.romEnd}deg`, 150, 63)
    doc.text(`Range: ${patientData.romEnd - patientData.romStart}deg`, 15, 69)

    doc.setFillColor(26, 34, 54)
    doc.rect(0, 78, 210, 44, 'F')
    doc.setTextColor(255, 255, 255); doc.setFontSize(13); doc.setFont('helvetica', 'bold')
    doc.text('Mechanism Dimensions', 15, 88)
    const links = [['L1 (Ground)', m.L1], ['L2 (Crank)', m.L2], ['L3 (Coupler)', m.L3], ['L4 (Rocker)', m.L4]]
    links.forEach(([label, val], i) => {
      const x = 15 + i * 48
      doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139)
      doc.text(label, x, 97)
      doc.setTextColor(0, 180, 255); doc.setFontSize(14); doc.setFont('helvetica', 'bold')
      doc.text(`${(val || 0).toFixed(2)} mm`, x, 107)
    })

    doc.setFillColor(17, 24, 39)
    doc.rect(0, 126, 210, 50, 'F')
    doc.setTextColor(255, 255, 255); doc.setFontSize(13); doc.setFont('helvetica', 'bold')
    doc.text('Analysis Results', 15, 136)
    const results = [
      ['Accuracy Score', `${(m.accuracyScore || 0).toFixed(1)}%`, (m.accuracyScore || 0) >= 80],
      ['Grashof', m.grashof?.type || ' - ', m.grashof?.passes],
      ['RMS Error', `${(m.rmsError || 0).toFixed(2)}deg`, (m.rmsError || 0) < 5],
      ['Min Trans. mu', `${(m.minMu || 0).toFixed(1)}deg`, (m.minMu || 0) >= 30],
    ]
    results.forEach(([label, val, ok], i) => {
      const row = 144 + i * 8
      doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139)
      doc.text(label, 15, row)
      doc.setTextColor(ok ? 0 : 255, ok ? 255 : 51, ok ? 136 : 85)
      doc.text(val, 80, row)
      doc.text(ok ? 'PASS' : 'FAIL', 150, row)
    })

    doc.setFillColor(26, 34, 54)
    doc.rect(0, 180, 210, 8 + precisionPoints.length * 7, 'F')
    doc.setTextColor(255, 255, 255); doc.setFontSize(12); doc.setFont('helvetica', 'bold')
    doc.text('Precision Points (Chebyshev)', 15, 190)
    precisionPoints.forEach((pt, i) => {
      doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(160, 174, 192)
      doc.text(`P${i + 1}: Theta_in = ${pt.theta_in.toFixed(2)}deg   Theta_out = ${pt.theta_out.toFixed(2)}deg`, 15, 197 + i * 7)
    })

    const footerY = 280
    doc.setFillColor(10, 15, 26); doc.rect(0, footerY, 210, 17, 'F')
    doc.setTextColor(74, 85, 104); doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    doc.text('RehabLink . PIEAS CEP . Prepared by: Muhammad Own Raza & Muhammad Rayyan', 15, footerY + 7)
    doc.text('Presented to: Engineer Attique Ahmed . Mechanics of Machines', 15, footerY + 13)
    doc.save(`RehabLink_Report_${patientData.name?.replace(/\s/g, '_') || 'Patient'}.pdf`)
    setExporting(false); setExported('PDF')
  }

  // ── DXF export ──────────────────────────────────────────────────────────────
  function exportDXF() {
    if (!m?.L1) return
    const O2 = m.O2 || { x: 0, y: 0 }
    const O4 = m.O4 || { x: m.L1, y: 0 }
    let dxf = `0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n`
    const addLine = (x1, y1, x2, y2, layer = '0') =>
      dxf += `0\nLINE\n8\n${layer}\n10\n${x1.toFixed(3)}\n20\n${y1.toFixed(3)}\n30\n0.0\n11\n${x2.toFixed(3)}\n21\n${y2.toFixed(3)}\n31\n0.0\n`
    const addCircle = (x, y, r, layer = '0') =>
      dxf += `0\nCIRCLE\n8\n${layer}\n10\n${x.toFixed(3)}\n20\n${y.toFixed(3)}\n30\n0.0\n40\n${r.toFixed(3)}\n`

    addLine(O2.x, O2.y, O4.x, O4.y, 'GROUND')
    addCircle(O2.x, O2.y, 5, 'PIVOTS'); addCircle(O4.x, O4.y, 5, 'PIVOTS')
    dxf += `0\nTEXT\n8\nDIMENSIONS\n10\n${O2.x}\n20\n-15\n30\n0\n40\n8\n1\nL1=${m.L1.toFixed(1)}mm\n`
    dxf += `0\nTEXT\n8\nDIMENSIONS\n10\n0\n20\n-25\n30\n0\n40\n6\n1\nL2=${m.L2.toFixed(1)} L3=${m.L3.toFixed(1)} L4=${m.L4.toFixed(1)}\n`
    dxf += `0\nENDSEC\n0\nEOF\n`

    const blob = new Blob([dxf], { type: 'application/dxf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'RehabLink_Mechanism.dxf'
    a.click(); URL.revokeObjectURL(url)
    setExported('DXF')
  }

  const hasData = !!m?.L1

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#07080e', display: 'flex', flexDirection: 'column' }}>

      {/* ── Header ── */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid #111520',
        background: '#08090f', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#f0f0f0', letterSpacing: '0.05em' }}>
            Export & Fabrication
          </div>
          <div style={{ color: '#333', fontSize: 11, marginTop: 2, letterSpacing: '0.08em' }}>
            Engineering Report · CAD Drawing · BOM · Fabrication Specs
          </div>
        </div>
        {exported && (
          <div style={{
            background: 'rgba(39,174,96,0.12)', border: '1px solid #27ae6040',
            borderRadius: 8, padding: '8px 16px', color: '#27ae60', fontWeight: 700, fontSize: 13,
          }}>
            ✓ {exported} exported successfully
          </div>
        )}
      </div>

      <div style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ── Blueprint + export actions ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 14 }}>

          {/* Blueprint canvas */}
          <div style={{
            background: '#07132b', border: '1px solid #102040',
            borderRadius: 12, overflow: 'hidden', position: 'relative',
          }}>
            <div style={{
              position: 'absolute', top: 10, left: 14, zIndex: 1,
              fontSize: 9, color: '#1a3a60', fontWeight: 800, letterSpacing: '0.18em',
              fontFamily: 'Consolas,monospace',
            }}>
              ENGINEERING DRAWING  ·  FOUR-BAR LINKAGE  ·  θ₂ = 45°
            </div>
            <div style={{
              position: 'absolute', top: 10, right: 14, zIndex: 1,
              display: 'flex', gap: 12,
            }}>
              {[['#ff6060','Crank L2'],['#60a0ff','Coupler L3'],['#60e060','Rocker L4']].map(([c,l]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 10, height: 3, background: c, borderRadius: 1 }} />
                  <span style={{ fontSize: 8, color: '#1a3a60', fontFamily: 'Consolas,monospace', fontWeight: 700 }}>{l}</span>
                </div>
              ))}
            </div>
            <canvas
              ref={canvasRef}
              width={680} height={340}
              style={{ width: '100%', height: 'auto', display: 'block' }}
            />
          </div>

          {/* Right panel: export + summary */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Export PDF */}
            <div style={{
              background: '#0a0c14', border: '1px solid #c0392b30',
              borderRadius: 12, padding: '16px 18px',
              borderTop: '2px solid #c0392b',
            }}>
              <div style={{ fontSize: 11, color: '#c0392b', fontWeight: 800, letterSpacing: '0.1em', marginBottom: 8 }}>
                PDF REPORT
              </div>
              <div style={{ color: '#555', fontSize: 11, marginBottom: 12, lineHeight: 1.5 }}>
                Complete A4 engineering report with patient data, link dimensions, analysis results, Grashof proof, and precision points.
              </div>
              <button
                onClick={exportPDF}
                disabled={exporting || !hasData}
                style={{
                  width: '100%', padding: '10px 0',
                  background: exporting || !hasData ? '#1a1a2a' : 'linear-gradient(135deg, #c0392b, #96281b)',
                  border: 'none', borderRadius: 8,
                  color: exporting || !hasData ? '#333' : '#fff',
                  fontWeight: 800, fontSize: 13, cursor: exporting || !hasData ? 'not-allowed' : 'pointer',
                  boxShadow: !exporting && hasData ? '0 0 20px #c0392b40' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                {exporting ? 'Generating...' : 'Export PDF'}
              </button>
            </div>

            {/* Export DXF */}
            <div style={{
              background: '#0a0c14', border: '1px solid #27ae6030',
              borderRadius: 12, padding: '16px 18px',
              borderTop: '2px solid #27ae60',
            }}>
              <div style={{ fontSize: 11, color: '#27ae60', fontWeight: 800, letterSpacing: '0.1em', marginBottom: 8 }}>
                CAD DRAWING (DXF)
              </div>
              <div style={{ color: '#555', fontSize: 11, marginBottom: 12, lineHeight: 1.5 }}>
                AutoCAD-compatible DXF with pivot locations, link lengths, and dimension annotations for CNC fabrication.
              </div>
              <button
                onClick={exportDXF}
                disabled={!hasData}
                style={{
                  width: '100%', padding: '10px 0',
                  background: !hasData ? '#1a1a2a' : 'linear-gradient(135deg, #27ae60, #1e8449)',
                  border: 'none', borderRadius: 8,
                  color: !hasData ? '#333' : '#fff',
                  fontWeight: 800, fontSize: 13, cursor: !hasData ? 'not-allowed' : 'pointer',
                  boxShadow: hasData ? '0 0 20px #27ae6040' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                Export DXF
              </button>
            </div>

            {/* Quick summary */}
            <div style={{
              background: '#0a0c14', border: '1px solid #111520',
              borderRadius: 12, padding: '14px 16px', flex: 1,
            }}>
              <div style={{ fontSize: 9, color: '#2a3a50', fontWeight: 800,
                letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>
                Mechanism Summary
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
                <AccuracyBadge score={m.accuracyScore || 0} />
              </div>
              {[
                ['L1', `${(m.L1||0).toFixed(1)} mm`, '#607090'],
                ['L2', `${(m.L2||0).toFixed(1)} mm`, '#c0392b'],
                ['L3', `${(m.L3||0).toFixed(1)} mm`, '#4a9eff'],
                ['L4', `${(m.L4||0).toFixed(1)} mm`, '#27ae60'],
                ['Grashof', m.grashof?.type || '--', m.grashof?.passes ? '#27ae60' : '#e74c3c'],
                ['Patient', patientData.name || '--', '#888'],
              ].map(([k, v, c]) => (
                <div key={k} style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '4px 0', borderBottom: '1px solid #0d1020',
                }}>
                  <span style={{ fontSize: 10, color: '#334', letterSpacing: '0.06em' }}>{k}</span>
                  <span style={{ fontSize: 11, fontFamily: 'Consolas,monospace', fontWeight: 700, color: c }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Bill of Materials + Fabrication ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

          {/* BOM */}
          <div style={{
            background: '#0a0c14', border: '1px solid #111520',
            borderRadius: 12, padding: '16px 18px',
          }}>
            <div style={{ fontSize: 9, color: '#2a3a50', fontWeight: 800,
              letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 12 }}>
              Bill of Materials
            </div>
            <table style={{ width: '100%', borderSpacing: 0 }}>
              <thead>
                <tr>
                  {['Item','Description','Material','Qty','Length'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left', fontSize: 8, color: '#2a3a50',
                      fontFamily: 'Consolas,monospace', fontWeight: 800,
                      letterSpacing: '0.1em', paddingBottom: 8,
                      borderBottom: '1px solid #111520',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ['L1', 'Ground link / frame', '6061 Alum.', '1', `${(m.L1||0).toFixed(0)} mm`],
                  ['L2', 'Crank',               '6061 Alum.', '1', `${(m.L2||0).toFixed(0)} mm`],
                  ['L3', 'Coupler',             '6061 Alum.', '1', `${(m.L3||0).toFixed(0)} mm`],
                  ['L4', 'Rocker (tibia rod)',  '6061 Alum.', '1', `${(m.L4||0).toFixed(0)} mm`],
                  ['P1', 'Pivot pin O₂',        'Steel A2',   '1', 'Ø8mm'],
                  ['P2', 'Pivot pin O₄',        'Steel A2',   '1', 'Ø8mm'],
                  ['P3', 'Pivot pin A',          'Steel A2',   '1', 'Ø6mm'],
                  ['P4', 'Pivot pin B / knee',  'Steel A2',   '1', 'Ø6mm'],
                  ['B1', 'Precision bearing O₂','6202-2RS',   '2', 'ID8mm'],
                  ['B2', 'Precision bearing O₄','6202-2RS',   '2', 'ID8mm'],
                  ['M1', 'DC Motor + gearbox',  'NEMA 23',    '1', 'At O₂'],
                ].map(([item, desc, mat, qty, dim], i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#0d0f18' }}>
                    <td style={{ padding: '5px 4px', fontFamily: 'Consolas,monospace', fontSize: 10, color: '#c0392b', fontWeight: 700 }}>{item}</td>
                    <td style={{ padding: '5px 4px', fontSize: 10, color: '#888' }}>{desc}</td>
                    <td style={{ padding: '5px 4px', fontSize: 10, color: '#555', fontFamily: 'Consolas,monospace' }}>{mat}</td>
                    <td style={{ padding: '5px 4px', fontSize: 10, color: '#aaa', textAlign: 'center' }}>{qty}</td>
                    <td style={{ padding: '5px 4px', fontSize: 10, color: '#4a9eff', fontFamily: 'Consolas,monospace' }}>{dim}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Fabrication checklist + tolerances */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Tolerances */}
            <div style={{
              background: '#0a0c14', border: '1px solid #111520',
              borderRadius: 12, padding: '14px 16px',
            }}>
              <div style={{ fontSize: 9, color: '#2a3a50', fontWeight: 800,
                letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>
                Machining Tolerances
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  ['Pivot holes',    '±0.025 mm', '#27ae60'],
                  ['Link lengths',   '±0.1 mm',   '#4a9eff'],
                  ['Flatness',       '0.05 mm',   '#f0c060'],
                  ['Surface finish', 'Ra 1.6μm',  '#888'],
                  ['Hole position',  '±0.05 mm',  '#27ae60'],
                  ['Pin clearance',  'H7/g6 fit', '#4a9eff'],
                ].map(([label, val, color]) => (
                  <div key={label} style={{
                    background: '#0d0f18', borderRadius: 7, padding: '8px 10px',
                    border: '1px solid #111520',
                  }}>
                    <div style={{ fontSize: 9, color: '#334', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 11, fontFamily: 'Consolas,monospace', fontWeight: 700, color }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Checklist */}
            <div style={{
              background: '#0a0c14', border: '1px solid #111520',
              borderRadius: 12, padding: '14px 16px', flex: 1,
            }}>
              <div style={{ fontSize: 9, color: '#2a3a50', fontWeight: 800,
                letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>
                Assembly Checklist
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  'Order 6061 aluminum bar stock (25×10mm section)',
                  'Mill pivot holes to tolerance ±0.025mm',
                  'Press precision bearings at O₂ and O₄',
                  'Verify all link lengths with vernier calipers',
                  'Assemble dry — confirm Grashof (full crank rotation)',
                  'Mount DC motor + gearbox at O₂ pivot',
                  'Attach tibial cuff bracket at output pivot B',
                  'Test ROM limits before patient use',
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{
                      width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                      border: '1px solid #1a2030',
                      background: '#0d0f18',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, color: '#1a3050', fontWeight: 700, marginTop: 1,
                    }}>
                      {i + 1}
                    </div>
                    <span style={{ fontSize: 11, color: '#555', lineHeight: 1.4 }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
