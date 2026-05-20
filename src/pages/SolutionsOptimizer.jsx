import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import useMechanismStore from '../store/useMechanismStore'
const { setActivePage, setSelectedSolution } = useMechanismStore.getState()
import { grashofCheck, computeRMSError, forwardKinematicsRaw, computeCouplerCurve } from '../engine/synthesis'
import AccuracyBadge from '../components/AccuracyBadge'

const DEG = Math.PI / 180

// ── Monte Carlo engine ────────────────────────────────────────────
function rand(lo, hi) { return lo + Math.random() * (hi - lo) }

function computeMu(theta3, theta4) {
  const mu = Math.abs(theta3 - theta4) % Math.PI
  return Math.min(mu, Math.PI - mu) * (180 / Math.PI)
}

function evaluateCandidate(L1, L2, L3, L4, precisionPoints, romStart, romEnd) {
  const O2 = { x: 0, y: 0 }, O4 = { x: L1, y: 0 }
  const grashof = grashofCheck(L1, L2, L3, L4)

  let minMu = 180, validKin = true
  if (grashof.passes) {
    for (let t = 0; t <= 360; t += 8) {
      const fk = forwardKinematicsRaw(t * DEG, L1, L2, L3, L4, O2, O4)
      if (!fk) { validKin = false; break }
      const mu = computeMu(fk.theta3, fk.theta4)
      if (mu < minMu) minMu = mu
    }
  }

  let rmsError = 999, accuracyScore = 0
  if (grashof.passes && validKin && precisionPoints.length) {
    const r = computeRMSError({ L1, L2, L3, L4, O2, O4 }, precisionPoints, romStart, romEnd)
    rmsError  = r.rmsError
    accuracyScore = r.accuracyScore
  }

  return { L1, L2, L3, L4, O2, O4, grashof, minMu, validKin, rmsError, accuracyScore }
}

function runMonteCarlo(patientData, precisionPoints, N = 3000) {
  const { romStart, romEnd } = patientData
  const results = []

  for (let i = 0; i < N; i++) {
    const L1 = rand(80, 320)
    // Grashof: shortest link is crank (L2 < L1, L3, L4) and S+L <= P+Q
    const L2 = rand(18, L1 * 0.55)
    const L3 = rand(L2 * 1.1, L1 * 1.6)
    const L4 = rand(L2 * 0.8, L1 * 1.2)
    try {
      results.push(evaluateCandidate(L1, L2, L3, L4, precisionPoints, romStart, romEnd))
    } catch (_) {}
  }

  // Sort by accuracy descending
  results.sort((a, b) => b.accuracyScore - a.accuracyScore)
  return results
}

// ── Colour helpers ────────────────────────────────────────────────
function scoreColor(score) {
  if (score >= 80) return `hsl(${120 - (100-score)*1.2},85%,52%)`
  if (score >= 50) return `hsl(${40},85%,52%)`
  return '#c0392b'
}
function muColor(mu) {
  if (mu >= 45) return '#00c851'
  if (mu >= 30) return '#ff9800'
  return '#ff3355'
}

// ── Mini coupler canvas (animated) ───────────────────────────────
function MiniCanvas({ solution }) {
  const ref  = useRef(null)
  const raf  = useRef(null)
  const ang  = useRef(0)

  useEffect(() => {
    if (!solution?.L1) return
    function tick() {
      ang.current = (ang.current + 1.8) % 360
      draw(ref.current, solution, ang.current)
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [solution])

  return (
    <canvas ref={ref} width={220} height={110}
      style={{ width: '100%', height: 90, borderRadius: 8, background: '#08090c' }} />
  )
}

function draw(canvas, sol, angle) {
  if (!canvas || !sol?.L1) return
  const ctx = canvas.getContext('2d')
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#08090c'; ctx.fillRect(0, 0, W, H)

  const { L1, L2, L3, L4, O2, O4 } = sol
  const sc = (W * 0.7) / L1
  const ox = W * 0.2, oy = H * 0.75
  const tc = (x, y) => ({ x: ox + x * sc, y: oy - y * sc })

  // Coupler curve
  const curve = computeCouplerCurve(L1, L2, L3, L4, O2, O4, 120)
  if (curve.length > 2) {
    ctx.beginPath()
    curve.forEach((pt, i) => {
      const p = tc(pt.x, pt.y)
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
    })
    ctx.strokeStyle = 'rgba(0,180,255,0.35)'; ctx.lineWidth = 1.2; ctx.stroke()
  }

  // FK
  const fk = forwardKinematicsRaw(angle * DEG, L1, L2, L3, L4, O2, O4)
  if (!fk) return
  const pO2 = tc(O2.x, O2.y), pO4 = tc(O4.x, O4.y)
  const pA  = tc(fk.A.x, fk.A.y), pB = tc(fk.B.x, fk.B.y)

  // Ground
  ctx.setLineDash([3,3]); ctx.strokeStyle='#1e2a1e'; ctx.lineWidth=2
  ctx.beginPath(); ctx.moveTo(pO2.x,pO2.y); ctx.lineTo(pO4.x,pO4.y); ctx.stroke()
  ctx.setLineDash([])

  // Links
  miniLink(ctx, pO2, pA, '#c0392b', 3.5)
  miniLink(ctx, pA,  pB, '#4a9eff', 2.5)
  miniLink(ctx, pO4, pB, '#00c851', 3.5)

  // Pivots
  for (const [p, c] of [[pO2,'#c0392b'],[pO4,'#00c851'],[pA,'#4a9eff'],[pB,'#4a9eff']]) {
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, 2*Math.PI)
    ctx.fillStyle = c; ctx.fill()
  }
}

function miniLink(ctx, p1, p2, color, lw) {
  ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y)
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.stroke()
}

// ── Main page ─────────────────────────────────────────────────────
export default function SolutionsOptimizer() {
  const patientData     = useMechanismStore(s => s.patientData)
  const precisionPoints = useMechanismStore(s => s.precisionPoints)

  const [running,    setRunning]    = useState(false)
  const [progress,   setProgress]   = useState(0)
  const [nSamples,   setNSamples]   = useState(3000)
  const [candidates, setCandidates] = useState([])
  const [solutions,  setSolutions]  = useState([])
  const [scatterView,setScatterView]= useState('score')  // score | mu | pareto
  const [minScore,   setMinScore]   = useState(0)
  const [minMuFilt,  setMinMuFilt]  = useState(0)

  const scatter1Ref = useRef(null)
  const scatter2Ref = useRef(null)
  const scatter3Ref = useRef(null)

  // Filtered top solutions
  const topSolutions = useMemo(() => {
    return candidates
      .filter(c => c.grashof?.passes && c.validKin && c.minMu >= minMuFilt && c.accuracyScore >= minScore)
      .slice(0, 6)
  }, [candidates, minScore, minMuFilt])

  // ── Run Monte Carlo ──────────────────────────────────────────
  const run = useCallback(async () => {
    setRunning(true)
    setProgress(0)
    setCandidates([])
    setSolutions([])

    // Batch in chunks so UI breathes
    const BATCH = 300
    const total = nSamples
    let all = []
    let done = 0

    while (done < total) {
      const chunk = Math.min(BATCH, total - done)
      await new Promise(r => setTimeout(r, 0))   // yield to renderer
      const batch = runMonteCarlo(patientData, precisionPoints, chunk)
      all = [...all, ...batch]
      done += chunk
      setProgress(done / total)
      setCandidates([...all].sort((a,b) => b.accuracyScore - a.accuracyScore))
    }

    // Final sort + top solutions
    all.sort((a, b) => b.accuracyScore - a.accuracyScore)
    setCandidates(all)
    setSolutions(all.filter(c => c.grashof?.passes && c.validKin && c.minMu >= 30).slice(0, 6))
    setRunning(false)
    setProgress(1)
  }, [patientData, precisionPoints, nSamples])

  // ── Draw scatter plots ────────────────────────────────────────
  useEffect(() => {
    drawScatter1(scatter1Ref.current, candidates)
    drawScatter2(scatter2Ref.current, candidates)
    drawScatter3(scatter3Ref.current, candidates)
  }, [candidates])

  // Scatter 1: L2/L1 vs Accuracy, colored by minMu
  function drawScatter1(canvas, cands) {
    if (!canvas || !cands.length) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0,0,W,H)
    ctxBG(ctx,W,H)

    const xs = cands.map(c => c.L2 / c.L1)
    const ys = cands.map(c => c.accuracyScore)
    const [xlo,xhi] = [Math.min(...xs), Math.max(...xs)||1]
    const [ylo,yhi] = [0, 100]

    cands.forEach((c,i) => {
      const px = 40 + (xs[i]-xlo)/(xhi-xlo+.001)*(W-60)
      const py = H-30 - (ys[i]-ylo)/(yhi-ylo)*(H-50)
      if (!c.grashof?.passes || !c.validKin) {
        ctx.beginPath(); ctx.arc(px,py,1.5,0,2*Math.PI)
        ctx.fillStyle='#ff335533'; ctx.fill(); return
      }
      ctx.beginPath(); ctx.arc(px,py,2.5,0,2*Math.PI)
      ctx.fillStyle = muColor(c.minMu)+'bb'; ctx.fill()
    })

    // Star top 5
    const top5 = cands.filter(c=>c.grashof?.passes&&c.validKin&&c.minMu>=30).slice(0,5)
    top5.forEach(c => {
      const i = cands.indexOf(c)
      const px = 40+(xs[i]-xlo)/(xhi-xlo+.001)*(W-60)
      const py = H-30-(ys[i]-ylo)/(yhi-ylo)*(H-50)
      drawStar(ctx,px,py,7,'#ffd700')
    })

    axisLabels(ctx, W, H, 'L2 / L1  ratio', 'Accuracy %', [0,25,50,75,100])
    scatterLegend(ctx, W, [['#00c851','mu ≥ 45°'],['#ff9800','mu 30–45°'],['#ff3355','fail']])
  }

  // Scatter 2: L3/L4 vs RMS Error, colored by accuracy
  function drawScatter2(canvas, cands) {
    if (!canvas || !cands.length) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0,0,W,H)
    ctxBG(ctx,W,H)

    const valid = cands.filter(c=>c.grashof?.passes&&c.validKin)
    if (!valid.length) return
    const xs = valid.map(c => c.L3/c.L4)
    const ys = valid.map(c => Math.min(c.rmsError, 50))
    const [xlo,xhi]=[Math.min(...xs),Math.max(...xs)||1]
    const [ylo,yhi]=[0,50]

    valid.forEach((c,i) => {
      const px = 40+(xs[i]-xlo)/(xhi-xlo+.001)*(W-60)
      const py = H-30-(yhi-ys[i])/(yhi-ylo)*(H-50)
      const col = scoreColor(c.accuracyScore)
      ctx.beginPath(); ctx.arc(px,py,2.5,0,2*Math.PI)
      ctx.fillStyle = col+'bb'; ctx.fill()
    })

    axisLabels(ctx, W, H, 'L3 / L4  ratio', 'RMS Error (deg)', [0,10,20,30,40,50])
    ctx.fillStyle='#2a3a4a'; ctx.font='9px Consolas,monospace'
    ctx.fillText('colour = accuracy score  (green=80%+)', 8, H-12)
  }

  // Scatter 3: minMu vs Accuracy (Pareto front)
  function drawScatter3(canvas, cands) {
    if (!canvas || !cands.length) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0,0,W,H)
    ctxBG(ctx,W,H)

    // Zones
    ctx.fillStyle='rgba(0,200,81,0.04)'
    ctx.fillRect(40+(30/(180))*(W-60), 0, (W-60)*(150/180), H-30)
    ctx.fillStyle='rgba(255,152,0,0.04)'
    ctx.fillRect(40, 0, (W-60)*(30/180), H-30)

    const valid = cands.filter(c=>c.grashof?.passes&&c.validKin)
    valid.forEach(c => {
      const px = 40+(c.minMu/180)*(W-60)
      const py = H-30-(c.accuracyScore/100)*(H-50)
      ctx.beginPath(); ctx.arc(px,py,2.5,0,2*Math.PI)
      ctx.fillStyle = scoreColor(c.accuracyScore)+'bb'; ctx.fill()
    })

    // Pareto line
    const sorted = [...valid].sort((a,b)=>a.minMu-b.minMu)
    let maxScore = -1
    const pareto = sorted.filter(c => {
      if (c.accuracyScore > maxScore) { maxScore = c.accuracyScore; return true }
      return false
    })
    if (pareto.length > 1) {
      ctx.beginPath()
      pareto.forEach((c,i) => {
        const px = 40+(c.minMu/180)*(W-60)
        const py = H-30-(c.accuracyScore/100)*(H-50)
        i===0?ctx.moveTo(px,py):ctx.lineTo(px,py)
      })
      ctx.strokeStyle='#ffd700aa'; ctx.lineWidth=1.5; ctx.setLineDash([4,3]); ctx.stroke(); ctx.setLineDash([])
    }

    // Reference lines
    ctx.save(); ctx.globalAlpha=0.3
    const x30 = 40+(30/180)*(W-60)
    const y80 = H-30-(80/100)*(H-50)
    ctx.strokeStyle='#ff9800'; ctx.lineWidth=1; ctx.setLineDash([4,4])
    ctx.beginPath(); ctx.moveTo(x30,0); ctx.lineTo(x30,H-30); ctx.stroke()
    ctx.strokeStyle='#00c851'
    ctx.beginPath(); ctx.moveTo(40,y80); ctx.lineTo(W,y80); ctx.stroke()
    ctx.setLineDash([]); ctx.restore()

    ctx.fillStyle='#ff9800'; ctx.font='9px Consolas,monospace'; ctx.fillText('mu=30°',x30+2,14)
    ctx.fillStyle='#00c851'; ctx.fillText('80%',44,y80-3)

    axisLabels(ctx, W, H, 'Min Transmission Angle  mu (deg)', 'Accuracy Score %', [0,25,50,75,100])
    ctx.fillStyle='#ffd700'; ctx.font='9px Consolas,monospace'; ctx.fillText('-- Pareto front', 8, H-12)
  }

  // ── Stats ──────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!candidates.length) return null
    const valid = candidates.filter(c=>c.grashof?.passes&&c.validKin&&c.minMu>=30)
    const good  = valid.filter(c=>c.accuracyScore>=80)
    return {
      total:   candidates.length,
      valid:   valid.length,
      good:    good.length,
      best:    valid[0]?.accuracyScore ?? 0,
      bestMu:  valid.reduce((b,c)=>c.accuracyScore>=(valid[0]?.accuracyScore*0.95||0)?Math.max(b,c.minMu):b, 0),
    }
  }, [candidates])

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden', background:'#08090c' }}>

      {/* ── Left: scatter plots + controls (55%) ── */}
      <div style={{ flex:'0 0 55%', display:'flex', flexDirection:'column', padding:14, gap:10, borderRight:'1px solid #0f1820', overflow:'hidden' }}>

        {/* Header + run */}
        <div style={{ display:'flex', gap:10, alignItems:'center', flexShrink:0 }}>
          <div>
            <div style={{ fontWeight:900, fontSize:16, color:'#e8f0ff', letterSpacing:'0.04em' }}>Monte Carlo Optimizer</div>
            <div style={{ color:'#2a3a4a', fontSize:11 }}>Random design-space sampling  ·  Grashof + accuracy filter</div>
          </div>
          <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
            {/* N-samples */}
            <div style={{ display:'flex', gap:4, background:'#0d1117', borderRadius:6, padding:'3px 6px', alignItems:'center' }}>
              <span style={{ color:'#2a3a4a', fontSize:10, fontWeight:700 }}>N=</span>
              {[1000,2000,3000,5000].map(n=>(
                <button key={n} onClick={()=>setNSamples(n)}
                  style={btnS(nSamples===n?'#c0392b33':'transparent', nSamples===n?'#c0392b':'#444')}>
                  {n/1000}k
                </button>
              ))}
            </div>
            <button onClick={run} disabled={running}
              style={{
                background: running?'#1a1a1a':'linear-gradient(135deg,#c0392b,#922b21)',
                border:'none', borderRadius:8, padding:'9px 22px',
                color: running?'#444':'#fff',
                fontWeight:800, fontSize:13, cursor:running?'not-allowed':'pointer',
                letterSpacing:'0.05em', boxShadow: running?'none':'0 0 20px rgba(192,57,43,0.3)',
              }}>{running?`Sampling… ${(progress*100).toFixed(0)}%`:'> Run Monte Carlo'}</button>
          </div>
        </div>

        {/* Progress bar */}
        {running && (
          <div style={{ height:4, background:'#0f1820', borderRadius:2, overflow:'hidden', flexShrink:0 }}>
            <div style={{ height:'100%', width:`${progress*100}%`, background:'linear-gradient(90deg,#c0392b,#00c851)', transition:'width 0.15s', borderRadius:2 }} />
          </div>
        )}

        {/* Stats strip */}
        {stats && (
          <div style={{ display:'flex', gap:8, flexShrink:0 }}>
            {[
              { l:'Sampled',  v:stats.total,                    c:'#4a6a8a' },
              { l:'Valid',    v:stats.valid,                    c:'#4a9eff' },
              { l:'≥80% acc', v:stats.good,                     c:'#00c851' },
              { l:'Best acc', v:`${stats.best.toFixed(1)}%`,    c:'#ffd700' },
              { l:'Best mu',  v:`${stats.bestMu.toFixed(1)}°`,  c:'#ff9800' },
            ].map(m=>(
              <div key={m.l} style={{ flex:1, background:'#0d1117', border:`1px solid ${m.c}22`, borderRadius:8, padding:'6px 10px' }}>
                <div style={{ fontSize:9, color:m.c+'88', fontWeight:700, letterSpacing:'0.12em' }}>{m.l.toUpperCase()}</div>
                <div style={{ fontFamily:'Consolas,monospace', fontWeight:800, fontSize:15, color:m.c }}>{m.v}</div>
              </div>
            ))}
          </div>
        )}

        {/* Scatter canvases — 3 panels stacked */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', gap:6, minHeight:0, overflow:'hidden' }}>

          <div style={{ color:'#1e2d40', fontSize:10, fontWeight:700, letterSpacing:'0.1em' }}>
            DESIGN SPACE EXPLORATION  —  {candidates.length} candidates
          </div>

          {/* View tabs */}
          <div style={{ display:'flex', gap:4, flexShrink:0 }}>
            {[['score','L2/L1 vs Accuracy'],['rms','L3/L4 vs RMS'],['pareto','Pareto Front']].map(([id,label])=>(
              <button key={id} onClick={()=>setScatterView(id)}
                style={btnS(scatterView===id?'#1a2a3a':'transparent', scatterView===id?'#4a9eff':'#2a3a4a')}>
                {label}
              </button>
            ))}
          </div>

          {/* Three scatter canvases (show active full, others collapsed) */}
          <div style={{ flex:1, minHeight:0, position:'relative' }}>
            {[
              { id:'score', ref:scatter1Ref },
              { id:'rms',   ref:scatter2Ref },
              { id:'pareto',ref:scatter3Ref },
            ].map(({id,ref})=>(
              <canvas key={id} ref={ref} width={700} height={340}
                style={{
                  position:'absolute', inset:0,
                  width:'100%', height:'100%',
                  borderRadius:10,
                  border:'1px solid #0f1820',
                  background:'#07090c',
                  opacity: scatterView===id?1:0,
                  pointerEvents: scatterView===id?'auto':'none',
                  transition:'opacity 0.2s',
                }} />
            ))}
            {!candidates.length && (
              <div style={{
                position:'absolute', inset:0,
                display:'flex', alignItems:'center', justifyContent:'center',
                color:'#1a2a3a', fontSize:14, fontWeight:700,
              }}>
                Click  [Run Monte Carlo]  to start sampling
              </div>
            )}
          </div>
        </div>

        {/* Filters */}
        <div style={{ display:'flex', gap:16, flexShrink:0, padding:'6px 0' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flex:1 }}>
            <span style={{ color:'#2a3a4a', fontSize:11, whiteSpace:'nowrap' }}>Min Accuracy</span>
            <input type="range" min={0} max={90} step={5} value={minScore}
              onChange={e=>setMinScore(+e.target.value)}
              style={{ flex:1, accentColor:'#00c851' }} />
            <span style={{ fontFamily:'Consolas,monospace', fontSize:12, color:'#00c851', minWidth:32 }}>{minScore}%</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8, flex:1 }}>
            <span style={{ color:'#2a3a4a', fontSize:11, whiteSpace:'nowrap' }}>Min mu</span>
            <input type="range" min={0} max={60} step={5} value={minMuFilt}
              onChange={e=>setMinMuFilt(+e.target.value)}
              style={{ flex:1, accentColor:'#ff9800' }} />
            <span style={{ fontFamily:'Consolas,monospace', fontSize:12, color:'#ff9800', minWidth:32 }}>{minMuFilt}°</span>
          </div>
        </div>

      </div>

      {/* ── Right: solution cards (45%) ── */}
      <div style={{ flex:'0 0 45%', overflowY:'auto', padding:14, display:'flex', flexDirection:'column', gap:10 }}>

        <div style={{ fontWeight:800, fontSize:13, color:'#2a3a4a', letterSpacing:'0.1em', flexShrink:0 }}>
          TOP SOLUTIONS  —  {topSolutions.length} shown
        </div>

        {topSolutions.length === 0 && (
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#1a2a3a', fontSize:13, textAlign:'center', flexDirection:'column', gap:8 }}>
            <div style={{ fontSize:40 }}>◌</div>
            <div>Run the optimizer to see solutions</div>
          </div>
        )}

        {topSolutions.map((sol, i) => (
          <SolutionCard key={i} rank={i+1} solution={sol}
            onSelect={() => { setSelectedSolution(sol); setActivePage('synthesis') }} />
        ))}
      </div>
    </div>
  )
}

// ── Solution card ──────────────────────────────────────────────────
function SolutionCard({ rank, solution, onSelect }) {
  const ok = solution.accuracyScore >= 80
  const medals = ['🥇','🥈','🥉','4','5','6']

  return (
    <div style={{
      background:'#0d1117',
      border:`1px solid ${ok ? '#00c85133' : '#ff980033'}`,
      borderRadius:12, padding:14,
      display:'flex', flexDirection:'column', gap:10,
    }}>

      {/* Header row */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <span style={{
            background: ok?'#00c85122':'#ff980022',
            color: ok?'#00c851':'#ff9800',
            borderRadius:6, padding:'2px 10px', fontSize:12, fontWeight:800,
          }}>#{rank}</span>
          <span style={{ color:'#2a3a4a', fontSize:11, fontFamily:'Consolas,monospace' }}>
            {solution.grashof?.type || '-'}
          </span>
        </div>
        <AccuracyBadge score={solution.accuracyScore||0} size="md" />
      </div>

      {/* Animated coupler curve */}
      <MiniCanvas solution={solution} />

      {/* Link bars */}
      {[
        { k:'L1', label:'L1 Ground',  c:'#3a4a5a' },
        { k:'L2', label:'L2 Crank',   c:'#c0392b' },
        { k:'L3', label:'L3 Coupler', c:'#4a9eff' },
        { k:'L4', label:'L4 Rocker',  c:'#00c851' },
      ].map(({ k, label, c }) => {
        const val = solution[k]||0
        const max = Math.max(solution.L1,solution.L2,solution.L3,solution.L4)||1
        return (
          <div key={k}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
              <span style={{ color:c, fontSize:11, fontWeight:700 }}>{label}</span>
              <span style={{ fontFamily:'Consolas,monospace', fontSize:12, color:'#c8d8e8' }}>
                {val.toFixed(1)} mm
              </span>
            </div>
            <div style={{ height:4, background:'#0f1820', borderRadius:2 }}>
              <div style={{ height:'100%', width:`${(val/max)*100}%`, background:c, borderRadius:2 }} />
            </div>
          </div>
        )
      })}

      {/* Metrics grid */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6 }}>
        {[
          { l:'Min mu',     v:`${solution.minMu.toFixed(1)}°`,    c: muColor(solution.minMu) },
          { l:'RMS Error',  v:`${(solution.rmsError||0).toFixed(2)}°`, c:'#c8d8e8' },
          { l:'Grashof',    v: solution.grashof?.passes?'PASS':'FAIL', c: solution.grashof?.passes?'#00c851':'#ff3355' },
        ].map(m=>(
          <div key={m.l} style={{ background:'#08090c', borderRadius:6, padding:'6px 8px' }}>
            <div style={{ color:'#2a3a4a', fontSize:9, fontWeight:700, letterSpacing:'0.1em' }}>{m.l.toUpperCase()}</div>
            <div style={{ fontFamily:'Consolas,monospace', fontWeight:800, fontSize:13, color:m.c }}>{m.v}</div>
          </div>
        ))}
      </div>

      <button onClick={onSelect}
        style={{
          background: ok?'linear-gradient(135deg,#c0392b,#0070cc)':'#0f1820',
          border:'none', borderRadius:8, padding:'10px 0',
          color: ok?'#fff':'#2a3a4a',
          fontWeight:800, fontSize:12, cursor:'pointer',
          letterSpacing:'0.06em',
          boxShadow: ok?'0 0 16px rgba(0,112,204,0.25)':'none',
        }}>
        {ok ? '✓ Use This Design' : 'Load Design'}
      </button>
    </div>
  )
}

// ── Canvas utilities ──────────────────────────────────────────────
function ctxBG(ctx, W, H) {
  ctx.fillStyle='#07090c'; ctx.fillRect(0,0,W,H)
  ctx.strokeStyle='rgba(255,255,255,0.015)'; ctx.lineWidth=1
  for (let x=0;x<W;x+=30){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}
  for (let y=0;y<H;y+=30){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}
}

function axisLabels(ctx, W, H, xLabel, yLabel, yTicks) {
  ctx.fillStyle='#2a3a4a'; ctx.font='10px Consolas,monospace'
  ctx.textAlign='center'; ctx.fillText(xLabel, W/2, H-4)
  ctx.save(); ctx.translate(14, H/2); ctx.rotate(-Math.PI/2)
  ctx.fillText(yLabel, 0, 0); ctx.restore()
  ctx.textAlign='left'
  yTicks?.forEach(t => {
    const y = H-30-(t/100)*(H-50)
    ctx.fillStyle='#1a2a3a'; ctx.fillText(t, 2, y+4)
  })
}

function scatterLegend(ctx, W, items) {
  items.forEach(([color, label], i) => {
    ctx.beginPath(); ctx.arc(W-110, 14+i*16, 4, 0, 2*Math.PI)
    ctx.fillStyle=color; ctx.fill()
    ctx.fillStyle=color; ctx.font='9px Consolas,monospace'
    ctx.fillText(label, W-102, 18+i*16)
  })
}

function drawStar(ctx, cx, cy, r, color) {
  ctx.beginPath()
  for (let i=0;i<5;i++) {
    const a1=(i*2*Math.PI)/5-Math.PI/2
    const a2=((i+.5)*2*Math.PI)/5-Math.PI/2
    if(i===0)ctx.moveTo(cx+r*Math.cos(a1),cy+r*Math.sin(a1))
    else ctx.lineTo(cx+r*Math.cos(a1),cy+r*Math.sin(a1))
    ctx.lineTo(cx+(r/2)*Math.cos(a2),cy+(r/2)*Math.sin(a2))
  }
  ctx.closePath(); ctx.fillStyle=color; ctx.fill()
}

function btnS(bg, color='#fff') {
  return {
    padding:'4px 9px', borderRadius:5, border:'none',
    background:bg, color, fontWeight:700, cursor:'pointer', fontSize:11,
  }
}
