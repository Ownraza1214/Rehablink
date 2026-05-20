import {
  burmesterSynthesis,
  grashofCheck,
  transmissionAngle,
  computeRMSError,
  optimizeMechanism,
  chebyshevSpacing,
  forwardKinematicsRaw,
} from './synthesis.js'

const DEG = Math.PI / 180

export function runHeuristicSearch(patientData, onProgress) {
  const { romStart, romEnd, usesChebyshev } = patientData
  const n = 3

  // Generate Chebyshev-spaced precision points
  const thetaIns = chebyshevSpacing(n, 0, 270)
  const thetaOuts = chebyshevSpacing(n, romStart, romEnd)
  const precisionPoints = thetaIns.map((ti, i) => ({
    theta_in: ti,
    theta_out: thetaOuts[i],
  }))

  const dValues = []
  for (let d = 50; d <= 300; d += 25) dValues.push(d)
  const angleOffsets = []
  for (let a = -30; a <= 30; a += 5) angleOffsets.push(a)

  const candidates = []

  let count = 0
  const total = dValues.length * angleOffsets.length

  for (const d of dValues) {
    for (const ao of angleOffsets) {
      try {
        const synth = burmesterSynthesis(precisionPoints, { d, angleOffset: ao })
        const { L1, L2, L3, L4, O2, O4 } = synth
        const grashof = grashofCheck(L1, L2, L3, L4)

        // Check min transmission angle over all crank positions
        let minMu = 180
        let validKinematics = true
        for (let t = 0; t <= 360; t += 5) {
          const fk = forwardKinematicsRaw(t * DEG, L1, L2, L3, L4, O2, O4)
          if (!fk) { validKinematics = false; break }
          const mu = computeTransmissionAngleDirect(fk.theta3, fk.theta4)
          minMu = Math.min(minMu, mu)
        }

        const mechanism = { ...synth, O4 }
        const { rmsError, accuracyScore } = computeRMSError(
          mechanism, precisionPoints, romStart, romEnd
        )

        candidates.push({
          ...synth,
          grashof,
          minMu,
          rmsError,
          accuracyScore,
          validKinematics,
          d,
          ao,
          precisionPoints,
        })
      } catch (e) {
        // skip invalid
      }

      count++
      if (onProgress) onProgress(count / total)
    }
  }

  // Filter valid candidates
  const valid = candidates.filter(
    c => c.grashof.passes && c.validKinematics && c.minMu > 30
  )

  // Sort by accuracy
  valid.sort((a, b) => b.accuracyScore - a.accuracyScore)

  return { candidates, valid, precisionPoints }
}

export function runGradientRefinement(validCandidates, precisionPoints, romStart, romEnd) {
  const top10 = validCandidates.slice(0, 10)
  const refined = top10.map(c => {
    const result = optimizeMechanism(c, precisionPoints, romStart, romEnd)
    result.grashof = grashofCheck(result.L1, result.L2, result.L3, result.L4)
    result.precisionPoints = precisionPoints
    return result
  })

  refined.sort((a, b) => b.accuracyScore - a.accuracyScore)

  // Compute minMu for each refined solution
  const withMu = refined.map(sol => {
    let minMu = 180
    const O2 = sol.O2 || { x: 0, y: 0 }
    const O4 = sol.O4 || { x: sol.L1, y: 0 }
    for (let t = 0; t <= 360; t += 5) {
      const fk = forwardKinematicsRaw(t * DEG, sol.L1, sol.L2, sol.L3, sol.L4, O2, O4)
      if (fk) {
        const mu = computeTransmissionAngleDirect(fk.theta3, fk.theta4)
        minMu = Math.min(minMu, mu)
      }
    }
    return { ...sol, minMu }
  })

  return withMu
}

function computeTransmissionAngleDirect(theta3, theta4) {
  const mu = Math.abs(theta3 - theta4) % Math.PI
  return Math.min(mu, Math.PI - mu) * (180 / Math.PI)
}

