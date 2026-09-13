import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        textAlign: 'center',
        padding: 20,
      }}
    >
      <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
        This game doesn't exist yet.
      </div>
      <Link
        to="/"
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--accent)',
          textDecoration: 'none',
        }}
      >
        ← Back to all games
      </Link>
    </div>
  )
}
