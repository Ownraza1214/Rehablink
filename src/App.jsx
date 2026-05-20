import { Suspense, lazy } from 'react'
import useMechanismStore from './store/useMechanismStore'
import Sidebar from './components/Sidebar'
import ErrorBoundary from './components/ErrorBoundary'

// Lazy load every page so a crash in one never kills the shell
const Dashboard          = lazy(() => import('./pages/Dashboard'))
const PatientSetup       = lazy(() => import('./pages/PatientSetup'))
const SynthesisWorkspace = lazy(() => import('./pages/SynthesisWorkspace'))
const KinematicAnalyzer  = lazy(() => import('./pages/KinematicAnalyzer'))
const ForceDynamicsLab   = lazy(() => import('./pages/ForceDynamicsLab'))
const SolutionsOptimizer = lazy(() => import('./pages/SolutionsOptimizer'))
const MotionSimulator3D  = lazy(() => import('./pages/MotionSimulator3D'))
const Validation         = lazy(() => import('./pages/Validation'))
const ExportFabrication  = lazy(() => import('./pages/ExportFabrication'))

const PAGE_MAP = {
  dashboard:   { component: Dashboard,         label: 'Dashboard' },
  patient:     { component: PatientSetup,       label: 'Patient Setup' },
  synthesis:   { component: SynthesisWorkspace, label: 'Synthesis Workspace' },
  kinematic:   { component: KinematicAnalyzer,  label: 'Kinematic Analyzer' },
  forces:      { component: ForceDynamicsLab,   label: 'Force & Dynamics Lab' },
  optimizer:   { component: SolutionsOptimizer, label: 'Solutions Optimizer' },
  simulator3d: { component: MotionSimulator3D,  label: '3D Motion Simulator' },
  validation:  { component: Validation,         label: 'Validation' },
  export:      { component: ExportFabrication,  label: 'Export & Fabrication' },
}

function PageLoader() {
  return (
    <div style={{
      height: '100%', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      color: '#333', fontSize: 13, letterSpacing: '0.1em',
    }}>
      LOADING...
    </div>
  )
}

export default function App() {
  const activePage = useMechanismStore(s => s.activePage)
  const page = PAGE_MAP[activePage] || PAGE_MAP.dashboard
  const PageComponent = page.component

  return (
    <div style={{
      display: 'flex', height: '100vh', width: '100vw',
      overflow: 'hidden', background: '#0a0a0a',
      fontFamily: "'Inter', system-ui, sans-serif", color: '#f0f0f0',
    }}>
      <Sidebar />
      <main style={{
        flex: 1, overflow: 'hidden',
        display: 'flex', flexDirection: 'column', minWidth: 0,
      }}>
        {/* Top bar */}
        <div style={{
          height: 50, flexShrink: 0,
          borderBottom: '1px solid #1a1a1a',
          background: '#0f0f0f',
          display: 'flex', alignItems: 'center',
          padding: '0 24px', gap: 10,
        }}>
          <span style={{ color: '#2a2a2a', fontSize: 11, letterSpacing: '0.1em', fontWeight: 700 }}>REHABLINK</span>
          <span style={{ color: '#2a2a2a' }}>{'>'}</span>
          <span style={{ color: '#f0f0f0', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {page.label}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#27ae60' }} />
            <span style={{ color: '#333', fontSize: 10, letterSpacing: '0.1em' }}>SYSTEM ONLINE</span>
          </div>
        </div>

        {/* Page  -  each wrapped in its own error boundary */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <ErrorBoundary key={activePage}>
            <Suspense fallback={<PageLoader />}>
              <PageComponent />
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>
    </div>
  )
}

