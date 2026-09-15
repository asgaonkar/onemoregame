import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GameShell } from '../../components/GameShell'
import { GameModeSelect } from '../../components/GameModeSelect'
import { VsSequencer } from '../../components/VsSequencer'
import { LocalLeaderboard } from '../../components/LocalLeaderboard'
import { addRun, getRuns } from '../../lib/leaderboard'
import { trackEvent } from '../../lib/analytics'
import {
  createRunConfig,
  difficultyForRound,
  ENDLESS_LIVES,
  FIXED_ROUNDS,
  isMiss,
  markDailyPlayed,
  rngFor,
  type GameMode,
  type RunConfig,
} from '../../lib/modes'
import type { Rng } from '../../lib/rng'

const GAME_ID = 'match'

// How long a mismatched pair stays visible before flipping back face-down —
// long enough to register both colors, short enough to keep rounds snappy.
const MISMATCH_PAUSE_MS = 600

type CardData = {
  id: number
  color: string
  matched: boolean
}

type Round = {
  t: number
  pairCount: number
  cards: CardData[]
  moves: number
  score: number
}

// Small fixed content palette (similar in spirit to BlinkGame's COLORS), kept
// local to this file since games don't import from each other.
const PALETTE = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
]

function shuffle<T>(rng: Rng, arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Hue (0-360) of a hex color, used only to measure how visually close two
// palette colors are to each other — the palette itself stays fixed.
function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  if (h < 0) h += 360
  return h
}

function hueDiff(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360
  return diff > 180 ? 360 - diff : diff
}

// t: 0 (easiest) -> 1 (hardest). At t=0 colors are drawn from the whole
// palette (well-separated hues, easy to tell apart). At t=1 the pool is
// narrowed down to only the hue-closest colors around a random anchor, so
// the whole board ends up visually similar and much harder to distinguish.
function pickPaletteColors(rng: Rng, count: number, t: number): string[] {
  const anchor = PALETTE[Math.floor(rng() * PALETTE.length)]
  const sorted = PALETTE.slice().sort(
    (a, b) => hueDiff(hexToHue(a), hexToHue(anchor)) - hueDiff(hexToHue(b), hexToHue(anchor)),
  )
  const poolSize = Math.max(count, Math.round(PALETTE.length - (PALETTE.length - count) * t))
  const pool = sorted.slice(0, poolSize)
  return shuffle(rng, pool).slice(0, count)
}

// Pair count: 4 pairs (8 cards) at the easiest, 7 pairs (14 cards) at the
// hardest — a small grid keeps a full match-everything round quick.
function pairCountFor(t: number): number {
  return Math.round(4 + 3 * t)
}

// Board size grows round-over-round on its own timeline, separate from
// `difficultyForRound` (which practice deliberately holds flat so colors
// stay easy) — otherwise practice would deal the same 4-pair board forever.
function pairCountForRound(round: number, mode: GameMode): number {
  if (mode === 'endless') return pairCountFor(Math.min(1, (round - 1) / 11))
  return pairCountFor((round - 1) / (FIXED_ROUNDS - 1))
}

// Card edge length (px) for a given pair count — cards shrink a little as
// the board grows so more of them keep fitting per row.
function cardSizeForPairs(pairCount: number): number {
  if (pairCount <= 4) return 80
  if (pairCount <= 5) return 72
  if (pairCount <= 6) return 66
  return 60
}

const CARD_GAP = 12
const GRID_PADDING = 16

// Widest column count that (a) evenly divides the card count, so the grid
// is always a full rectangle with no dangling half-row, and (b) fits in the
// measured container. On a wide screen 8 cards would otherwise wrap at a
// natural 7-per-row, stranding a single card alone on its own line.
function bestColumnCount(cardCount: number, cardSize: number, availWidth: number): number {
  let best = 1
  for (let cols = 1; cols <= cardCount; cols++) {
    if (cardCount % cols !== 0) continue
    const width = cols * cardSize + (cols - 1) * CARD_GAP
    if (width <= availWidth) best = cols
  }
  return best
}

// Measures the card grid's available width so `bestColumnCount` can pick a
// column count that fits — a plain CSS grid can't make that fit-vs-divides
// decision on its own. A callback ref (rather than useRef + an effect keyed
// on mount) is required because the grid div doesn't exist yet when
// MatchRun first mounts (still on the 'intro' phase) — it only appears
// later, once the round starts.
function useContainerWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0)
  const observerRef = useRef<ResizeObserver | null>(null)

  const ref = useCallback((el: T | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!el) return
    setWidth(el.clientWidth)
    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width))
    observer.observe(el)
    observerRef.current = observer
  }, [])

  return [ref, width] as const
}

// A flawless run (exactly `pairCount` moves) scores 100; a run taking 2.5x
// `pairCount` moves scores 0; linear between, clamped.
function scoreForMoves(moves: number, pairCount: number): number {
  const penaltyPerExtraMove = 100 / (pairCount * 1.5)
  return Math.max(0, Math.min(100, Math.round(100 - (moves - pairCount) * penaltyPerExtraMove)))
}

function buildCards(rng: Rng, pairCount: number, t: number): CardData[] {
  const colors = pickPaletteColors(rng, pairCount, t)
  const cards: CardData[] = colors.flatMap((color, i) => [
    { id: i * 2, color, matched: false },
    { id: i * 2 + 1, color, matched: false },
  ])
  return shuffle(rng, cards)
}

export function MatchGame() {
  const [config, setConfig] = useState<RunConfig | null>(null)

  return (
    <GameShell eyebrow="Memory" title="Match">
      {!config ? (
        <GameModeSelect gameId={GAME_ID} onStart={setConfig} />
      ) : config.mode === 'vs' && config.vs ? (
        <VsSequencer
          playerCount={config.vs.playerCount}
          seed={config.seed}
          onExit={() => setConfig(null)}
          renderRun={(runConfig, onFinish) => (
            <MatchRun
              key={`${runConfig.seed}-${runConfig.vs?.playerIndex ?? 0}`}
              config={runConfig}
              onFinish={onFinish}
              onChangeMode={() => setConfig(null)}
            />
          )}
        />
      ) : (
        <MatchRun
          key={config.seed}
          config={config}
          onChangeMode={() => setConfig(null)}
          onPlayAgain={
            config.mode === 'daily'
              ? undefined
              : () => setConfig(createRunConfig(config.mode, GAME_ID))
          }
        />
      )}
    </GameShell>
  )
}

function modeLabel(config: RunConfig): string {
  if (config.vs) return `Player ${config.vs.playerIndex + 1} of ${config.vs.playerCount}`
  if (config.mode === 'daily') return 'Daily challenge'
  if (config.mode === 'endless') return 'Endless'
  return 'Practice'
}

function MatchRun({
  config,
  onFinish,
  onChangeMode,
  onPlayAgain,
}: {
  config: RunConfig
  onFinish?: (score: number) => void
  onChangeMode: () => void
  onPlayAgain?: () => void
}) {
  const rng = useMemo(() => rngFor(config), [config])
  const isEndless = config.mode === 'endless'

  const [phase, setPhase] = useState<'intro' | 'playing' | 'roundResult' | 'done'>('intro')
  const [rounds, setRounds] = useState<Round[]>([])
  const [flipped, setFlipped] = useState<number[]>([])
  const [resolving, setResolving] = useState(false)
  const [lives, setLives] = useState(ENDLESS_LIVES)
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, config.mode))

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]
  // Guards the "second card flipped" transition against firing twice for a
  // rapid double-tap before React re-renders and `flipped` reflects the
  // first tap — closes the gap before `resolving`/`setFlipped` commit.
  const flippingRef = useRef(false)

  const [gridRef, gridOuterWidth] = useContainerWidth<HTMLDivElement>()
  const cardSize = current ? cardSizeForPairs(current.pairCount) : 0
  const gridColumns = current
    ? bestColumnCount(current.cards.length, cardSize, gridOuterWidth - 2 * GRID_PADDING)
    : 1

  function makeRound(roundNum: number): Round {
    const t = difficultyForRound(roundNum, config.mode)
    const pairCount = pairCountForRound(roundNum, config.mode)
    return { t, pairCount, cards: buildCards(rng, pairCount, t), moves: 0, score: 0 }
  }

  function startGame() {
    setRounds([makeRound(1)])
    setFlipped([])
    setResolving(false)
    flippingRef.current = false
    setLives(ENDLESS_LIVES)
    setPhase('playing')
  }

  // Once every card in the current board is matched, score the round and
  // move to the reveal phase.
  useEffect(() => {
    if (phase !== 'playing' || !current) return
    if (current.cards.length > 0 && current.cards.every((c) => c.matched)) {
      const score = scoreForMoves(current.moves, current.pairCount)
      setRounds((rs) => rs.map((r, i) => (i === currentIndex ? { ...r, score } : r)))
      if (isEndless && isMiss(score)) setLives((l) => l - 1)
      setPhase('roundResult')
    }
  }, [phase, current, currentIndex, isEndless])

  function handleCardClick(id: number) {
    if (phase !== 'playing' || !current || resolving) return
    const card = current.cards.find((c) => c.id === id)
    if (!card || card.matched || flipped.includes(id)) return

    if (flipped.length === 0) {
      setFlipped([id])
      return
    }
    if (flippingRef.current) return
    flippingRef.current = true

    const firstId = flipped[0]
    const first = current.cards.find((c) => c.id === firstId)!
    const newMoves = current.moves + 1
    const isMatch = first.color === card.color

    setFlipped([firstId, id])

    if (isMatch) {
      setRounds((rs) =>
        rs.map((r, i) =>
          i === currentIndex
            ? {
                ...r,
                moves: newMoves,
                cards: r.cards.map((c) =>
                  c.id === firstId || c.id === id ? { ...c, matched: true } : c,
                ),
              }
            : r,
        ),
      )
      setFlipped([])
      flippingRef.current = false
      return
    }

    setResolving(true)
    setRounds((rs) => rs.map((r, i) => (i === currentIndex ? { ...r, moves: newMoves } : r)))
    setTimeout(() => {
      setFlipped([])
      setResolving(false)
      flippingRef.current = false
    }, MISMATCH_PAUSE_MS)
  }

  function finish(finalScore: number) {
    trackEvent('game_finish', { game: GAME_ID, mode: config.mode, score: finalScore })
    if (onFinish) {
      onFinish(finalScore)
      return
    }
    if (config.mode === 'daily') markDailyPlayed(GAME_ID, finalScore)
    if (config.mode !== 'practice') setRuns(addRun(GAME_ID, config.mode, finalScore))
    setPhase('done')
  }

  function nextRound() {
    setFlipped([])
    setResolving(false)
    flippingRef.current = false
    if (isEndless) {
      if (lives <= 0) {
        finish(rounds.length)
        return
      }
      setRounds((rs) => [...rs, makeRound(rs.length + 1)])
      setPhase('playing')
      return
    }
    if (rounds.length >= FIXED_ROUNDS) {
      finish(rounds.reduce((s, r) => s + r.score, 0) / rounds.length)
      return
    }
    setRounds((rs) => [...rs, makeRound(rs.length + 1)])
    setPhase('playing')
  }

  const isRunOver = isEndless ? lives <= 0 : rounds.length >= FIXED_ROUNDS

  return (
    <div>
      {phase === 'intro' && (
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-faint)',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            {modeLabel(config)}
          </div>
          <p style={{ color: 'var(--text-dim)', maxWidth: 420, margin: '0 auto 28px' }}>
            Flip cards to find every matching pair, in as few moves as possible.{' '}
            {isEndless
              ? `${ENDLESS_LIVES} lives — it gets harder the longer you survive.`
              : `${FIXED_ROUNDS} rounds, scored by how few moves it takes.`}
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {(phase === 'playing' || phase === 'roundResult') && current && (
        <div>
          {isEndless ? (
            <EndlessHud round={rounds.length} lives={lives} />
          ) : (
            <RoundProgress index={currentIndex} total={FIXED_ROUNDS} />
          )}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'baseline',
                gap: 5,
                padding: '6px 16px',
                border: '1px solid var(--border)',
                borderRadius: 999,
                fontSize: 13,
                color: 'var(--text-dim)',
              }}
            >
              <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 15 }}>
                {current.moves}
              </span>
              moves
            </div>
          </div>
          <div
            ref={gridRef}
            style={{
              padding: GRID_PADDING,
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-card)',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${gridColumns}, ${cardSize}px)`,
                justifyContent: 'center',
                gap: CARD_GAP,
              }}
            >
              {current.cards.map((card) => (
                <MatchCard
                  key={card.id}
                  card={card}
                  size={cardSize}
                  faceUp={card.matched || flipped.includes(card.id)}
                  onClick={() => handleCardClick(card.id)}
                />
              ))}
            </div>
          </div>

          {phase === 'roundResult' && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                  color: current.score >= 70 ? 'var(--success)' : 'var(--text-faint)',
                }}
              >
                {current.moves} moves · {current.pairCount} pairs
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, margin: '6px 0 20px' }}>
                {current.score}
                <span style={{ fontSize: 16, color: 'var(--text-faint)' }}>/100</span>
              </div>
              <PlayButton onClick={nextRound} label={isRunOver ? 'See results' : 'Next round'} />
            </div>
          )}
        </div>
      )}

      {phase === 'done' && (
        <div>
          {!isEndless && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {rounds.map((r, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 14,
                    color: 'var(--text-dim)',
                  }}
                >
                  <span>Round {i + 1}</span>
                  <span>{r.moves} moves</span>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>{r.score}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>
              {isEndless ? 'ROUNDS SURVIVED' : 'AVERAGE SCORE'}
            </div>
            <div style={{ fontSize: 44, fontWeight: 700, margin: '4px 0 24px' }}>
              {isEndless
                ? rounds.length
                : (rounds.reduce((s, r) => s + r.score, 0) / rounds.length).toFixed(1)}
            </div>
            {onPlayAgain ? (
              <PlayButton onClick={onPlayAgain} label="Play again" />
            ) : (
              <div style={{ color: 'var(--text-dim)', fontSize: 14 }}>
                Come back tomorrow for a new Daily.
              </div>
            )}
          </div>
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <LinkButton onClick={onChangeMode} label="Change mode" />
          </div>
          {config.mode !== 'practice' && (
            <LocalLeaderboard
              runs={runs}
              formatScore={isEndless ? (s) => `${s.toFixed(0)} rounds` : undefined}
            />
          )}
        </div>
      )}
    </div>
  )
}

function MatchCard({
  card,
  size,
  faceUp,
  onClick,
}: {
  card: CardData
  size: number
  faceUp: boolean
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={card.matched}
      aria-label={card.matched ? 'matched card' : faceUp ? 'revealed card' : 'hidden card'}
      style={{
        width: size,
        height: size,
        flex: '0 0 auto',
        border: 'none',
        background: 'none',
        padding: 0,
        cursor: card.matched ? 'default' : 'pointer',
        perspective: 600,
        transform: card.matched
          ? 'scale(0.92)'
          : hovered && !faceUp
            ? 'translateY(-2px)'
            : 'none',
        opacity: card.matched ? 0.55 : 1,
        transition: 'transform 0.2s ease, opacity 0.3s ease 0.15s',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          transformStyle: 'preserve-3d',
          transition: 'transform 0.45s cubic-bezier(0.2, 0.85, 0.3, 1.1)',
          transform: faceUp ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {/* face-down */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backfaceVisibility: 'hidden',
            borderRadius: 'var(--radius-md)',
            border: `1px solid ${hovered && !faceUp && !card.matched ? 'var(--accent)' : 'var(--border)'}`,
            background: 'var(--bg-raised)',
            backgroundImage: 'radial-gradient(var(--border) 1.4px, transparent 1.4px)',
            backgroundSize: '12px 12px',
            backgroundPosition: 'center',
            transition: 'border-color 0.15s ease',
          }}
        />
        {/* face-up */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            borderRadius: 'var(--radius-md)',
            border: `1px solid ${card.color}`,
            background: card.color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {card.matched && <MatchCheckIcon />}
        </div>
      </div>
    </button>
  )
}

function MatchCheckIcon() {
  return (
    <div
      style={{
        width: '46%',
        height: '46%',
        borderRadius: '50%',
        background: 'var(--bg-card)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width="60%" height="60%" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 12.5L9.5 18L20 6"
          stroke="var(--success)"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

function RoundProgress({ index, total }: { index: number; total: number }) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 16 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 24,
            height: 3,
            borderRadius: 2,
            background: i <= index ? 'var(--accent)' : 'var(--border)',
          }}
        />
      ))}
    </div>
  )
}

function EndlessHud({ round, lives }: { round: number; lives: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        marginBottom: 16,
        fontSize: 13,
        color: 'var(--text-dim)',
      }}
    >
      <span>Round {round}</span>
      <span style={{ display: 'flex', gap: 4 }}>
        {Array.from({ length: ENDLESS_LIVES }).map((_, i) => (
          <span
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: i < lives ? 'var(--danger)' : 'var(--border)',
            }}
          />
        ))}
      </span>
    </div>
  )
}

function PlayButton({ onClick, label }: { onClick: () => void; label: string }) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--accent)',
        color: 'var(--accent-text)',
        border: 'none',
        borderRadius: 999,
        padding: '14px 32px',
        fontSize: 16,
        fontWeight: 600,
        cursor: 'pointer',
        transform: hovered ? 'translateY(-1px) scale(1.02)' : 'none',
        boxShadow: hovered ? '0 8px 20px -6px var(--accent)' : 'none',
        transition: 'transform 150ms ease, box-shadow 150ms ease',
      }}
    >
      {label}
    </button>
  )
}

function LinkButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        color: 'var(--text-faint)',
        fontSize: 13,
        cursor: 'pointer',
        textDecoration: 'underline',
      }}
    >
      {label}
    </button>
  )
}
