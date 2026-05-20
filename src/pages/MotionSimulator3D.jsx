import { useRef, useState, useEffect, Suspense, Component, useMemo, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Line } from '@react-three/drei'
import * as THREE from 'three'
import useMechanismStore from '../store/useMechanismStore'
import { forwardKinematicsRaw } from '../engine/synthesis'

const DEG = Math.PI / 180
const S   = 0.008   // mm → THREE units

// ── Shared temporaries (avoid GC) ─────────────────────────────────────────────
const _Y   = new THREE.Vector3(0, 1, 0)
const _dir = new THREE.Vector3()
const _mid = new THREE.Vector3()
const _q   = new THREE.Quaternion()

/**
 * Imperatively positions + orients a mesh as a bar from p1 → p2.
 * Works with any geometry whose principal axis is Y (BoxGeometry, CylinderGeometry).
 * scale.y is set to the length so a unit-height geometry spans p1→p2.
 */
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

// ── Error boundary ─────────────────────────────────────────────────────────────
class ThreeErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  componentDidCatch(e) { console.error('3D error:', e) }
  render() {
    if (this.state.error) return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
        justifyContent:'center', height:'100%', background:'#060810', color:'#555', gap:16 }}>
        <div style={{ color:'#c0392b', fontWeight:700, fontSize:16 }}>3D Renderer Error</div>
        <div style={{ fontSize:12, maxWidth:320, textAlign:'center' }}>{this.state.error.message}</div>
        <button onClick={() => this.setState({ error:null })}
          style={{ background:'#c0392b', border:'none', borderRadius:8, padding:'10px 24px',
            color:'#fff', fontWeight:700, cursor:'pointer' }}>Retry</button>
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

// ── Materials (shared instances via useMemo pattern) ──────────────────────────
const MAT = {
  steel:    { color:'#1c2028', metalness:0.95, roughness:0.12 },
  steelMid: { color:'#252d38', metalness:0.90, roughness:0.15 },
  chrome:   { color:'#b8c4cc', metalness:0.95, roughness:0.06 },
  crank:    { color:'#c0392b', emissive:'#3a0c0c', emissiveIntensity:0.18, metalness:0.85, roughness:0.15 },
  coupler:  { color:'#546e7a', emissive:'#0a1520', emissiveIntensity:0.10, metalness:0.80, roughness:0.18 },
  rocker:   { color:'#1b7a3e', emissive:'#0a2010', emissiveIntensity:0.18, metalness:0.82, roughness:0.16 },
  motor:    { color:'#1a1020', metalness:0.88, roughness:0.20 },
  motorFace:{ color:'#7b2fbe', emissive:'#7b2fbe', emissiveIntensity:0.35, metalness:0.65, roughness:0.30 },
  shaft:    { color:'#606870', metalness:0.95, roughness:0.08 },
  foot:     { color:'#141c22', metalness:0.88, roughness:0.22 },
  skin:     { color:'#e0b896', roughness:0.68, metalness:0.02 },
  skinDark: { color:'#c9a07c', roughness:0.60, metalness:0.03 },
  strap:    { color:'#1a2840', roughness:0.70, metalness:0.10 },
  hatch:    { color:'#2a3a4a' },
}

function Solid(props) { return <meshStandardMaterial {...props} /> }

// ── Machine rail (I-beam profile) ─────────────────────────────────────────────
function MachineRail({ pO2, pO4, xray }) {
  const len   = pO2.distanceTo(pO4)
  const mid   = pO2.clone().add(pO4).multiplyScalar(0.5)
  const angle = Math.atan2(pO4.y - pO2.y, pO4.x - pO2.x)
  const extLen = len + 0.18
  return (
    <group position={mid.toArray()} rotation={[0, 0, angle]}>
      {/* Web */}
      <mesh>
        <boxGeometry args={[extLen, 0.022, 0.048]} />
        {xray ? <meshBasicMaterial color="#1c2028" wireframe />
               : <Solid {...MAT.steel} />}
      </mesh>
      {/* Top flange */}
      <mesh position={[0, 0.022, 0]}>
        <boxGeometry args={[extLen, 0.009, 0.076]} />
        {xray ? <meshBasicMaterial color="#252d38" wireframe />
               : <Solid {...MAT.steelMid} />}
      </mesh>
      {/* Bottom flange */}
      <mesh position={[0, -0.022, 0]}>
        <boxGeometry args={[extLen, 0.009, 0.076]} />
        {xray ? <meshBasicMaterial color="#252d38" wireframe />
               : <Solid {...MAT.steelMid} />}
      </mesh>
      {/* Bolt holes decoration (visual only) */}
      {[-0.35, -0.10, 0.10, 0.35].map((t, i) => {
        const bx = t * len
        return (
          <mesh key={i} position={[bx, 0.028, 0]} rotation={[Math.PI/2, 0, 0]}>
            <cylinderGeometry args={[0.010, 0.010, 0.016, 8]} />
            {xray ? <meshBasicMaterial color="#111" wireframe />
                   : <Solid color="#111820" metalness={0.9} roughness={0.3} />}
          </mesh>
        )
      })}
    </group>
  )
}

// ── Hatch marks under ground bar ──────────────────────────────────────────────
function HatchMarks({ pO2, pO4 }) {
  const angle = Math.atan2(pO4.y - pO2.y, pO4.x - pO2.x)
  return (
    <>
      {Array.from({ length: 10 }, (_, i) => {
        const t  = (i + 1) / 11
        const px = pO2.x + (pO4.x - pO2.x) * t
        const py = pO2.y + (pO4.y - pO2.y) * t - 0.022
        return (
          <mesh key={i} position={[px, py, 0.042]} rotation={[0, 0, Math.PI/4 + angle]}>
            <boxGeometry args={[0.006, 0.044, 0.003]} />
            <meshBasicMaterial color={MAT.hatch.color} />
          </mesh>
        )
      })}
    </>
  )
}

// ── Support leg (vertical post + foot pad) ────────────────────────────────────
function SupportLeg({ x, y, xray }) {
  return (
    <group position={[x, y - 0.028, 0]}>
      <mesh>
        <cylinderGeometry args={[0.014, 0.018, 0.22, 10]} />
        {xray ? <meshBasicMaterial color="#1a2028" wireframe />
               : <Solid {...MAT.steel} />}
      </mesh>
      <mesh position={[0, -0.115, 0]}>
        <cylinderGeometry args={[0.044, 0.052, 0.018, 10]} />
        {xray ? <meshBasicMaterial color="#111820" wireframe />
               : <Solid color="#111820" metalness={0.85} roughness={0.28} />}
      </mesh>
    </group>
  )
}

// ── Motor housing at O2 ───────────────────────────────────────────────────────
function MotorHousing({ x, y, xray }) {
  return (
    <group position={[x, y - 0.06, 0.01]}>
      {/* Motor body cylinder */}
      <mesh>
        <cylinderGeometry args={[0.088, 0.092, 0.085, 18]} />
        {xray ? <meshBasicMaterial color="#1a1020" wireframe />
               : <Solid {...MAT.motor} />}
      </mesh>
      {/* Cooling fin rings */}
      {[-0.022, 0, 0.022].map((dy, i) => (
        <mesh key={i} position={[0, dy, 0]}>
          <torusGeometry args={[0.094, 0.005, 6, 20]} />
          {xray ? <meshBasicMaterial color="#2a1a30" wireframe />
                 : <Solid color="#261630" metalness={0.9} roughness={0.2} />}
        </mesh>
      ))}
      {/* Front face plate (purple accent) */}
      <mesh position={[0, 0.048, 0]}>
        <cylinderGeometry args={[0.086, 0.086, 0.010, 18]} />
        {xray ? <meshBasicMaterial color="#7b2fbe" wireframe />
               : <Solid {...MAT.motorFace} />}
      </mesh>
      {/* Output shaft */}
      <mesh position={[0, 0.068, 0]}>
        <cylinderGeometry args={[0.017, 0.017, 0.038, 10]} />
        {xray ? <meshBasicMaterial color="#606870" wireframe />
               : <Solid {...MAT.shaft} />}
      </mesh>
    </group>
  )
}

// ── Round tube link (main linkage bars) ───────────────────────────────────────
// Uses CylinderGeometry; setBar scales Y to correct length each frame.
function TubeLink({ meshRef, color, emissive, emissiveIntensity=0.15, r=0.026, xray }) {
  return (
    <mesh ref={meshRef}>
      <cylinderGeometry args={[r, r, 1, 16]} />
      {xray
        ? <meshBasicMaterial color={color} wireframe />
        : <meshStandardMaterial color={color} emissive={emissive || '#000'}
            emissiveIntensity={emissiveIntensity} metalness={0.86} roughness={0.14} />}
    </mesh>
  )
}

// ── End-cap sphere for link joints ────────────────────────────────────────────
function PivotBall({ meshRef, pos=[0,0,0], r=0.050, color, xray }) {
  return (
    <mesh ref={meshRef} position={pos}>
      <sphereGeometry args={[r, 22, 22]} />
      {xray
        ? <meshBasicMaterial color={color} wireframe />
        : <meshStandardMaterial color={color} metalness={0.92} roughness={0.07}
            envMapIntensity={1.0} />}
    </mesh>
  )
}

// ── Ground pin (triangle symbol) ──────────────────────────────────────────────
function GroundPin({ pos, color, xray }) {
  return (
    <group position={pos}>
      <mesh rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.048, 0.14, 6]} />
        {xray ? <meshBasicMaterial color={color} wireframe />
               : <Solid color={color} metalness={0.72} roughness={0.28} />}
      </mesh>
      <mesh position={[0, -0.08, 0]}>
        <cylinderGeometry args={[0.072, 0.088, 0.016, 8]} />
        {xray ? <meshBasicMaterial color={color} wireframe />
               : <Solid color={color} metalness={0.78} roughness={0.22} />}
      </mesh>
    </group>
  )
}

// ── Foot cradle (follows rocker end B) ────────────────────────────────────────
// cradleRef points to a group; position+rotation updated imperatively each frame.
function FootCradleGeom({ cradleRef, xray }) {
  return (
    <group ref={cradleRef}>
      {/* Main plate */}
      <mesh position={[0, 0.06, 0.012]}>
        <boxGeometry args={[0.175, 0.10, 0.020]} />
        {xray ? <meshBasicMaterial color="#141c22" wireframe />
               : <Solid {...MAT.foot} />}
      </mesh>
      {/* Left side wall */}
      <mesh position={[-0.096, 0.08, 0.022]}>
        <boxGeometry args={[0.013, 0.135, 0.016]} />
        {xray ? <meshBasicMaterial color="#1c2430" wireframe />
               : <Solid color="#1c2430" metalness={0.85} roughness={0.22} />}
      </mesh>
      {/* Right side wall */}
      <mesh position={[0.096, 0.08, 0.022]}>
        <boxGeometry args={[0.013, 0.135, 0.016]} />
        {xray ? <meshBasicMaterial color="#1c2430" wireframe />
               : <Solid color="#1c2430" metalness={0.85} roughness={0.22} />}
      </mesh>
      {/* Ankle strap */}
      <mesh position={[0, 0.105, 0.016]} rotation={[Math.PI/2, 0, 0]}>
        <torusGeometry args={[0.065, 0.009, 8, 24, Math.PI * 1.6]} />
        {xray ? <meshBasicMaterial color="#1a2840" wireframe />
               : <Solid {...MAT.strap} />}
      </mesh>
      {/* Pad (soft black foam look) */}
      <mesh position={[0, 0.060, 0.024]}>
        <boxGeometry args={[0.150, 0.072, 0.010]} />
        {xray ? <meshBasicMaterial color="#080c10" wireframe />
               : <Solid color="#080c10" roughness={0.92} metalness={0.02} />}
      </mesh>
    </group>
  )
}

// ── Thigh support cradle (static, near O4) ────────────────────────────────────
function ThighCradle({ x, y, z, xray }) {
  return (
    <group position={[x, y, z]}>
      {/* U-shaped cradle */}
      <mesh position={[0, 0.035, 0]}>
        <boxGeometry args={[0.200, 0.055, 0.014]} />
        {xray ? <meshBasicMaterial color="#141c22" wireframe />
               : <Solid {...MAT.foot} />}
      </mesh>
      <mesh position={[-0.108, 0.068, 0]}>
        <boxGeometry args={[0.014, 0.120, 0.014]} />
        {xray ? <meshBasicMaterial color="#1c2430" wireframe />
               : <Solid color="#1c2430" metalness={0.85} roughness={0.22} />}
      </mesh>
      <mesh position={[0.108, 0.068, 0]}>
        <boxGeometry args={[0.014, 0.120, 0.014]} />
        {xray ? <meshBasicMaterial color="#1c2430" wireframe />
               : <Solid color="#1c2430" metalness={0.85} roughness={0.22} />}
      </mesh>
    </group>
  )
}

// ── Animated 3D scene ──────────────────────────────────────────────────────────
function AnimatedScene({ mechanism, playingRef, speedRef, xray, showLeg, showCurve, onFrame, romStart, romEnd }) {
  // Dynamic link mesh refs
  const crankRef    = useRef()
  const couplerRef  = useRef()
  const rockerRef   = useRef()
  // Dynamic pivot refs
  const pivARef     = useRef()
  const pivBRef     = useRef()
  // Motor spinning disc ref
  const motorDiscRef = useRef()
  // Foot cradle group ref
  const cradleRef   = useRef()
  // Leg refs
  const femurRef    = useRef()
  const tibiaRef    = useRef()
  const kneeRef     = useRef()
  const ankleRef    = useRef()

  const angleRef = useRef(0)
  const frameN   = useRef(0)

  const {
    L1 = 200, L2 = 80, L3 = 180, L4 = 160,
    O2 = { x:0, y:0 }, O4: _O4,
  } = mechanism || {}
  const O4 = _O4 || { x: L1, y: 0 }

  // Fixed world positions of the two ground pivots
  const pO2 = useMemo(() => new THREE.Vector3(O2.x * S, O2.y * S, 0), [O2.x, O2.y])
  const pO4 = useMemo(() => new THREE.Vector3(O4.x * S, O4.y * S, 0), [O4.x, O4.y])

  // Anatomical positions ──────────────────────────────────────────────────────
  // Patient lies supine; femur runs roughly horizontal (along X).
  // O4 ≈ knee pivot; B (rocker tip) ≈ ankle / foot cradle attachment.
  // Hip is to the LEFT of O2 (head end of bed), knee is at O4 (right).
  const LEG_Z       = 0.068                  // leg floats slightly in front (Z) of mechanism
  const LEG_Y_OFF   = 0.040                  // leg sits above the mechanism rail
  const femurLength = L1 * S * 0.78          // approximate anatomical femur length

  const hipPos   = useMemo(() => new THREE.Vector3(
    O2.x * S - femurLength,
    O4.y * S + LEG_Y_OFF,
    LEG_Z,
  ), [O2.x, O4.y, femurLength])  // eslint-disable-line

  const kneePosV = useMemo(() => new THREE.Vector3(
    O4.x * S,
    O4.y * S + LEG_Y_OFF,
    LEG_Z,
  ), [O4.x, O4.y])  // eslint-disable-line

  // Position femur once (it's static — both hip and knee are fixed)
  useEffect(() => {
    if (femurRef.current) setBar(femurRef.current, hipPos, kneePosV)
  }, [hipPos, kneePosV])

  // ── Full-cycle coupler midpoint curve ─────────────────────────────────────
  const curvePts = useMemo(() => {
    if (!mechanism?.L1) return []
    const pts = []
    for (let a = 0; a <= 362; a += 2) {
      const fk = forwardKinematicsRaw(a * DEG, L1, L2, L3, L4, O2, O4)
      if (fk) pts.push([
        (fk.A.x + fk.B.x) / 2 * S,
        (fk.A.y + fk.B.y) / 2 * S,
        0.020,
      ])
    }
    return pts
  }, [mechanism]) // eslint-disable-line

  // ── Animation frame ───────────────────────────────────────────────────────
  useFrame((_, dt) => {
    if (!mechanism?.L1) return
    if (playingRef.current)
      angleRef.current = (angleRef.current + dt * 60 * speedRef.current) % 360

    const fk = forwardKinematicsRaw(angleRef.current * DEG, L1, L2, L3, L4, O2, O4)
    if (!fk) return

    const pA = new THREE.Vector3(fk.A.x * S, fk.A.y * S, 0)
    const pB = new THREE.Vector3(fk.B.x * S, fk.B.y * S, 0)

    // ── Links ────────────────────────────────────────────────────────────────
    setBar(crankRef.current,   pO2, pA)
    setBar(couplerRef.current, pA,  pB)
    setBar(rockerRef.current,  pO4, pB)

    // ── Moving pivots ─────────────────────────────────────────────────────────
    if (pivARef.current) pivARef.current.position.copy(pA)
    if (pivBRef.current) pivBRef.current.position.copy(pB)

    // ── Motor disc rotates with crank ─────────────────────────────────────────
    if (motorDiscRef.current) {
      motorDiscRef.current.rotation.z = angleRef.current * DEG
    }

    // ── Foot cradle follows rocker tip B ──────────────────────────────────────
    if (cradleRef.current) {
      cradleRef.current.position.copy(pB)
      const dir = pB.clone().sub(pO4)
      cradleRef.current.rotation.z = Math.atan2(dir.y, dir.x) - Math.PI / 2
    }

    // ── Leg (tibia follows rocker motion) ─────────────────────────────────────
    if (showLeg) {
      const anklePos = new THREE.Vector3(pB.x, pB.y + LEG_Y_OFF, LEG_Z)
      setBar(tibiaRef.current, kneePosV, anklePos)
      if (kneeRef.current)  kneeRef.current.position.copy(kneePosV)
      if (ankleRef.current) ankleRef.current.position.copy(anklePos)
    }

    frameN.current++
    if (frameN.current % 4 === 0 && onFrame) onFrame(angleRef.current, fk)
  })

  if (!mechanism?.L1) return null

  return (
    <group>

      {/* ══ MACHINE BASE ══════════════════════════════════════════════════════ */}

      {/* Machine I-beam rail */}
      <MachineRail pO2={pO2} pO4={pO4} xray={xray} />

      {/* Hatch marks (ground symbol) */}
      <HatchMarks pO2={pO2} pO4={pO4} />

      {/* Vertical support legs under the two pivots */}
      <SupportLeg x={pO2.x} y={pO2.y} xray={xray} />
      <SupportLeg x={pO4.x} y={pO4.y} xray={xray} />

      {/* ══ MOTOR UNIT ════════════════════════════════════════════════════════ */}

      <MotorHousing x={pO2.x} y={pO2.y} xray={xray} />

      {/* Motor output disc (rotates with crank) — driven by motorDiscRef */}
      <group ref={motorDiscRef} position={[pO2.x, pO2.y + 0.008, 0.030]}>
        <mesh>
          <cylinderGeometry args={[0.040, 0.040, 0.014, 18]} />
          {xray ? <meshBasicMaterial color="#7b2fbe" wireframe />
                 : <meshStandardMaterial color="#7b2fbe" emissive="#7b2fbe"
                     emissiveIntensity={0.30} metalness={0.65} roughness={0.28} />}
        </mesh>
        {/* Indicator dot so rotation is visible */}
        <mesh position={[0.026, 0, 0.010]}>
          <sphereGeometry args={[0.007, 8, 8]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      </group>

      {/* ══ LINKAGE BARS ══════════════════════════════════════════════════════ */}

      {/* Crank — red anodised aluminium round tube */}
      <TubeLink meshRef={crankRef}   color="#c0392b" emissive="#3d0a0a" r={0.026} xray={xray} />

      {/* Coupler — dark brushed aluminium round tube */}
      <TubeLink meshRef={couplerRef} color="#546e7a" emissive="#080f18" r={0.022} xray={xray} />

      {/* Rocker — green anodised round tube */}
      <TubeLink meshRef={rockerRef}  color="#1b7a3e" emissive="#0a1e0c" r={0.026} xray={xray} />

      {/* ══ PIVOT JOINTS ══════════════════════════════════════════════════════ */}

      {/* O2 — crank pivot (red chrome) */}
      <PivotBall pos={pO2.toArray()} r={0.055} color="#c0392b" xray={xray} />
      {/* O4 — rocker pivot (green chrome) */}
      <PivotBall pos={pO4.toArray()} r={0.055} color="#1b7a3e" xray={xray} />
      {/* A — moving pin (white chrome) */}
      <PivotBall meshRef={pivARef} pos={[0,0,0]} r={0.040} color="#cfd8dc" xray={xray} />
      {/* B — moving pin (white chrome) */}
      <PivotBall meshRef={pivBRef} pos={[0,0,0]} r={0.040} color="#cfd8dc" xray={xray} />

      {/* Ground pins under fixed pivots */}
      <GroundPin pos={[pO2.x, pO2.y - 0.095, 0.010]} color="#2c3038" xray={xray} />
      <GroundPin pos={[pO4.x, pO4.y - 0.095, 0.010]} color="#2c3038" xray={xray} />

      {/* ══ FOOT CRADLE ═══════════════════════════════════════════════════════ */}

      <FootCradleGeom cradleRef={cradleRef} xray={xray} />

      {/* ══ LEG MODEL ════════════════════════════════════════════════════════ */}

      {showLeg && (
        <group>

          {/* Thigh support cradle mounted near O4 */}
          <ThighCradle
            x={pO4.x - L1 * S * 0.30}
            y={pO4.y + 0.010}
            z={0.060}
            xray={xray}
          />

          {/* ── Femur (thigh) — static, from hip to knee ── */}
          <mesh ref={femurRef}>
            <cylinderGeometry args={[0.038, 0.034, 1, 16]} />
            {xray ? <meshBasicMaterial color="#22c55e" wireframe />
                   : <meshStandardMaterial color="#e0b896" roughness={0.66} metalness={0.02} />}
          </mesh>

          {/* Hip joint sphere */}
          <mesh position={hipPos.toArray()}>
            <sphereGeometry args={[0.040, 14, 14]} />
            {xray ? <meshBasicMaterial color="#22c55e" wireframe />
                   : <meshStandardMaterial color="#c9a07c" roughness={0.58} metalness={0.03} />}
          </mesh>

          {/* Thigh strap 1 (at 30% along femur) */}
          <mesh position={[
            hipPos.x + (kneePosV.x - hipPos.x) * 0.30,
            hipPos.y + (kneePosV.y - hipPos.y) * 0.30,
            LEG_Z,
          ]} rotation={[Math.PI/2, 0,
            Math.atan2(kneePosV.y - hipPos.y, kneePosV.x - hipPos.x)
          ]}>
            <torusGeometry args={[0.042, 0.010, 8, 24]} />
            {xray ? <meshBasicMaterial color="#1a2840" wireframe />
                   : <meshStandardMaterial {...MAT.strap} />}
          </mesh>

          {/* Thigh strap 2 (at 65% along femur) */}
          <mesh position={[
            hipPos.x + (kneePosV.x - hipPos.x) * 0.65,
            hipPos.y + (kneePosV.y - hipPos.y) * 0.65,
            LEG_Z,
          ]} rotation={[Math.PI/2, 0,
            Math.atan2(kneePosV.y - hipPos.y, kneePosV.x - hipPos.x)
          ]}>
            <torusGeometry args={[0.040, 0.010, 8, 24]} />
            {xray ? <meshBasicMaterial color="#1a2840" wireframe />
                   : <meshStandardMaterial {...MAT.strap} />}
          </mesh>

          {/* ── Tibia (lower leg) — dynamic, knee → ankle ── */}
          <mesh ref={tibiaRef}>
            <cylinderGeometry args={[0.030, 0.025, 1, 16]} />
            {xray ? <meshBasicMaterial color="#22c55e" wireframe />
                   : <meshStandardMaterial color="#d8c0a4" roughness={0.66} metalness={0.02} />}
          </mesh>

          {/* ── Knee joint sphere (positioned in useFrame) ── */}
          <mesh ref={kneeRef}>
            <sphereGeometry args={[0.052, 18, 18]} />
            {xray ? <meshBasicMaterial color="#22c55e" wireframe />
                   : <meshStandardMaterial color="#c8aa8c" roughness={0.52} metalness={0.04} />}
          </mesh>

          {/* ── Ankle joint sphere (positioned in useFrame) ── */}
          <mesh ref={ankleRef}>
            <sphereGeometry args={[0.034, 14, 14]} />
            {xray ? <meshBasicMaterial color="#22c55e" wireframe />
                   : <meshStandardMaterial color="#c0a088" roughness={0.55} metalness={0.04} />}
          </mesh>

        </group>
      )}

      {/* ══ COUPLER CURVE ════════════════════════════════════════════════════ */}

      {showCurve && curvePts.length > 3 && (
        <Line
          points={curvePts}
          color="#ff6b35"
          lineWidth={2.2}
          transparent
          opacity={0.52}
        />
      )}

      {/* ══ ROM ARC (on rocker pivot O4) ════════════════════════════════════ */}
      <mesh position={pO4.toArray()} rotation={[0, 0, romStart * DEG - Math.PI / 2]}>
        <torusGeometry args={[0.68, 0.009, 8, 64, (romEnd - romStart) * DEG]} />
        <meshBasicMaterial color="#1b7a3e" transparent opacity={0.32} />
      </mesh>

    </group>
  )
}

// ── Floor grid ────────────────────────────────────────────────────────────────
function FloorGrid({ cx }) {
  const grid = useMemo(() => new THREE.GridHelper(14, 56, '#111820', '#0c1016'), [])
  return <primitive object={grid} position={[cx, -0.20, 0]} />
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function MotionSimulator3D() {
  const mechanism   = useMechanismStore(s => s.mechanism)
  const patientData = useMechanismStore(s => s.patientData)

  const [playing,   setPlaying]   = useState(true)
  const [speed,     setSpeed]     = useState(1)
  const [xray,      setXray]      = useState(false)
  const [showLeg,   setShowLeg]   = useState(true)
  const [showCurve, setShowCurve] = useState(true)
  const [liveAngle, setLiveAngle] = useState(0)
  const [liveFk,    setLiveFk]    = useState(null)
  const [camPreset, setCamPreset] = useState(null)
  const [activeCam, setActiveCam] = useState('iso')

  const playingRef  = useRef(true)
  const speedRef    = useRef(1)
  const controlsRef = useRef()

  useEffect(() => { playingRef.current = playing }, [playing])
  useEffect(() => { speedRef.current   = speed   }, [speed])

  const handleFrame = useCallback((angle, fk) => {
    setLiveAngle(Math.round(angle))
    setLiveFk(fk)
  }, [])

  const { L1 = 200, O2 = { x:0, y:0 }, O4: _O4 } = mechanism || {}
  const O4 = _O4 || { x: L1, y: 0 }
  const cx  = ((O2.x + O4.x) / 2) * S
  const cy  = 0.30

  const presets = useMemo(() => ({
    iso:   { pos: [cx + 2.4, cy + 1.8, 4.0], tgt: [cx, cy - 0.05, 0] },
    side:  { pos: [cx,       cy + 0.1, 4.5], tgt: [cx, cy + 0.15,  0] },
    top:   { pos: [cx,       cy + 5.0, 0.1], tgt: [cx, cy,         0] },
    front: { pos: [cx + 0.1, cy + 0.2, 4.5], tgt: [cx, cy + 0.2,   0] },
  }), [cx, cy])

  function selectCam(key) {
    setActiveCam(key)
    setCamPreset(presets[key])
  }

  const theta4Deg = liveFk ? (liveFk.theta4 / DEG).toFixed(1) : '--'

  return (
    <div style={{ position:'relative', width:'100%', height:'100%',
      background:'#060810', fontFamily:'Consolas,monospace', userSelect:'none' }}>

      <ThreeErrorBoundary>
        <Canvas
          camera={{ position: [cx + 2.4, cy + 1.8, 4.0], fov: 42, near: 0.01, far: 60 }}
          gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.2 }}
          shadows
        >
          <color attach="background" args={['#060810']} />
          <fog   attach="fog"        args={['#060810', 12, 26]} />

          {/* ── Studio-quality lighting ── */}
          <ambientLight intensity={0.18} color="#c0ccee" />
          {/* Key light (main) */}
          <directionalLight
            position={[6, 8, 5]} intensity={1.8}
            color="#fff8f0" castShadow
            shadow-mapSize-width={2048} shadow-mapSize-height={2048}
          />
          {/* Fill light (blue-cool) */}
          <directionalLight position={[-5, 3, -4]} intensity={0.50} color="#3050c0" />
          {/* Rim light (back highlight) */}
          <directionalLight position={[0, -2, -6]} intensity={0.30} color="#80a0ff" />
          {/* Mechanism accent point lights */}
          <pointLight position={[cx + 0.6, 1.2, 1.8]} intensity={1.4} color="#ff8840" distance={6} decay={2} />
          <pointLight position={[cx - 0.4, 0.6, 1.2]} intensity={0.40} color="#2040a0" distance={5} decay={2} />
          {/* Motor accent */}
          <pointLight position={[O2.x * S, O2.y * S + 0.3, 0.5]} intensity={0.60} color="#9b59b6" distance={2} decay={2} />

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
            target={[cx, cy, 0]}
            enableDamping
            dampingFactor={0.06}
            minDistance={0.5}
            maxDistance={18}
            makeDefault
          />

          <CameraSync preset={camPreset} controlsRef={controlsRef} />
        </Canvas>
      </ThreeErrorBoundary>

      {/* ── Top-left info panel ───────────────────────────────────────── */}
      <div style={{
        position:'absolute', top:14, left:14, pointerEvents:'none',
        background:'rgba(5,7,14,0.90)', border:'1px solid #141c2c',
        borderRadius:10, padding:'10px 16px', minWidth:188,
        backdropFilter:'blur(6px)',
      }}>
        <div style={{ color:'#3a60c0', fontSize:9, fontWeight:800,
          letterSpacing:'0.18em', textTransform:'uppercase', marginBottom:7 }}>
          CPM Motion Simulator
        </div>
        {mechanism?.L1 ? (
          <table style={{ borderSpacing:'0 2px', fontSize:11 }}>
            <tbody>
              <DataRow label="θ₂ (crank)"   val={`${liveAngle}°`}                   color="#c0392b" />
              <DataRow label="θ₄ (rocker)"  val={`${theta4Deg}°`}                   color="#1b7a3e" />
              <DataRow label="L1 ground"    val={`${mechanism.L1?.toFixed(0)} mm`}  color="#546e7a" />
              <DataRow label="L2 crank"     val={`${mechanism.L2?.toFixed(0)} mm`}  color="#c0392b" />
              <DataRow label="L3 coupler"   val={`${mechanism.L3?.toFixed(0)} mm`}  color="#546e7a" />
              <DataRow label="L4 rocker"    val={`${mechanism.L4?.toFixed(0)} mm`}  color="#1b7a3e" />
              <DataRow label="μ min"        val={`${(mechanism.minMu ?? 0).toFixed(1)}°`} color="#f39c12" />
            </tbody>
          </table>
        ) : (
          <div style={{ color:'#333', fontSize:11 }}>No mechanism loaded</div>
        )}
      </div>

      {/* ── Top-right ROM panel ───────────────────────────────────────── */}
      <div style={{
        position:'absolute', top:14, right:14, pointerEvents:'none',
        background:'rgba(5,7,14,0.90)', border:'1px solid #141c2c',
        borderRadius:10, padding:'10px 16px', minWidth:168,
        backdropFilter:'blur(6px)',
      }}>
        <div style={{ color:'#3a60c0', fontSize:9, fontWeight:800,
          letterSpacing:'0.18em', textTransform:'uppercase', marginBottom:8 }}>
          ROM Safety
        </div>
        <div style={{ color:'#3a6a4a', fontSize:11, marginBottom:5, fontWeight:700 }}>
          {patientData?.romStart ?? 0}°
          <span style={{ color:'#2a3a4a', margin:'0 6px' }}>→</span>
          {patientData?.romEnd ?? 120}°
        </div>
        <div style={{ height:5, width:'100%', background:'#0e1420', borderRadius:3, overflow:'hidden' }}>
          <div style={{
            height:'100%', borderRadius:3,
            width:`${(((patientData?.romEnd ?? 120) - (patientData?.romStart ?? 0)) / 130) * 100}%`,
            background:'linear-gradient(90deg, #1b7a3e, #2ecc71)',
          }} />
        </div>
        <div style={{ marginTop:6, color:'#3a6a4a', fontSize:10 }}>
          {patientData?.injury || 'Knee Rehabilitation'}
        </div>
      </div>

      {/* ── Bottom controls bar ───────────────────────────────────────── */}
      <div style={{
        position:'absolute', bottom:0, left:0, right:0,
        background:'rgba(5,7,14,0.94)', borderTop:'1px solid #10181e',
        display:'flex', alignItems:'center', gap:10, padding:'8px 16px', flexWrap:'wrap',
      }}>
        {/* Play / Pause */}
        <button onClick={() => setPlaying(v => !v)} style={btnStyle(playing, '#c0392b')}>
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>

        {/* Speed selector */}
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ color:'#2a3a4a', fontSize:10, fontWeight:700 }}>SPD</span>
          {[0.25, 0.5, 1, 2, 3].map(s => (
            <button key={s} onClick={() => setSpeed(s)} style={btnStyle(speed === s, '#2980b9')}>
              {s}×
            </button>
          ))}
        </div>

        <div style={{ width:1, height:24, background:'#10181e', margin:'0 2px' }} />

        {/* Camera presets */}
        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
          <span style={{ color:'#2a3a4a', fontSize:10, fontWeight:700 }}>CAM</span>
          {[['iso','ISO'],['side','SIDE'],['top','TOP'],['front','FRNT']].map(([k,l]) => (
            <button key={k} onClick={() => selectCam(k)} style={btnStyle(activeCam === k, '#2c3e50')}>{l}</button>
          ))}
        </div>

        <div style={{ width:1, height:24, background:'#10181e', margin:'0 2px' }} />

        {/* View toggles */}
        <button onClick={() => setXray(v => !v)}      style={btnStyle(xray,      '#7b2fbe')}>X-RAY</button>
        <button onClick={() => setShowLeg(v => !v)}   style={btnStyle(showLeg,   '#16a085')}>LEG</button>
        <button onClick={() => setShowCurve(v => !v)} style={btnStyle(showCurve, '#e67e22')}>CURVE</button>

        {/* Legend */}
        <div style={{ marginLeft:'auto', display:'flex', gap:14, pointerEvents:'none' }}>
          {[
            ['#c0392b', 'Crank'],
            ['#546e7a', 'Coupler'],
            ['#1b7a3e', 'Rocker'],
            ['#e0b896', 'Leg'],
            ['#ff6b35', 'Coupler Curve'],
          ].map(([c, l]) => (
            <div key={l} style={{ display:'flex', alignItems:'center', gap:5 }}>
              <div style={{ width:10, height:10, borderRadius:'50%', background:c, flexShrink:0 }} />
              <span style={{ color:'#2a3a4a', fontSize:9, fontWeight:700, letterSpacing:'0.08em' }}>{l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Orbit hint ─────────────────────────────────────────────────── */}
      <div style={{
        position:'absolute', bottom:50, left:'50%', transform:'translateX(-50%)',
        color:'#141c24', fontSize:9, letterSpacing:'0.12em',
        pointerEvents:'none', fontWeight:700,
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
      <td style={{ color:'#1c2a3a', fontSize:10, fontWeight:700,
        paddingRight:12, letterSpacing:'0.08em', textTransform:'uppercase' }}>
        {label}
      </td>
      <td style={{ color, fontWeight:800, fontSize:12, fontFamily:'Consolas,monospace' }}>
        {val}
      </td>
    </tr>
  )
}

function btnStyle(active, activeColor) {
  return {
    background: active ? activeColor : 'rgba(255,255,255,0.02)',
    border: `1px solid ${active ? activeColor : '#141c24'}`,
    borderRadius: 6,
    padding: '5px 11px',
    color: active ? '#fff' : '#2a3a4a',
    fontWeight: 800,
    fontSize: 10,
    cursor: 'pointer',
    letterSpacing: '0.08em',
    fontFamily: 'Consolas,monospace',
    transition: 'all 0.14s',
  }
}
