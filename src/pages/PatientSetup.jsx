import { useState, useEffect, useRef } from 'react'
import useMechanismStore from '../store/useMechanismStore'
const { setActivePage, setMechanism, setCrankAngle, setPatient, setPrecisionPoints, setSelectedSolution, updateLinkLength, addPrecisionPoint } = useMechanismStore.getState()
import { chebyshevSpacing } from '../engine/synthesis'

export default function PatientSetup() {
  const patientData     = useMechanismStore(s => s.patientData)
  const precisionPoints = useMechanismStore(s => s.precisionPoints)

  const [form, setForm] = useState({ ...patientData })
  const canvasRef = useRef(null)

  useEffect(() => {
    const pts = chebyshevSpacing(3, form.romStart, form.romEnd)
    const precision = chebyshevSpacing(3, 0, 270).map((ti, i) => ({
      theta_in: ti,
      theta_out: pts[i],
    }))
    setPrecisionPoints(precision)
    drawAnatomyCanvas(form.romStart, form.romEnd, precision)
  }, [form.romStart, form.romEnd])

  function drawAnatomyCanvas(romStart, romEnd, precision) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.2)'
    ctx.fillRect(0, 0, W, H)

    const cx = W / 2, cy = H * 0.4
    const femurLen = 110, tibiaLen = 120, r = 14

    // Draw ROM arc
    const arcR = tibiaLen + 20
    const startA = -Math.PI / 2
    const endA   = startA + (romEnd - romStart) * (Math.PI / 180)

    ctx.beginPath()
    ctx.arc(cx, cy, arcR, startA, endA)
    ctx.strokeStyle = 'rgba(0,255,136,0.3)'
    ctx.lineWidth = 20
    ctx.stroke()

    // ROM label
    ctx.fillStyle = '#27ae60'
    ctx.font = 'bold 13px Consolas,monospace'
    ctx.textAlign = 'center'
    ctx.fillText(`ROM: ${romStart}deg  -  ${romEnd}deg`, cx + arcR * 0.6, cy + 20)

    // Femur
    const femurEnd = { x: cx, y: cy + femurLen }
    ctx.beginPath()
    ctx.moveTo(cx, cy - femurLen)
    ctx.lineTo(femurEnd.x, femurEnd.y)
    ctx.strokeStyle = '#f5f0e8'
    ctx.lineWidth = 14
    ctx.lineCap = 'round'
    ctx.stroke()

    // Knee joint
    ctx.beginPath()
    ctx.arc(femurEnd.x, femurEnd.y, r, 0, 2 * Math.PI)
    ctx.fillStyle = '#e2d9c5'
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,180,255,0.6)'
    ctx.lineWidth = 2
    ctx.stroke()

    // Tibia at current ROM midpoint
    const tibiaAngle = -Math.PI / 2 + ((romStart + romEnd) / 2) * Math.PI / 180
    const tibiaEnd = {
      x: femurEnd.x + tibiaLen * Math.cos(tibiaAngle),
      y: femurEnd.y + tibiaLen * Math.sin(tibiaAngle),
    }
    ctx.beginPath()
    ctx.moveTo(femurEnd.x, femurEnd.y)
    ctx.lineTo(tibiaEnd.x, tibiaEnd.y)
    ctx.strokeStyle = '#f5f0e8'
    ctx.lineWidth = 10
    ctx.stroke()

    // Precision points on ROM arc
    const pts3 = chebyshevSpacing(3, romStart, romEnd)
    const colors = ['#ff6b6b', '#ffd93d', '#6bcb77']
    pts3.forEach((angle, i) => {
      const a = -Math.PI / 2 + angle * Math.PI / 180
      const px = cx + arcR * Math.cos(a)
      const py = cy + arcR * Math.sin(a)
      ctx.beginPath()
      ctx.arc(px, py, 6, 0, 2 * Math.PI)
      ctx.fillStyle = colors[i]
      ctx.fill()
      ctx.fillStyle = colors[i]
      ctx.font = 'bold 10px Consolas,monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`P${i + 1}: ${angle.toFixed(1)}deg`, px + 8, py + 4)
    })

    ctx.textAlign = 'left'
  }

  const handleSave = () => {
    setPatient({ ...form })
    setActivePage('synthesis')
  }

  const Field = ({ label, ...props }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ color: '#444', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</label>
      <input
        {...props}
        style={{
          background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 8, padding: '10px 14px', color: '#f0f0f0',
          fontSize: 14, outline: 'none', fontFamily: 'inherit',
          width: '100%', boxSizing: 'border-box',
        }}
      />
    </div>
  )

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 32 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#f0f0f0' }}>Patient Setup</h2>
        <p style={{ color: '#444', marginTop: 4 }}>Configure patient parameters and range of motion for linkage synthesis</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Form */}
        <div style={{
          background: '#111', border: '1px solid #1e1e1e',
          borderRadius: 16, padding: 28, display: 'flex', flexDirection: 'column', gap: 20,
        }}>
          <Field
            label="Patient Name"
            type="text"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Patient A"
          />
          <Field
            label="Injury / Condition"
            type="text"
            value={form.injury}
            onChange={e => setForm(f => ({ ...f, injury: e.target.value }))}
            placeholder="e.g. ACL Reconstruction"
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ color: '#444', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                ROM Start (deg)
              </label>
              <input
                type="range" min="0" max="30" step="5"
                value={form.romStart}
                onChange={e => setForm(f => ({ ...f, romStart: +e.target.value }))}
                style={{ accentColor: '#c0392b' }}
              />
              <span style={{ color: '#c0392b', fontFamily: 'Consolas,monospace', fontWeight: 700 }}>
                {form.romStart}deg
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ color: '#444', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                ROM End (deg)
              </label>
              <input
                type="range" min="60" max="130" step="5"
                value={form.romEnd}
                onChange={e => setForm(f => ({ ...f, romEnd: +e.target.value }))}
                style={{ accentColor: '#27ae60' }}
              />
              <span style={{ color: '#27ae60', fontFamily: 'Consolas,monospace', fontWeight: 700 }}>
                {form.romEnd}deg
              </span>
            </div>
          </div>

          {/* Precision points count selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ color: '#444', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Chebyshev Precision Points
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[3, 4, 5].map(n => (
                <button key={n}
                  onClick={() => {
                    const pts = chebyshevSpacing(n, form.romStart, form.romEnd)
                    const precision = chebyshevSpacing(n, 0, 270).map((ti, i) => ({
                      theta_in: ti, theta_out: pts[i],
                    }))
                    setPrecisionPoints(precision)
                  }}
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
                    background: precisionPoints.length === n ? 'rgba(0,180,255,0.2)' : '#1e1e1e',
                    color: precisionPoints.length === n ? '#c0392b' : '#444',
                    fontWeight: 700, cursor: 'pointer', fontSize: 14,
                  }}
                >{n}</button>
              ))}
            </div>
          </div>

          {/* Precision points table */}
          <div>
            <div style={{ color: '#444', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Precision Points (Chebyshev)
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ color: '#444', textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>Point</th>
                  <th style={{ color: '#444', textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>Theta_in (deg)</th>
                  <th style={{ color: '#444', textAlign: 'right', padding: '4px 8px', fontWeight: 600 }}>Theta_out (deg)</th>
                </tr>
              </thead>
              <tbody>
                {precisionPoints.map((pt, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
                    <td style={{ color: '#ffd93d', padding: '6px 8px', fontFamily: 'Consolas,monospace' }}>P{i + 1}</td>
                    <td style={{ color: '#c0392b', textAlign: 'right', padding: '6px 8px', fontFamily: 'Consolas,monospace' }}>{pt.theta_in.toFixed(2)}</td>
                    <td style={{ color: '#27ae60', textAlign: 'right', padding: '6px 8px', fontFamily: 'Consolas,monospace' }}>{pt.theta_out.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={handleSave}
            style={{
              background: 'linear-gradient(135deg, #c0392b, #0070cc)',
              border: 'none', borderRadius: 10, padding: '14px 28px',
              color: '#ffffff', fontWeight: 700, fontSize: 15, cursor: 'pointer',
              boxShadow: '0 0 20px rgba(0,180,255,0.3)',
            }}
          >
            Save & Go to Synthesis {'->'}
          </button>
        </div>

        {/* Anatomy canvas */}
        <div style={{
          background: '#111', border: '1px solid #1e1e1e',
          borderRadius: 16, padding: 20,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div style={{ color: '#444', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Knee Anatomy &amp; ROM Visualization
          </div>
          <canvas
            ref={canvasRef}
            width={400}
            height={380}
            style={{ width: '100%', height: 'auto', background: 'rgba(0,0,0,0.2)', borderRadius: 10 }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <InfoCard label="ROM Range" value={`${form.romEnd - form.romStart}deg`} color="#c0392b" />
            <InfoCard label="Target Flexion" value={`${form.romEnd}deg`} color="#27ae60" />
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoCard({ label, value, color }) {
  return (
    <div style={{
      background: '#1e1e1e', borderRadius: 10, padding: '12px 16px',
      border: `1px solid ${color}22`,
    }}>
      <div style={{ color: '#444', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ color, fontSize: 22, fontWeight: 700, fontFamily: 'Consolas,monospace', marginTop: 4 }}>{value}</div>
    </div>
  )
}




