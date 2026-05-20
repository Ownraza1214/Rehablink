// ============================================================
// RehabLink Math Engine  -  Burmester Four-Bar Synthesis
// ============================================================

const TWO_PI = 2 * Math.PI
const DEG = Math.PI / 180
const RAD = 180 / Math.PI

// â"€â"€ 1. Chebyshev precision-point spacing â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
export function chebyshevSpacing(n, thetaStart, thetaEnd) {
  const pts = []
  for (let i = 1; i <= n; i++) {
    const theta =
      (thetaStart + thetaEnd) / 2 -
      ((thetaEnd - thetaStart) / 2) * Math.cos(((2 * i - 1) * Math.PI) / (2 * n))
    pts.push(theta)
  }
  return pts
}

// â"€â"€ 2. Burmester Synthesis â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
export function burmesterSynthesis(precisionPoints, options = {}) {
  const d = options.d || 150        // fixed pivot separation (mm)
  const angleOffset = options.angleOffset || 0  // crank angle offset (deg)

  if (precisionPoints.length < 2) {
    return fallbackMechanism(d, angleOffset)
  }

  // Map precision points to [theta_in, theta_out] pairs
  const pts = precisionPoints

  // Extract input and output angles
  const thetaIn  = pts.map(p => p.theta_in  * DEG)
  const thetaOut = pts.map(p => p.theta_out * DEG)

  // Use first and last for primary synthesis
  const psi1 = thetaIn[0]
  const psi2 = thetaIn[Math.floor(pts.length / 2)]
  const psi3 = thetaIn[pts.length - 1]
  const phi1 = thetaOut[0]
  const phi2 = thetaOut[Math.floor(pts.length / 2)]
  const phi3 = thetaOut[pts.length - 1]

  // O2 fixed at origin, O4 along x-axis
  const O2 = { x: 0, y: 0 }
  const O4 = { x: d, y: 0 }

  // Compute relative displacements
  const dpsi21 = psi2 - psi1
  const dpsi31 = psi3 - psi1
  const dphi21 = phi2 - phi1
  const dphi31 = phi3 - phi1

  // Analytical synthesis: find L2 from input angle range
  const inputRange  = Math.abs(psi3 - psi1)
  const outputRange = Math.abs(phi3 - phi1)

  // Fit Freudenstein for first and last precision points
  let L1 = d, L2 = d * 0.35 + angleOffset * 0.5, L3 = d * 0.8, L4 = d * 0.45

  if (pts.length >= 2) {
    const psiArr = [psi1, psi3]
    const phiArr = [phi1, phi3]
    const result = fitFreudenstein(psiArr, phiArr, d)
    if (result) {
      L1 = result.L1
      L2 = result.L2
      L3 = result.L3
      L4 = result.L4
    }
  }

  // Ensure positive lengths
  L1 = Math.max(50, L1)
  L2 = Math.max(20, L2)
  L3 = Math.max(30, L3)
  L4 = Math.max(30, L4)

  // Compute initial crank position (A0) and rocker position (B0)
  const theta2_0 = psi1 + angleOffset * DEG
  const fk = forwardKinematicsRaw(theta2_0, L1, L2, L3, L4, O2, O4)
  const A0 = fk ? fk.A : { x: L2, y: 0 }
  const B0 = fk ? fk.B : { x: L1 - L4, y: 0 }

  return { O2, O4, A0, B0, L1, L2, L3, L4, theta2_0 }
}

function fitFreudenstein(psiArr, phiArr, d) {
  // Freudenstein: K1*cos(phi) - K2*cos(psi) + K3 = cos(psi - phi)
  // K1 = d/L4, K2 = d/L2, K3 = (dÂ²+L2Â²-L3Â²+L4Â²)/(2*L2*L4)
  // Solve 3x3 linear system with 3 equations (use pairs)
  if (psiArr.length < 2) return null

  // Build equations: [cos(phi), -cos(psi), 1] [K1,K2,K3]' = cos(psi-phi)
  const eqs = psiArr.map((psi, i) => {
    const phi = phiArr[i]
    return {
      a: Math.cos(phi),
      b: -Math.cos(psi),
      c: 1,
      rhs: Math.cos(psi - phi),
    }
  })

  // With only 2 equations, add a naturalness constraint: K3 reasonable
  // We fix K3 = 0.5 and solve for K1, K2
  if (eqs.length === 2) {
    const K3 = 0.5
    // K1*cos(phi1) - K2*cos(psi1) = cos(psi1-phi1) - K3
    // K1*cos(phi2) - K2*cos(psi2) = cos(psi2-phi2) - K3
    const a11 = eqs[0].a, a12 = eqs[0].b, r1 = eqs[0].rhs - K3
    const a21 = eqs[1].a, a22 = eqs[1].b, r2 = eqs[1].rhs - K3
    const det = a11 * a22 - a12 * a21
    if (Math.abs(det) < 1e-10) return null
    const K1 = (r1 * a22 - r2 * a12) / det
    const K2 = (a11 * r2 - a21 * r1) / det
    if (K1 <= 0 || K2 <= 0) return null
    const L4 = d / K1
    const L2 = d / K2
    // K3 = (dÂ²+L2Â²-L3Â²+L4Â²)/(2*L2*L4)
    const L3sq = d * d + L2 * L2 + L4 * L4 - 2 * L2 * L4 * K3
    if (L3sq <= 0) return null
    const L3 = Math.sqrt(L3sq)
    const L1 = d
    return { L1, L2, L3, L4 }
  }
  return null
}

function fallbackMechanism(d, angleOffset) {
  const O2 = { x: 0, y: 0 }
  const O4 = { x: d, y: 0 }
  const L1 = d
  const L2 = d * 0.35
  const L3 = d * 0.80
  const L4 = d * 0.45
  const theta2_0 = 0
  const fk = forwardKinematicsRaw(theta2_0, L1, L2, L3, L4, O2, O4)
  const A0 = fk ? fk.A : { x: L2, y: 0 }
  const B0 = fk ? fk.B : { x: L1 - L4, y: 0 }
  return { O2, O4, A0, B0, L1, L2, L3, L4, theta2_0 }
}

// â"€â"€ 3. Grashof Check â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
export function grashofCheck(L1, L2, L3, L4) {
  const links = [L1, L2, L3, L4]
  const Lmax = Math.max(...links)
  const Lmin = Math.min(...links)
  const rest = links.filter((v, i) => v !== Lmax || i === links.indexOf(Lmax))
    .filter((v, i) => { links[i]; return true })
  const sumOthers = links.reduce((s, v) => s + v, 0) - Lmax

  const grashof = Lmin + Lmax <= sumOthers - Lmax + Lmin + (sumOthers - Lmin)
  // Simplified: S + L <= P + Q
  const S = Lmin
  const L = Lmax
  const P = links.filter(v => v !== S && v !== L)[0] || L3
  const Q = links.filter(v => v !== S && v !== L)[1] || L4

  const sum = S + L
  const pq  = P + Q
  const isGrashof = sum <= pq

  if (!isGrashof) return { type: 'non-Grashof', passes: false }

  if (sum === pq) return { type: 'change-point', passes: false }

  // Determine which link is shortest relative to ground
  const shortestIsGround   = L1 === S
  const shortestIsCrank    = L2 === S
  const shortestIsCoupler  = L3 === S
  const shortestIsFollower = L4 === S

  if (shortestIsGround)   return { type: 'double-crank', passes: false }
  if (shortestIsCrank)    return { type: 'crank-rocker', passes: true  }
  if (shortestIsCoupler)  return { type: 'double-rocker', passes: false }
  if (shortestIsFollower) return { type: 'crank-rocker', passes: true  }

  return { type: 'non-Grashof', passes: false }
}

// â"€â"€ 4. Transmission Angle â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
export function transmissionAngle(theta2, L1, L2, L3, L4) {
  const fk = forwardKinematicsRaw(theta2 * DEG, L1, L2, L3, L4,
    { x: 0, y: 0 }, { x: L1, y: 0 })
  if (!fk) return 90
  const { theta3, theta4 } = fk
  const mu = Math.abs(theta3 - theta4) % Math.PI
  return Math.min(mu, Math.PI - mu) * RAD
}

// â"€â"€ 5. Forward Kinematics (Newton-Raphson) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
export function forwardKinematics(theta2deg, L1, L2, L3, L4, O2, O4) {
  const theta2 = theta2deg * DEG
  const result = forwardKinematicsRaw(theta2, L1, L2, L3, L4, O2, O4)
  if (!result) return null
  return {
    ...result,
    theta3: result.theta3 * RAD,
    theta4: result.theta4 * RAD,
  }
}

export function forwardKinematicsRaw(theta2, L1, L2, L3, L4, O2, O4) {
  // Vector loop: L2*e^(iTheta2) + L3*e^(iTheta3) = L1*vec + L4*e^(iTheta4)
  // where L1 is along x: O4 - O2
  const dx = O4.x - O2.x
  const dy = O4.y - O2.y
  const d  = Math.sqrt(dx * dx + dy * dy)
  const psi = Math.atan2(dy, dx) // ground angle

  // Position of A (pin on crank)
  const Ax = O2.x + L2 * Math.cos(theta2)
  const Ay = O2.y + L2 * Math.sin(theta2)

  // Distance from A to O4
  const dAO4x = O4.x - Ax
  const dAO4y = O4.y - Ay
  const dAO4  = Math.sqrt(dAO4x * dAO4x + dAO4y * dAO4y)

  // Check reachability
  if (dAO4 > L3 + L4 || dAO4 < Math.abs(L3 - L4)) return null

  // Use cosine law to find theta4
  const cosTheta4top = (dAO4 * dAO4 + L4 * L4 - L3 * L3) / (2 * dAO4 * L4)
  const clampedCos   = Math.max(-1, Math.min(1, cosTheta4top))
  const beta         = Math.atan2(dAO4y, dAO4x)
  const gamma        = Math.acos(clampedCos)

  // Two assembly modes  -  open (positive) is standard for crank-rocker
  const theta4 = beta - gamma

  const Bx = O4.x + L4 * Math.cos(theta4)
  const By = O4.y + L4 * Math.sin(theta4)

  const theta3 = Math.atan2(By - Ay, Bx - Ax)

  return {
    A: { x: Ax, y: Ay },
    B: { x: Bx, y: By },
    theta3,
    theta4,
  }
}

// â"€â"€ 6. Velocity Analysis â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
export function velocityAnalysis(theta2deg, omega2, L1, L2, L3, L4, O2, O4) {
  const theta2 = theta2deg * DEG
  const fk = forwardKinematicsRaw(theta2, L1, L2, L3, L4, O2, O4)
  if (!fk) return null
  const { theta3, theta4 } = fk

  // [sin(Theta3)  -L4*sin(Theta4)] [w3]   [w2*L2*sin(Theta2)]
  // [-cos(Theta3)  L4*cos(Theta4)] [w4] = [w2*L2*cos(Theta2)]
  const a11 =  L3 * Math.sin(theta3)
  const a12 = -L4 * Math.sin(theta4)
  const a21 = -L3 * Math.cos(theta3)
  const a22 =  L4 * Math.cos(theta4)
  const r1  =  omega2 * L2 * Math.sin(theta2)
  const r2  = -omega2 * L2 * Math.cos(theta2)

  const det = a11 * a22 - a12 * a21
  if (Math.abs(det) < 1e-10) return null

  const omega3 = (r1 * a22 - r2 * a12) / det
  const omega4 = (a11 * r2 - a21 * r1) / det

  // Velocity of A
  const VAx = -omega2 * L2 * Math.sin(theta2)
  const VAy =  omega2 * L2 * Math.cos(theta2)

  // Velocity of B relative to A (VBA)
  const VBAx = -omega3 * L3 * Math.sin(theta3)
  const VBAy =  omega3 * L3 * Math.cos(theta3)

  // Velocity of B
  const VBx = VAx + VBAx
  const VBy = VAy + VBAy

  return {
    VA:  { x: VAx,  y: VAy  },
    VB:  { x: VBx,  y: VBy  },
    VBA: { x: VBAx, y: VBAy },
    omega3,
    omega4,
  }
}

// â"€â"€ 7. Acceleration Analysis â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
export function accelerationAnalysis(theta2deg, omega2, alpha2, L1, L2, L3, L4, O2, O4) {
  const theta2 = theta2deg * DEG
  const fk  = forwardKinematicsRaw(theta2, L1, L2, L3, L4, O2, O4)
  if (!fk) return null
  const { theta3, theta4 } = fk
  const vel = velocityAnalysis(theta2deg, omega2, L1, L2, L3, L4, O2, O4)
  if (!vel) return null
  const { omega3, omega4 } = vel

  // Normal acceleration components
  const AA_n = { x: -omega2 * omega2 * L2 * Math.cos(theta2), y: -omega2 * omega2 * L2 * Math.sin(theta2) }
  const AA_t = { x: -alpha2 * L2 * Math.sin(theta2), y:  alpha2 * L2 * Math.cos(theta2) }

  const AB_n_4 = { x: -omega4 * omega4 * L4 * Math.cos(theta4), y: -omega4 * omega4 * L4 * Math.sin(theta4) }
  const ABA_n  = { x: -omega3 * omega3 * L3 * Math.cos(theta3), y: -omega3 * omega3 * L3 * Math.sin(theta3) }

  // Build system: alpha3 and alpha4
  const a11 = -L3 * Math.sin(theta3)
  const a12 =  L4 * Math.sin(theta4)
  const a21 =  L3 * Math.cos(theta3)
  const a22 = -L4 * Math.cos(theta4)

  const r1 = AA_n.x + AA_t.x + ABA_n.x - AB_n_4.x
  const r2 = AA_n.y + AA_t.y + ABA_n.y - AB_n_4.y

  const det = a11 * a22 - a12 * a21
  if (Math.abs(det) < 1e-10) return null

  const alpha3 = (r1 * a22 - r2 * a12) / det
  const alpha4 = (a11 * r2 - a21 * r1) / det

  const AA = { x: AA_n.x + AA_t.x, y: AA_n.y + AA_t.y }
  const ABA = { x: ABA_n.x + (-alpha3 * L3 * Math.sin(theta3)), y: ABA_n.y + (alpha3 * L3 * Math.cos(theta3)) }
  const AB  = { x: AA.x + ABA.x, y: AA.y + ABA.y }

  return { AA, AB, ABA, alpha3, alpha4, AA_n, AA_t, ABA_n }
}

// â"€â"€ 8. RMS Error & Accuracy Score â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
export function computeRMSError(mechanism, precisionPoints, romStart, romEnd) {
  const { L1, L2, L3, L4, O2, O4 } = mechanism
  if (!precisionPoints || precisionPoints.length === 0) return { rmsError: 999, accuracyScore: 0 }

  const targetRange = romEnd - romStart
  const errors = []

  for (const pt of precisionPoints) {
    const theta2 = pt.theta_in
    const fk = forwardKinematicsRaw(theta2 * DEG, L1, L2, L3, L4, O2, O4)
    if (!fk) { errors.push(targetRange); continue }

    const actualOut = fk.theta4 * RAD
    // Normalize to same range as desired
    const desiredOut = pt.theta_out
    const err = Math.abs(actualOut - desiredOut)
    errors.push(err)
  }

  const rmsError = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length)
  const accuracyScore = Math.max(0, 100 - (rmsError / Math.max(targetRange, 1)) * 100)

  return { rmsError, accuracyScore }
}

// â"€â"€ 9. Optimizer â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
export function optimizeMechanism(initialSolution, precisionPoints, romStart, romEnd) {
  let best = { ...initialSolution }
  let { rmsError, accuracyScore } = computeRMSError(best, precisionPoints, romStart, romEnd)
  let bestScore = accuracyScore

  let stepSize = 0.1
  const fields = ['L1', 'L2', 'L3', 'L4']

  for (let iter = 0; iter < 500; iter++) {
    let improved = false
    for (const field of fields) {
      for (const sign of [1, -1]) {
        const candidate = { ...best }
        candidate[field] = Math.max(10, best[field] * (1 + sign * stepSize))
        // Recompute O4 if L1 changes
        if (field === 'L1') {
          candidate.O4 = { x: candidate.L1, y: 0 }
        }
        const res = computeRMSError(candidate, precisionPoints, romStart, romEnd)
        if (res.accuracyScore > bestScore) {
          best = candidate
          bestScore = res.accuracyScore
          rmsError = res.rmsError
          improved = true
        }
      }
    }
    stepSize *= 0.98
    if (bestScore >= 80 && iter > 50) break
  }

  const grashof = grashofCheck(best.L1, best.L2, best.L3, best.L4)
  return { ...best, accuracyScore: bestScore, rmsError, grashof }
}

// ── Exact 3-point Freudenstein synthesis ──────────────────────────────────────
// psiDeg3 : array of 3 absolute crank angles in degrees
// phiDeg3 : array of 3 absolute rocker angles in degrees
// d       : ground link length (= L1) in mm
// Returns { O2, O4, A0, B0, L1, L2, L3, L4, theta2_0 } or null
export function burmesterSynthesisExact(psiDeg3, phiDeg3, d) {
  if (psiDeg3.length < 3 || phiDeg3.length < 3) return null
  const psi = psiDeg3.map(p => p * DEG)
  const phi = phiDeg3.map(p => p * DEG)

  // Freudenstein: K1·cos(phi) − K2·cos(psi) + K3 = cos(psi − phi)
  const a = psi.map((ps, i) => [
    Math.cos(phi[i]), -Math.cos(ps), 1, Math.cos(ps - phi[i]),
  ])

  // Gaussian elimination with partial pivoting on 3×4 augmented matrix
  for (let col = 0; col < 3; col++) {
    let maxRow = col
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[maxRow][col])) maxRow = r
    }
    ;[a[col], a[maxRow]] = [a[maxRow], a[col]]
    if (Math.abs(a[col][col]) < 1e-10) return null
    for (let r = col + 1; r < 3; r++) {
      const f = a[r][col] / a[col][col]
      for (let j = col; j <= 3; j++) a[r][j] -= f * a[col][j]
    }
  }
  const K = [0, 0, 0]
  for (let i = 2; i >= 0; i--) {
    K[i] = a[i][3]
    for (let j = i + 1; j < 3; j++) K[i] -= a[i][j] * K[j]
    K[i] /= a[i][i]
  }
  const [K1, K2, K3] = K
  if (!isFinite(K1) || !isFinite(K2) || !isFinite(K3)) return null
  if (K1 < 0.01 || K2 < 0.01) return null

  const L1 = d
  const L4 = L1 / K1                                   // K1 = L1/L4
  const L2 = L1 / K2                                   // K2 = L1/L2
  const L3sq = L1*L1 + L2*L2 + L4*L4 - 2*K3*L2*L4    // from K3 definition
  if (L3sq <= 1) return null
  const L3 = Math.sqrt(L3sq)
  if (L2 < 8 || L3 < 8 || L4 < 8) return null
  if (L2 > 700 || L3 > 700 || L4 > 700) return null

  const O2 = { x: 0, y: 0 }
  const O4 = { x: d, y: 0 }
  const theta2_0 = psi[0]
  const fk = forwardKinematicsRaw(theta2_0, L1, L2, L3, L4, O2, O4)
  const A0 = fk ? fk.A : { x: L2, y: 0 }
  const B0 = fk ? fk.B : { x: L1 - L4, y: 0 }

  return { O2, O4, A0, B0, L1, L2, L3, L4, theta2_0 }
}

//â"€â"€ Instant Centers (Kennedy's Theorem) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
export function computeInstantCenters(theta2deg, L1, L2, L3, L4, O2, O4) {
  const fk = forwardKinematics(theta2deg, L1, L2, L3, L4, O2, O4)
  if (!fk) return null

  const I12 = { ...O2, label: 'I12' }
  const I14 = { ...O4, label: 'I14' }
  const I23 = { ...fk.A, label: 'I23' }
  const I34 = { ...fk.B, label: 'I34' }

  // I13 = intersection of line(I12, I23) and line(I14, I34)
  const I13 = lineIntersect(I12, I23, I14, I34)
  // I24 = intersection of line(I12, I14) and line(I23, I34)
  const I24 = lineIntersect(I12, I14, I23, I34)

  return {
    I12: { ...I12 },
    I13: I13 ? { ...I13, label: 'I13' } : null,
    I14: { ...I14 },
    I23: { ...I23 },
    I24: I24 ? { ...I24, label: 'I24' } : null,
    I34: { ...I34 },
  }
}

function lineIntersect(p1, p2, p3, p4) {
  const dx1 = p2.x - p1.x, dy1 = p2.y - p1.y
  const dx2 = p4.x - p3.x, dy2 = p4.y - p3.y
  const denom = dx1 * dy2 - dy1 * dx2
  if (Math.abs(denom) < 1e-8) return null
  const t = ((p3.x - p1.x) * dy2 - (p3.y - p1.y) * dx2) / denom
  return { x: p1.x + t * dx1, y: p1.y + t * dy1 }
}

// â"€â"€ Full coupler curve â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
export function computeCouplerCurve(L1, L2, L3, L4, O2, O4, steps = 360) {
  const pts = []
  for (let i = 0; i < steps; i++) {
    const theta2 = (i / steps) * TWO_PI
    const fk = forwardKinematicsRaw(theta2, L1, L2, L3, L4, O2, O4)
    if (fk) {
      // Coupler point P at midpoint of coupler link
      pts.push({
        x: (fk.A.x + fk.B.x) / 2,
        y: (fk.A.y + fk.B.y) / 2,
        A: fk.A, B: fk.B,
        theta2: theta2 * RAD,
        theta4: fk.theta4 * RAD,
      })
    }
  }
  return pts
}

