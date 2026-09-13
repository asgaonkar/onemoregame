import type { RunRecord } from '../lib/leaderboard'

export function LocalLeaderboard({ runs }: { runs: RunRecord[] }) {
  if (runs.length === 0) return null

  return (
    <div
      style={{
        marginTop: 32,
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-card)',
        padding: '16px 20px',
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: 0.6,
          color: 'var(--text-faint)',
          textTransform: 'uppercase',
          marginBottom: 10,
        }}
      >
        Your best runs (this device)
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {runs.map((run, i) => (
          <div
            key={run.date}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 14,
            }}
          >
            <span style={{ color: 'var(--text-dim)' }}>
              #{i + 1} ·{' '}
              {new Date(run.date).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </span>
            <span style={{ fontWeight: 600 }}>{run.score.toFixed(1)}</span>
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 12,
          fontSize: 12,
          color: 'var(--text-faint)',
        }}
      >
        Stored on this device only — global leaderboards are coming later.
      </div>
    </div>
  )
}
