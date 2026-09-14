import { useEffect, useMemo, useState } from 'react'
import { GameShell } from '../../components/GameShell'
import { GameModeSelect } from '../../components/GameModeSelect'
import { VsSequencer } from '../../components/VsSequencer'
import { LocalLeaderboard } from '../../components/LocalLeaderboard'
import { addRun, getRuns } from '../../lib/leaderboard'
import {
  createRunConfig,
  difficultyForRound,
  ENDLESS_LIVES,
  FIXED_ROUNDS,
  isMiss,
  markDailyPlayed,
  rngFor,
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

  function makeRound(roundNum: number): Round {
    const t = difficultyForRound(roundNum, config.mode)
    const pairCount = pairCountFor(t)
    return { t, pairCount, cards: buildCards(rng, pairCount, t), moves: 0, score: 0 }
  }

  function startGame() {
    setRounds([makeRound(1)])
    setFlipped([])
    setResolving(false)
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
      return
    }

    setResolving(true)
    setRounds((rs) => rs.map((r, i) => (i === currentIndex ? { ...r, moves: newMoves } : r)))
    setTimeout(() => {
      setFlipped([])
      setResolving(false)
    }, MISMATCH_PAUSE_MS)
  }

  function finish(finalScore: number) {
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
          <div
            style={{
              textAlign: 'center',
              fontSize: 13,
              color: 'var(--text-dim)',
              marginBottom: 10,
            }}
          >
            Moves: {current.moves}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
              gap: 10,
              padding: 14,
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-card)',
            }}
          >
            {current.cards.map((card) => (
              <MatchCard
                key={card.id}
                card={card}
                faceUp={card.matched || flipped.includes(card.id)}
                onClick={() => handleCardClick(card.id)}
              />
            ))}
          </div>

          {phase === 'roundResult' && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
                {current.moves} moves · {current.pairCount} pairs
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, margin: '4px 0 20px' }}>
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
  faceUp,
  onClick,
}: {
  card: CardData
  faceUp: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={card.matched}
      style={{
        aspectRatio: '1 / 1',
        border: `1px solid ${faceUp ? card.color : 'var(--border)'}`,
        borderRadius: 'var(--radius-md)',
        background: faceUp ? card.color : 'var(--bg)',
        opacity: card.matched ? 0.5 : 1,
        cursor: card.matched ? 'default' : 'pointer',
        padding: 0,
        transition: 'background 0.15s ease, opacity 0.15s ease',
      }}
      aria-label={faceUp ? 'revealed card' : 'hidden card'}
    />
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
  return (
    <button
      onClick={onClick}
      style={{
        background: 'var(--accent)',
        color: 'var(--accent-text)',
        border: 'none',
        borderRadius: 999,
        padding: '14px 32px',
        fontSize: 16,
        fontWeight: 600,
        cursor: 'pointer',
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
