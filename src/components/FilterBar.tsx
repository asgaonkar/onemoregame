import { useState, type CSSProperties, type ReactNode } from 'react'
import type { BestOn, GameCategory, GameComplexity } from '../data/games'
import { categoryOrder } from '../data/games'
import { MouseIcon, PhoneIcon } from './GameCard'

export type CategoryFilter = GameCategory | 'all'
export type ComplexityFilter = GameComplexity | 'all'
export type DeviceFilter = 'all' | 'mouse' | 'touch'

const COMPLEXITY_OPTIONS: GameComplexity[] = ['easy', 'medium', 'hard']
const COMPLEXITY_LABEL: Record<GameComplexity, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
}

// A 'both' game suits either device preference, so it should stay visible
// no matter which one the visitor picks — only a device-specific game gets
// filtered out when it doesn't match.
export function matchesDeviceFilter(bestOn: BestOn, device: DeviceFilter): boolean {
  return device === 'all' || bestOn === 'both' || bestOn === device
}

const GROUP_LABEL_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 0.6,
  color: 'var(--text-faint)',
  textTransform: 'uppercase',
  marginBottom: 10,
}

export function FilterBar({
  category,
  onCategoryChange,
  complexity,
  onComplexityChange,
  device,
  onDeviceChange,
}: {
  category: CategoryFilter
  onCategoryChange: (value: CategoryFilter) => void
  complexity: ComplexityFilter
  onComplexityChange: (value: ComplexityFilter) => void
  device: DeviceFilter
  onDeviceChange: (value: DeviceFilter) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 44 }}>
      <FilterGroup label="Category">
        <Pill active={category === 'all'} onClick={() => onCategoryChange('all')}>
          All
        </Pill>
        {categoryOrder.map((c) => (
          <Pill key={c} active={category === c} onClick={() => onCategoryChange(c)}>
            {c}
          </Pill>
        ))}
      </FilterGroup>

      <FilterGroup label="Difficulty">
        <Pill active={complexity === 'all'} onClick={() => onComplexityChange('all')}>
          All
        </Pill>
        {COMPLEXITY_OPTIONS.map((c) => (
          <Pill key={c} active={complexity === c} onClick={() => onComplexityChange(c)}>
            {COMPLEXITY_LABEL[c]}
          </Pill>
        ))}
      </FilterGroup>

      <FilterGroup label="Best on">
        <Pill active={device === 'all'} onClick={() => onDeviceChange('all')}>
          All
        </Pill>
        <Pill active={device === 'mouse'} onClick={() => onDeviceChange('mouse')}>
          <MouseIcon /> Mouse
        </Pill>
        <Pill active={device === 'touch'} onClick={() => onDeviceChange('touch')}>
          <PhoneIcon /> Touch
        </Pill>
      </FilterGroup>
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={GROUP_LABEL_STYLE}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{children}</div>
    </div>
  )
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '7px 14px',
        borderRadius: 999,
        border: `1px solid ${active ? 'var(--accent)' : hovered ? 'var(--text-faint)' : 'var(--border)'}`,
        background: active ? 'var(--accent)' : 'var(--bg-card)',
        color: active ? 'var(--accent-text)' : hovered ? 'var(--text)' : 'var(--text-dim)',
        fontSize: 13,
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'border-color 120ms ease, background 120ms ease, color 120ms ease',
      }}
    >
      {children}
    </button>
  )
}
