import { create } from 'zustand'

const DEFAULT_MECHANISM = {
  O2: { x: 0, y: 0 },
  O4: { x: 150, y: 0 },
  A0: { x: 52.5, y: 0 },
  B0: { x: 82.5, y: 0 },
  L1: 150,
  L2: 52.5,
  L3: 120,
  L4: 67.5,
  grashof: { type: 'crank-rocker', passes: true },
  minMu: 45,
  rmsError: 5.2,
  accuracyScore: 82,
}

const useMechanismStore = create((set) => ({
  patientData: {
    name: 'Patient A',
    injury: 'ACL Reconstruction',
    romStart: 0,
    romEnd: 90,
    usesChebyshev: true,
  },
  precisionPoints: [
    { theta_in: 22.5,  theta_out: 0  },
    { theta_in: 135,   theta_out: 45 },
    { theta_in: 247.5, theta_out: 90 },
  ],
  mechanism:       DEFAULT_MECHANISM,
  selectedSolution: null,
  crankAngle:      0,
  activePage:      'dashboard',

  // Flat actions — no nested object, no selector instability
  setPatient:        (data)  => set({ patientData: data }),
  addPrecisionPoint: (pt)    => set(s => ({ precisionPoints: [...s.precisionPoints, pt] })),
  setPrecisionPoints:(pts)   => set({ precisionPoints: pts }),
  setMechanism:      (m)     => set({ mechanism: m }),
  setSelectedSolution:(sol)  => set({ selectedSolution: sol, mechanism: sol }),
  setCrankAngle:     (angle) => set({ crankAngle: angle }),
  setActivePage:     (page)  => set({ activePage: page }),
  updateLinkLength:  (key, value) => set(s => {
    const m = { ...s.mechanism, [key]: value }
    if (key === 'L1') m.O4 = { x: value, y: 0 }
    return { mechanism: m }
  }),
  resetMechanism: () => set({ mechanism: DEFAULT_MECHANISM }),
}))

export default useMechanismStore
