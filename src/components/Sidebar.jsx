import { useState } from 'react'
import useMechanismStore from '../store/useMechanismStore'

const { setActivePage } = useMechanismStore.getState()

const PAGES = [
  { id: 'dashboard',   label: 'Dashboard',        num: '01' },
  { id: 'patient',     label: 'Patient Setup',     num: '02' },
  { id: 'synthesis',   label: 'Synthesis',         num: '03' },
  { id: 'kinematic',   label: 'Kinematics',        num: '04' },
  { id: 'forces',      label: 'Force & Dynamics',  num: '05' },
  { id: 'optimizer',   label: 'Optimizer',         num: '06' },
  { id: 'simulator3d', label: '3D Simulator',      num: '07' },
  { id: 'validation',  label: 'Validation',        num: '08' },
  { id: 'export',      label: 'Export',            num: '09' },
]

export default function Sidebar() {
  const activePage = useMechanismStore(s => s.activePage)
  const [open, setOpen] = useState(true)

  return (
    <aside style={{
      width: open ? 214 : 56,
      minHeight: '100vh',
      background: '#080a0f',
      borderRight: '1px solid #131820',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      overflow: 'hidden',
      transition: 'width 0.22s cubic-bezier(0.4,0,0.2,1)',
      userSelect: 'none',
    }}>
      {/* Brand + toggle */}
      <div style={{
        height: 50,
        flexShrink: 0,
        borderBottom: '1px solid #131820',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 10px',
      }}>
        {/* Logo mark */}
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: 'linear-gradient(135deg, #c0392b, #96281b)',
          flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 900, color: '#fff',
          letterSpacing: '-0.5px', fontFamily: 'Consolas,monospace',
        }}>
          RL
        </div>
        {/* Brand name – only visible when open */}
        <div style={{
          overflow: 'hidden', whiteSpace: 'nowrap',
          opacity: open ? 1 : 0,
          transition: 'opacity 0.18s',
        }}>
          <div style={{ color: '#f0f0f0', fontSize: 11, fontWeight: 900, letterSpacing: '0.18em' }}>REHABLINK</div>
          <div style={{ color: '#333', fontSize: 8, letterSpacing: '0.12em' }}>PIEAS  ·  CEP</div>
        </div>
        {/* Toggle arrow */}
        <button
          onClick={() => setOpen(v => !v)}
          title={open ? 'Collapse sidebar' : 'Expand sidebar'}
          style={{
            marginLeft: 'auto',
            width: 24, height: 24,
            borderRadius: 6,
            border: '1px solid #1e2530',
            background: '#0f1218',
            color: '#444',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, flexShrink: 0,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#f0f0f0'; e.currentTarget.style.borderColor = '#333' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#444'; e.currentTarget.style.borderColor = '#1e2530' }}
        >
          {open ? '‹' : '›'}
        </button>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', overflowX: 'hidden' }}>
        {PAGES.map(p => {
          const active = activePage === p.id
          return (
            <button
              key={p.id}
              onClick={() => setActivePage(p.id)}
              title={open ? undefined : `${p.num} — ${p.label}`}
              style={{
                width: '100%',
                height: 40,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '0 6px',
                border: 'none',
                borderRadius: 8,
                background: active ? 'rgba(192,57,43,0.14)' : 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
                whiteSpace: 'nowrap',
                position: 'relative',
                transition: 'background 0.12s',
                outline: 'none',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
            >
              {/* Active left border */}
              {active && (
                <div style={{
                  position: 'absolute', left: 0, top: '20%', height: '60%',
                  width: 3, borderRadius: '0 2px 2px 0',
                  background: '#c0392b',
                }} />
              )}

              {/* Number badge */}
              <div style={{
                width: 32, height: 28,
                borderRadius: 6,
                flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: active ? '#c0392b' : '#0f1218',
                border: `1px solid ${active ? '#c0392b' : '#1a2030'}`,
                transition: 'all 0.12s',
              }}>
                <span style={{
                  fontSize: 9, fontWeight: 800,
                  fontFamily: 'Consolas,monospace',
                  color: active ? '#fff' : '#444',
                  letterSpacing: '0.05em',
                }}>
                  {p.num}
                </span>
              </div>

              {/* Page name */}
              <span style={{
                fontSize: 11, fontWeight: active ? 700 : 500,
                color: active ? '#f0f0f0' : '#555',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                transition: 'color 0.12s',
              }}>
                {p.label}
              </span>
            </button>
          )
        })}
      </nav>

      {/* Footer */}
      <div style={{
        borderTop: '1px solid #131820',
        padding: '10px 10px',
        flexShrink: 0,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#27ae60', flexShrink: 0, boxShadow: '0 0 6px #27ae60' }} />
          <span style={{
            fontSize: 8, color: '#333', letterSpacing: '0.12em', fontWeight: 700,
            opacity: open ? 1 : 0, transition: 'opacity 0.18s',
          }}>
            SYSTEM ONLINE
          </span>
        </div>
        {open && (
          <div style={{ marginTop: 6, fontSize: 8, color: '#1e2530', lineHeight: 1.6, letterSpacing: '0.06em' }}>
            Mechanics of Machines<br />
            M. Own Raza · M. Rayyan
          </div>
        )}
      </div>
    </aside>
  )
}
