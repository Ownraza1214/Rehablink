import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[RehabLink crash]', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          height: '100%', width: '100%',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#0a0a0a', padding: 40, gap: 20,
        }}>
          <div style={{ fontSize: 48, color: '#c0392b' }}>x</div>
          <div style={{ color: '#f0f0f0', fontWeight: 800, fontSize: 18, letterSpacing: '0.05em' }}>
            PAGE ERROR
          </div>
          <div style={{
            background: '#111', border: '1px solid #1e1e1e',
            borderRadius: 10, padding: '16px 24px',
            fontFamily: 'Consolas,monospace', fontSize: 12, color: '#c0392b',
            maxWidth: 500, textAlign: 'center',
          }}>
            {this.state.error?.message || 'Unknown error'}
          </div>
          <button
            onClick={() => this.setState({ error: null, info: null })}
            style={{
              background: '#c0392b', border: 'none', borderRadius: 8,
              padding: '10px 28px', color: '#fff', fontWeight: 800,
              fontSize: 13, cursor: 'pointer', letterSpacing: '0.08em',
            }}
          >
            RELOAD PAGE
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

