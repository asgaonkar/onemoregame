import { useState } from 'react'
import { games, categoryOrder } from '../data/games'
import { GameCard } from '../components/GameCard'
import { ThemeToggle } from '../components/ThemeToggle'
import { SettingsButton } from '../components/SettingsButton'
import {
  FilterBar,
  matchesDeviceFilter,
  type CategoryFilter,
  type ComplexityFilter,
  type DeviceFilter,
} from '../components/FilterBar'

export function Home() {
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [complexity, setComplexity] = useState<ComplexityFilter>('all')
  const [device, setDevice] = useState<DeviceFilter>('all')

  // Locked ('soon') games never render here at all — showing their name and
  // description would give away what's coming next.
  const filtered = games.filter(
    (g) =>
      g.status === 'live' &&
      (category === 'all' || g.category === category) &&
      (complexity === 'all' || g.complexity === complexity) &&
      matchesDeviceFilter(g.bestOn, device),
  )
  const hasResults = filtered.length > 0

  function clearFilters() {
    setCategory('all')
    setComplexity('all')
    setDevice('all')
  }

  return (
    <div
      style={{
        maxWidth: 980,
        margin: '0 auto',
        padding: '28px 20px 80px',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 48,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: 0.2 }}>
          onemoregame
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SettingsButton />
          <ThemeToggle />
        </div>
      </header>

      <section style={{ marginBottom: 56 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 0.6,
            color: 'var(--text-faint)',
            textTransform: 'uppercase',
            marginBottom: 10,
          }}
        >
          A collection of tiny games
        </div>
        <h1
          style={{
            fontSize: 'clamp(32px, 6vw, 52px)',
            lineHeight: 1.1,
            margin: 0,
            fontWeight: 700,
          }}
        >
          Pick your <span style={{ color: 'var(--accent)' }}>challenge</span>.
        </h1>
        <p
          style={{
            marginTop: 16,
            fontSize: 16,
            color: 'var(--text-dim)',
            maxWidth: 560,
            lineHeight: 1.6,
          }}
        >
          Short, addictive rounds of memory, precision, timing and
          perception. No accounts, no tutorials — just play.
        </p>
      </section>

      <FilterBar
        category={category}
        onCategoryChange={setCategory}
        complexity={complexity}
        onComplexityChange={setComplexity}
        device={device}
        onDeviceChange={setDevice}
      />

      {!hasResults && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-dim)' }}>
          No games match these filters.
          <div style={{ marginTop: 10 }}>
            <button
              onClick={clearFilters}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent)',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Clear filters
            </button>
          </div>
        </div>
      )}

      {categoryOrder.map((cat) => {
        const items = filtered.filter((g) => g.category === cat)
        if (items.length === 0) return null

        return (
          <section key={cat} style={{ marginBottom: 40 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: 0.6,
                color: 'var(--text-faint)',
                textTransform: 'uppercase',
                marginBottom: 14,
              }}
            >
              {cat}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: 14,
              }}
            >
              {items.map((game) => (
                <GameCard key={game.id} game={game} />
              ))}
            </div>
          </section>
        )
      })}

      <div
        style={{
          textAlign: 'center',
          padding: '36px 20px',
          border: '1px dashed var(--border)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600 }}>More games coming soon</div>
        <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-dim)' }}>
          New challenges get added regularly — check back later.
        </div>
      </div>
    </div>
  )
}
