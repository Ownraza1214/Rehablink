import { useRef, useState, useEffect, Suspense, Component, useMemo, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Line } from '@react-three/drei'
import * as THREE from 'three'
import useMechanismStore from '../store/useMechanismStore'
import { forwardKinematicsRaw } from '../engine/synthesis'

const DEG = Math.PI / 180
const S   = 0.007  // mm → THREE units

// ── Imperative bar helper ─────────────────────────────────────────────────────
const _Y   = new THREE.Vector3(0, 1, 0)
const _dir = new THREE.Vector3()
const _mid = new THREE.Vector3()
const _q   = new THREE.Quaternion()

function setBar(mesh, p1, p2) {
  if (!mesh) return
  _dir.subVectors(p2, p1)
  const len = _dir.length()
  if (len < 0.0001) return
  _dir.divideScalar(len)
  _mid.addVectors(p1, p2).multiplyScalar(0.5)
  mesh.position.copy(_mid)
  if (Math.abs(_dir.y + 1) < 0.0001) {
    mesh.quaternion.set(0, 0, 1, 0)
  } else {
    _q.setFromUnitVectors(_Y, _dir)
    mesh.quaternion.copy(_q)
  }
  mesh.scale.setY(len)
}

// ── Error boundary ────────────────────────────────────────────────────────────
class ThreeErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  componentDidCatch(e) { console.error('3D error:', e) }
  render() {
    if (this.state.error) return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
        height:'100%', background:'#060810', color:'#555', gap:16 }}>
        <div style={{ color:'#c0392b', fontWeight:700, fontSize:16 }}>3D Renderer Error</div>
        <div style={{ fontSize:12, maxWidth:320, textAlign:'center' }}>{this.state.error.message}</div>
        <button onClick={() => this.setState({ error:null })}
          style={{ background:'#c0392b', border:'none', borderRadius:8, padding:'10px 24px', color:'#fff', fontWeight:700, cursor:'pointer' }}>
          Retry
        </button>
      </div>
    )
    return this.props.children
  }
}

// ── Camera sync ───────────────────────────────────────────────────────────────
function CameraSync({ preset, controlsRef }) {
  const { camera } = useThree()
  useEffect(() => {
    if (!preset) return
    camera.position.set(...preset.pos)
    if (controlsRef.current) {
      controlsRef.current.target.set(...preset.tgt)
      controlsRef.current.update()
    }
  }, [preset]) // eslint-disable-line
  return null
}

// ── Ground pin (inverted cone + base) ────────────────────────────────────────
function GroundPin({ pos, color }) {
  return (
    <group position={pos}>
      <mesh rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.055, 0.16, 6]} />
        <meshStandardMaterial color={color} metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[0, -0.08, 0]}>
        <cylinderGeometry args={[0.08, 0.1, 0.018, 8]} />
        <meshStandardMaterial color={color} metalness={0.8} roughness={0.2} />
      </mesh>
    </group>
  )
}

// ── Link material helper ──────────────────────────────────────────────────────
function BarMat({ color, emissive, xray }) {
  return xray
    ? <meshBasicMaterial key="w" color={color} wireframe />
    : <meshStandardMaterial key="s" color={color} emissive={emissive || '#000'} emissiveIntensity={0.25} metalness={0.72} roughness={0.22} />
}

function PivotMat({ color, xray }) {
  return xray
    ? <meshBasicMaterial key="w" color={color} wireframe />
    : <meshStandardMaterial key="s" color={color} emissive={color} emissiveIntensity={0.4} metalness={0.5} roughness={0.18} />
}

// ── Animated 3D scene ─────────────────────────────────────────────────────────
function AnimatedScene({ mechanism, playingRef, speedRef, xray, showLeg, showCurve, onFrame, romStart, romEnd }) {
  const crankRef   = useRef()
  const couplerRef = useRef()
  const rockerRef  = useRef()
  const groundRef  = useRef()
  const pivARef    = useRef()
  const pivBRef    = useRef()
  const femurRef   = useRef()
  const tibiaRef   = useRef()
  const kneeRef    = useRef()

  const angleRef = useRef(0)
  const frameN   = useRef(0)

  const { L1=200, L2=80, L3=180, L4=160,
          O2={ x:0, y:0 }, O4: _O4 } = mechanism || {}
  const O4 = _O4 || { x: L1, y: 0 }

  const pO2 = useMemo(() => new THREE.Vector3(O2.x*S, O2.y*S, 0), [O2.x, O2.y])
  const pO4 = useMemo(() => new THREE.Vector3(O4.x*S, O4.y*S, 0), [O4.x, O4.y])

  // Precompute full coupler midpoint curve
  const curvePts = useMemo(() => {
    if (!mechanism?.L1) return []
    const pts = []
    for (let a = 0; a <= 362; a += 2) {
      const fk = forwardKinematicsRaw(a * DEG, L1, L2, L3, L4, O2, O4)
      if (fk) pts.push([
        (fk.A.x + fk.B.x) / 2 * S,
        (fk.A.y + fk.B.y) / 2 * S,
        0.015,
      ])
    }
    return pts
  }, [mechanism]) // eslint-disable-line

  useFrame((_, dt) => {
    if (!mechanism?.L1) return
    if (playingRef.current)
      angleRef.current = (angleRef.current + dt * 60 * speedRef.current) % 360

    const fk = forwardKinematicsRaw(angleRef.current * DEG, L1, L2, L3, L4, O2, O4)
    if (!fk) return

    const pA = new THREE.Vector3(fk.A.x*S, fk.A.y*S, 0)
    const pB = new THREE.Vector3(fk.B.x*S, fk.B.y*S, 0)

    setBar(crankRef.current,   pO2, pA)
    setBar(couplerRef.current, pA,  pB)
    setBar(rockerRef.current,  pO4, pB)

    if (pivARef.current) pivARef.current.position.copy(pA)
    if (pivBRef.current) pivBRef.current.position.copy(pB)

    if (showLeg) {
      const fLen = pO4.distanceTo(pB) * 1.1
      const kPos = pO4.clone().setZ(0.05)
      const aPos = pB.clone().setZ(0.05)
      const hPos = kPos.clone().add(new THREE.Vector3(0, fLen, 0))

      setBar(femurRef.current, hPos, kPos)
      setBar(tibiaRef.current, kPos, aPos)
      if (kneeRef.current) kneeRef.current.position.copy(kPos)
    }

    frameN.current++
    if (frameN.current % 4 === 0 && onFrame)
      onFrame(angleRef.current, fk)
  })

  if (!mechanism?.L1) return null

  // Ground bar (static)
  const gLen  = pO2.distanceTo(pO4) + 0.14
  const gMid  = pO2.clone().add(pO4).multiplyScalar(0.5).setY(pO2.y - 0.02)
  const gAngle = Math.atan2(pO4.y - pO2.y, pO4.x - pO2.x)

  return (
    <group>
      {/* ── Ground bar ── */}
      <mesh position={gMid.toArray()} rotation={[0, 0, gAngle]}>
        <boxGeometry args={[gLen, 0.028, 0.04]} />
        {xray
          ? <meshBasicMaterial color="#222" wireframe />
          : <meshStandardMaterial color="#111418" metalness={0.9} roughness={0.15} />
        }
      </mesh>

      {/* ── Hatch marks on ground bar ── */}
      {Array.from({ length: 7 }, (_, i) => {
        const t = (i + 1) / 8
        const px = pO2.x + (pO4.x - pO2.x) * t
        const py = pO2.y + (pO4.y - pO2.y) * t - 0.015
        return (
          <mesh key={i} position={[px, py, 0.025]} rotation={[0, 0, Math.PI / 4 + gAngle]}>
            <boxGeometry args={[0.005, 0.04, 0.002]} />
            <meshBasicMaterial color="#333" />
          </mesh>
        )
      })}

      {/* ── Crank (red) ── */}
      <mesh ref={crankRef}>
        <boxGeometry args={[0.046, 1, 0.032]} />
        <BarMat color="#c0392b" emissive="#3d0f0f" xray={xray} />
      </mesh>

      {/* ── Coupler (blue) ── */}
      <mesh ref={couplerRef}>
        <boxGeometry args={[0.04, 1, 0.028]} />
        <BarMat color="#2980b9" emissive="#0d2840" xray={xray} />
      </mesh>

      {/* ── Rocker (green) ── */}
      <mesh ref={rockerRef}>
        <boxGeometry args={[0.04, 1, 0.028]} />
        <BarMat color="#27ae60" emissive="#0a2a14" xray={xray} />
      </mesh>

      {/* ── Fixed pivots (O2, O4) ── */}
      <mesh position={pO2.toArray()}>
        <sphereGeometry args={[0.058, 18, 18]} />
        <PivotMat color="#e74c3c" xray={xray} />
      </mesh>
      <mesh position={pO4.toArray()}>
        <sphereGeometry args={[0.058, 18, 18]} />
        <PivotMat color="#2ecc71" xray={xray} />
      </mesh>

      {/* ── Moving pivots (A, B) ── */}
      <mesh ref={pivARef}>
        <sphereGeometry args={[0.042, 14, 14]} />
        <PivotMat color="#ecf0f1" xray={xray} />
      </mesh>
      <mesh ref={pivBRef}>
        <sphereGeometry args={[0.042, 14, 14]} />
        <PivotMat color="#ecf0f1" xray={xray} />
      </mesh>

      {/* ── Ground pins ── */}
      <GroundPin pos={[pO2.x, pO2.y - 0.09, 0]} color={xray ? '#444' : '#2c2c2c'} />
      <GroundPin pos={[pO4.x, pO4.y - 0.09, 0]} color={xray ? '#444' : '#2c2c2c'} />

      {/* ── Leg model ── */}
      {showLeg && (
        <group>
          <mesh ref={femurRef}>
            <cylinderGeometry args={[0.038, 0.032, 1, 12]} />
            {xray
              ? <meshBasicMaterial key="fw" color="#22c55e" wireframe />
              : <meshStandardMaterial key="fs" color="#f5f0e8" roughness={0.55} metalness={0.04} />
            }
          </mesh>
          <mesh ref={tibiaRef}>
            <cylinderGeometry args={[0.028, 0.022, 1, 12]} />
            {xray
              ? <meshBasicMaterial key="tw" color="#22c55e" wireframe />
              : <meshStandardMaterial key="ts" color="#ede8e0" roughness={0.55} metalness={0.04} />
            }
          </mesh>
          <mesh ref={kneeRef}>
            <sphereGeometry args={[0.056, 14, 14]} />
            {xray
              ? <meshBasicMaterial key="kw" color="#22c55e" wireframe />
              : <meshStandardMaterial key="ks" color="#ddd8d0" roughness={0.42} metalness={0.08} />
            }
          </mesh>
        </group>
      )}

      {/* ── Coupler curve ── */}
      {showCurve && curvePts.length > 3 && (
        <Line
          points={curvePts}
          color="#ff6b35"
          lineWidth={2.2}
          transparent
          opacity={0.55}
        />
      )}

      {/* ── ROM arc on rocker pivot ── */}
      <mesh position={pO4.toArray()} rotation={[0, 0, romStart * DEG - Math.PI / 2]}>
        <torusGeometry args={[0.7, 0.01, 8, 64, (romEnd - romStart) * DEG]} />
        <meshBasicMaterial color="#27ae60" transparent opacity={0.35} />
      </mesh>
    </group>
  )
}

// ── Floor grid (memoized) ─────────────────────────────────────────────────────
function FloorGrid({ cx }) {
  const grid = useMemo(() => {
    const g = new THREE.GridHelper(12, 48, '#141820', '#0e1018')
    return g
  }, [])
  return <primitive object={grid} position={[cx, -0.15, 0]} />
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function MotionSimulator3D() {
  const mechanism  = useMechanismStore(s => s.mechanism)
  const patientData = useMechanismStore(s => s.patientData)

  const [playing,    setPlaying]    = useState(true)
  const [speed,      setSpeed]      = useState(1)
  const [xray,       setXray]       = useState(false)
  const [showLeg,    setShowLeg]    = useState(true)
  const [showCurve,  setShowCurve]  = useState(true)
  const [liveAngle,  setLiveAngle]  = useState(0)
  const [liveFk,     setLiveFk]     = useState(null)
  const [camPreset,  setCamPreset]  = useState(null)
  const [activeCam,  setActiveCam]  = useState('iso')

  const playingRef  = useRef(true)
  const speedRef    = useRef(1)
  const controlsRef = useRef()

  useEffect(() => { playingRef.current = playing }, [playing])
  useEffect(() => { speedRef.current = speed },     [speed])

  const handleFrame = useCallback((angle, fk) => {
    setLiveAngle(Math.round(angle))
    setLiveFk(fk)
  }, [])

  const { L1=200, O2={ x:0, y:0 }, O4: _O4 } = mechanism || {}
  const O4 = _O4 || { x: L1, y: 0 }
  const cx  = ((O2.x + O4.x) / 2) * S
  const cy  = 0.35

  const presets = useMemo(() => ({
    iso:   { pos: [cx + 2.2, cy + 1.6, 3.6], tgt: [cx, cy - 0.1, 0] },
    side:  { pos: [cx,       cy + 0.2, 4.2], tgt: [cx, cy + 0.2, 0] },
    top:   { pos: [cx,       cy + 4.5, 0.1], tgt: [cx, cy,       0] },
    front: { pos: [cx + 0.1, cy,       4.2], tgt: [cx, cy,       0] },
  }), [cx, cy])

  function selectCam(key) {
    setActiveCam(key)
    setCamPreset(presets[key])
  }

  const theta4Deg = liveFk ? (liveFk.theta4 / DEG).toFixed(1) : '--'

  return (
    <div style={{ position:'relative', width:'100%', height:'100%', background:'#060810',
      fontFamily:'Consolas,monospace', userSelect:'none' }}>

      <ThreeErrorBoundary>
        <Canvas
          camera={{ position: [cx + 2.2, cy + 1.6, 3.6], fov: 44, near: 0.01, far: 50 }}
          gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.15 }}
        >
          <color attach="background" args={['#060810']} />
          <fog attach="fog" args={['#060810', 10, 22]} />

          <ambientLight intensity={0.22} color="#c8d4f0" />
          <directionalLight position={[5, 6, 4]} intensity={1.6} color="#fffaf0" />
          <directionalLight position={[-4, 3, -3]} intensity={0.4} color="#4060ff" />
          <pointLight position={[cx, 2, 1.5]} intensity={1.1} color="#ff8855" distance={7} decay={2} />
          <pointLight position={[cx, -0.5, 2]} intensity={0.3} color="#204080" distance={5} decay={2} />

          <Suspense fallback={null}>
            <AnimatedScene
              mechanism={mechanism}
              playingRef={playingRef}
              speedRef={speedRef}
              xray={xray}
              showLeg={showLeg}
              showCurve={showCurve}
              onFrame={handleFrame}
              romStart={patientData?.romStart ?? 0}
              romEnd={patientData?.romEnd ?? 120}
            />
          </Suspense>

          <FloorGrid cx={cx} />

          <OrbitControls
            ref={controlsRef}
            target={[cx, cy - 0.1, 0]}
            enableDamping
            dampingFactor={0.07}
            minDistance={0.4}
            maxDistance={14}
            makeDefault
          />

          <CameraSync preset={camPreset} controlsRef={controlsRef} />
        </Canvas>
      </ThreeErrorBoundary>

      {/* ── Top-left info panel ────────────────────────────────────────── */}
      <div style={{
        position:'absolute', top:14, left:14, pointerEvents:'none',
        background:'rgba(6,8,16,0.88)', border:'1px solid #1a2030',
        borderRadius:10, padding:'10px 14px', minWidth:180,
      }}>
        <div style={{ color:'#3060c0', fontSize:9, fontWeight:800, letterSpacing:'0.18em',
          textTransform:'uppercase', marginBottom:6 }}>
          Motion Simulator 3D
        </div>
        {mechanism?.L1 ? (
          <table style={{ borderSpacing:'0 2px', fontSize:11 }}>
            <tbody>
              <DataRow label="θ₂"   val={`${liveAngle}°`}        color="#e74c3c" />
              <DataRow label="θ₄"   val={`${theta4Deg}°`}         color="#27ae60" />
              <DataRow label="L1"   val={`${mechanism.L1?.toFixed(0)} mm`} color="#888" />
              <DataRow label="L2"   val={`${mechanism.L2?.toFixed(0)} mm`} color="#888" />
              <DataRow label="L3"   val={`${mechanism.L3?.toFixed(0)} mm`} color="#888" />
              <DataRow label="L4"   val={`${mechanism.L4?.toFixed(0)} mm`} color="#888" />
            </tbody>
          </table>
        ) : (
          <div style={{ color:'#333', fontSize:11 }}>No mechanism loaded</div>
        )}
      </div>

      {/* ── Top-right ROM panel ───────────────────────────────────────── */}
      <div style={{
        position:'absolute', top:14, right:14, pointerEvents:'none',
        background:'rgba(6,8,16,0.88)', border:'1px solid #1a2030',
        borderRadius:10, padding:'10px 14px', minWidth:160,
      }}>
        <div style={{ color:'#3060c0', fontSize:9, fontWeight:800, letterSpacing:'0.18em',
          textTransform:'uppercase', marginBottom:8 }}>
          ROM Safety
        </div>
        <div style={{ color:'#444', fontSize:10, marginBottom:4 }}>
          {patientData?.romStart ?? 0}° {'→'} {patientData?.romEnd ?? 120}°
        </div>
        <div style={{ height:5, width:'100%', background:'#111', borderRadius:3, overflow:'hidden' }}>
          <div style={{
            height:'100%', borderRadius:3,
            width:`${(((patientData?.romEnd ?? 120) - (patientData?.romStart ?? 0)) / 130) * 100}%`,
            background:'linear-gradient(90deg, #27ae60, #2ecc71)',
          }} />
        </div>
      </div>

      {/* ── Bottom controls bar ───────────────────────────────────────── */}
      <div style={{
        position:'absolute', bottom:0, left:0, right:0,
        background:'rgba(6,8,16,0.92)', borderTop:'1px solid #141820',
        display:'flex', alignItems:'center', gap:10, padding:'8px 16px', flexWrap:'wrap',
      }}>
        {/* Play/pause */}
        <button onClick={() => setPlaying(v => !v)} style={btnStyle(playing, '#c0392b')}>
          {playing ? '⏸' : '▶'}
        </button>

        {/* Speed */}
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ color:'#444', fontSize:10, fontWeight:700 }}>SPD</span>
          {[0.25, 0.5, 1, 2, 3].map(s => (
            <button key={s} onClick={() => setSpeed(s)} style={btnStyle(speed === s, '#2980b9')}
              title={`${s}x speed`}>
              {s}×
            </button>
          ))}
        </div>

        <div style={{ width:1, height:24, background:'#1a2030', margin:'0 4px' }} />

        {/* Camera presets */}
        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
          <span style={{ color:'#444', fontSize:10, fontWeight:700 }}>CAM</span>
          {[['iso','ISO'],['side','SIDE'],['top','TOP'],['front','FRNT']].map(([k,l]) => (
            <button key={k} onClick={() => selectCam(k)} style={btnStyle(activeCam === k, '#2c3e50')}>
              {l}
            </button>
          ))}
        </div>

        <div style={{ width:1, height:24, background:'#1a2030', margin:'0 4px' }} />

        {/* Toggles */}
        <button onClick={() => setXray(v => !v)}      style={btnStyle(xray,      '#8e44ad')}>X-RAY</button>
        <button onClick={() => setShowLeg(v => !v)}   style={btnStyle(showLeg,   '#16a085')}>LEG</button>
        <button onClick={() => setShowCurve(v => !v)} style={btnStyle(showCurve, '#e67e22')}>CURVE</button>

        {/* Legend */}
        <div style={{ marginLeft:'auto', display:'flex', gap:12, pointerEvents:'none' }}>
          {[['#e74c3c','Crank'],['#2980b9','Coupler'],['#27ae60','Rocker'],['#ff6b35','Coupler Curve']].map(([c,l]) => (
            <div key={l} style={{ display:'flex', alignItems:'center', gap:4 }}>
              <div style={{ width:10, height:10, borderRadius:2, background:c }} />
              <span style={{ color:'#333', fontSize:9, fontWeight:700, letterSpacing:'0.08em' }}>{l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Orbit hint ─────────────────────────────────────────────────── */}
      <div style={{
        position:'absolute', bottom:52, left:'50%', transform:'translateX(-50%)',
        color:'#1a2030', fontSize:9, letterSpacing:'0.12em', pointerEvents:'none', fontWeight:700,
      }}>
        SCROLL TO ZOOM &nbsp;·&nbsp; DRAG TO ORBIT &nbsp;·&nbsp; RIGHT-DRAG TO PAN
      </div>
    </div>
  )
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function DataRow({ label, val, color }) {
  return (
    <tr>
      <td style={{ color:'#334', fontSize:10, fontWeight:700, paddingRight:10,
        letterSpacing:'0.1em', textTransform:'uppercase' }}>{label}</td>
      <td style={{ color, fontWeight:800, fontSize:12, fontFamily:'Consolas,monospace' }}>{val}</td>
    </tr>
  )
}

function btnStyle(active, activeColor) {
  return {
    background: active ? activeColor : 'rgba(255,255,255,0.03)',
    border: `1px solid ${active ? activeColor : '#1a2030'}`,
    borderRadius: 6,
    padding: '5px 10px',
    color: active ? '#fff' : '#444',
    fontWeight: 800,
    fontSize: 10,
    cursor: 'pointer',
    letterSpacing: '0.08em',
    fontFamily: 'Consolas,monospace',
    transition: 'all 0.15s',
  }
}
