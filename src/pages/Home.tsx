import { games, categoryOrder } from '../data/games'
import { GameCard } from '../components/GameCard'
import { ThemeToggle } from '../components/ThemeToggle'

export function Home() {
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
        <ThemeToggle />
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

      {categoryOrder.map((category) => {
        const items = games.filter((g) => g.category === category)
        if (items.length === 0) return null

        return (
          <section key={category} style={{ marginBottom: 40 }}>
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
              {category}
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
    </div>
  )
}
