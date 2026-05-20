import { forwardKinematicsRaw, velocityAnalysis, accelerationAnalysis } from './synthesis.js'

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

const DENSITY = 0.5 // kg/m -> mass per meter of link

export function computeForces(theta2deg, omega2, alpha2, mechanism) {
  const { L1, L2, L3, L4, O2, O4 } = mechanism
  const theta2 = theta2deg * DEG

  const fk  = forwardKinematicsRaw(theta2, L1, L2, L3, L4, O2, O4)
  if (!fk) return null
  const vel = velocityAnalysis(theta2deg, omega2, L1, L2, L3, L4, O2, O4)
  const acc = accelerationAnalysis(theta2deg, omega2, alpha2, L1, L2, L3, L4, O2, O4)
  if (!vel || !acc) return null

  const m2 = (L2 / 1000) * DENSITY
  const m3 = (L3 / 1000) * DENSITY
  const m4 = (L4 / 1000) * DENSITY

  // CG accelerations (mid-link)
  const acc_cg3_x = (acc.AA.x + acc.AB.x) / 2
  const acc_cg3_y = (acc.AA.y + acc.AB.y) / 2

  // Inertia forces on link 3
  const F3x = -m3 * acc_cg3_x
  const F3y = -m3 * acc_cg3_y

  // Input torque (simplified: T = F_out / MA)
  const mu = computeTransmissionAngleDirect(fk.theta3, fk.theta4)
  const MA = Math.abs(Math.sin(mu))

  const F_output = 50 // N  -  typical CPM load
  const F_input  = MA > 0.01 ? F_output / MA : F_output * 10

  // Torque at crank
  const T_crank = F_input * (L2 / 1000) * Math.sin(mu)

  // Joint reactions (simplified static analysis)
  const R_O2 = { x: -F_input * Math.cos(theta2), y: -F_input * Math.sin(theta2) }
  const R_O4 = { x: F_output * Math.cos(fk.theta4), y: F_output * Math.sin(fk.theta4) }
  const R_A  = { x: F3x / 2, y: F3y / 2 }
  const R_B  = { x: F3x / 2 + F_output, y: F3y / 2 }

  // Shaking force = sum of all ground reactions
  const shaking = {
    x: R_O2.x + R_O4.x,
    y: R_O2.y + R_O4.y,
  }

  // Motor power
  const motorPower = Math.abs(T_crank * omega2)

  return {
    T_crank,
    MA,
    F_input,
    F_output,
    R_O2, R_O4, R_A, R_B,
    shaking,
    motorPower,
    mu: mu * RAD,
    ...fk,
  }
}

function computeTransmissionAngleDirect(theta3, theta4) {
  const mu = Math.abs(theta3 - theta4) % Math.PI
  return Math.min(mu, Math.PI - mu)
}

export function computeTorqueSeries(mechanism, omega2 = 10, steps = 360) {
  const series = []
  for (let i = 0; i <= steps; i++) {
    const theta2 = (i / steps) * 360
    const f = computeForces(theta2, omega2, 0, mechanism)
    series.push({
      theta2,
      torque: f ? f.T_crank : 0,
      MA: f ? f.MA : 0,
      power: f ? f.motorPower : 0,
    })
  }
  return series
}

export function computePeakTorque(torqueSeries) {
  return Math.max(...torqueSeries.map(p => Math.abs(p.torque)))
}

export function computeAvgMA(torqueSeries) {
  const valid = torqueSeries.filter(p => p.MA > 0)
  if (!valid.length) return 0
  return valid.reduce((s, p) => s + p.MA, 0) / valid.length
}

export function recommendedMotorPower(torqueSeries) {
  return Math.max(...torqueSeries.map(p => p.power))
}

