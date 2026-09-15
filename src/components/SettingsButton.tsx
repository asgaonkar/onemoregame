import { useEffect, useRef, useState } from 'react'
import { useTheme, type BackgroundStyle } from '../lib/theme'

const STYLE_OPTIONS: { value: BackgroundStyle; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'dots', label: 'Dots' },
  { value: 'lines', label: 'Lines' },
]

export function SettingsButton() {
  const { bgStyle, setBgStyle, bgOpacity, setBgOpacity } = useTheme()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close settings' : 'Open settings'}
        aria-expanded={open}
        title="Settings"
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: '1px solid var(--border)',
          background: 'var(--bg-raised)',
          color: 'var(--text-dim)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.4 1a7.7 7.7 0 0 0-1.7-1L15 3.5h-4l-.3 2.6a7.7 7.7 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7.7 7.7 0 0 0 1.7 1l.3 2.6h4l.3-2.6a7.7 7.7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 44,
            right: 0,
            width: 220,
            padding: 16,
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            background: 'var(--bg-raised)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
            zIndex: 10,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.5,
              color: 'var(--text-faint)',
              textTransform: 'uppercase',
              marginBottom: 10,
            }}
          >
            Background
          </div>
          <OptionRow
            options={STYLE_OPTIONS}
            value={bgStyle}
            onChange={setBgStyle}
          />

          {bgStyle !== 'none' && (
            <>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  margin: '14px 0 10px',
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: 0.5,
                    color: 'var(--text-faint)',
                    textTransform: 'uppercase',
                  }}
                >
                  Transparency
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {Math.round(bgOpacity * 100)}%
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(bgOpacity * 100)}
                onChange={(e) => setBgOpacity(Number(e.target.value) / 100)}
                style={{
                  width: '100%',
                  accentColor: 'var(--accent)',
                  cursor: 'pointer',
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function OptionRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              flex: 1,
              padding: '7px 0',
              borderRadius: 999,
              border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? 'var(--accent-text)' : 'var(--text-dim)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
