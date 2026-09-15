import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ThemeToggle } from './ThemeToggle'
import { SettingsButton } from './SettingsButton'

export function GameShell({
  title,
  eyebrow,
  children,
}: {
  title: string
  eyebrow: string
  children: ReactNode
}) {
  return (
    <div
      style={{
        maxWidth: 760,
        margin: '0 auto',
        padding: '20px 20px 60px',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <Link
          to="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-dim)',
            textDecoration: 'none',
            border: '1px solid var(--border)',
            borderRadius: 999,
            padding: '7px 14px',
          }}
        >
          ← Back
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SettingsButton />
          <ThemeToggle />
        </div>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 0.6,
            color: 'var(--text-faint)',
            textTransform: 'uppercase',
          }}
        >
          {eyebrow}
        </div>
        <h1 style={{ fontSize: 34, margin: '4px 0 0', fontWeight: 700 }}>
          {title}
        </h1>
      </div>

      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}
