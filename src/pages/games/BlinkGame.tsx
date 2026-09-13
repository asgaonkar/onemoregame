import { useEffect, useState } from 'react'
import { GameShell } from '../../components/GameShell'
import { LocalLeaderboard } from '../../components/LocalLeaderboard'
import { addRun, getRuns } from '../../lib/leaderboard'

const GAME_ID = 'blink'
const ROUNDS = 5
const PREVIEW_MS = 1700

// Shapes live in percentage-space (0-100) so nothing needs the board's real
// pixel size until a click actually happens — the board is a square
// (aspect-ratio 1/1) so a single percent scale works for both x and y.
type ShapeKind = 'circle' | 'square'
type Shape = {
  id: number
  x: number
  y: number
  size: number
  color: string
  kind: ShapeKind
}
type ModType = 'move' | 'color' | 'size'

type Round = {
  shapes: Shape[]
  modifiedShapes: Shape[]
  changedIndex: number
  modType: ModType
  guess: { xPct: number; yPct: number } | null
  distance: number
  hit: boolean
  score: number
}

const COLORS = [
  '#f97316',
  '#eab308',
  '#14b8a6',
  '#06b6d4',
  '#8b5cf6',
  '#ec4899',
  '#84cc16',
  '#f43f5e',
]

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function pickColor(exclude?: string): string {
  const options = exclude ? COLORS.filter((c) => c !== exclude) : COLORS
  return options[Math.floor(Math.random() * options.length)]
}

function randomShapes(count: number): Shape[] {
  const shapes: Shape[] = []
  let attempts = 0
  while (shapes.length < count && attempts < count * 60) {
    attempts++
    const size = 10 + Math.random() * 8
    const margin = size / 2 + 4
    const x = margin + Math.random() * (100 - 2 * margin)
    const y = margin + Math.random() * (100 - 2 * margin)
    const overlaps = shapes.some(
      (s) => Math.hypot(x - s.x, y - s.y) < (size + s.size) / 2 + 3,
    )
    if (overlaps) continue
    shapes.push({
      id: shapes.length,
      x,
      y,
      size,
      color: pickColor(),
      kind: Math.random() < 0.5 ? 'circle' : 'square',
    })
  }
  return shapes
}

function moveShape(shapes: Shape[], idx: number): Shape[] {
  const modified = shapes.map((s) => ({ ...s }))
  const target = modified[idx]
  const margin = target.size / 2 + 4
  let attempts = 0
  while (attempts < 60) {
    attempts++
    const angle = Math.random() * Math.PI * 2
    const dist = 15 + Math.random() * 20
    const nx = clamp(target.x + Math.cos(angle) * dist, margin, 100 - margin)
    const ny = clamp(target.y + Math.sin(angle) * dist, margin, 100 - margin)
    const overlaps = modified.some(
      (s, i) =>
        i !== idx && Math.hypot(nx - s.x, ny - s.y) < (target.size + s.size) / 2 + 3,
    )
    if (!overlaps) {
      target.x = nx
      target.y = ny
      return modified
    }
  }
  // Fallback: place it wherever fits, overlap constraint relaxed.
  target.x = clamp(target.x + 20, margin, 100 - margin)
  target.y = clamp(target.y + 20, margin, 100 - margin)
  return modified
}

function resizeShape(shapes: Shape[], idx: number): Shape[] {
  const modified = shapes.map((s) => ({ ...s }))
  const target = modified[idx]
  const grow = target.size < 16 || Math.random() < 0.5
  target.size = clamp(grow ? target.size * 1.8 : target.size * 0.5, 6, 26)
  return modified
}

function recolorShape(shapes: Shape[], idx: number): Shape[] {
  const modified = shapes.map((s) => ({ ...s }))
  const target = modified[idx]
  target.color = pickColor(target.color)
  return modified
}

function generateRound(): Round {
  const count = 6 + Math.floor(Math.random() * 5) // 6-10
  const shapes = randomShapes(count)
  const changedIndex = Math.floor(Math.random() * shapes.length)
  const modType: ModType = (['move', 'color', 'size'] as ModType[])[
    Math.floor(Math.random() * 3)
  ]
  const modifiedShapes =
    modType === 'move'
      ? moveShape(shapes, changedIndex)
      : modType === 'color'
        ? recolorShape(shapes, changedIndex)
        : resizeShape(shapes, changedIndex)

  return {
    shapes,
    modifiedShapes,
    changedIndex,
    modType,
    guess: null,
    distance: 0,
    hit: false,
    score: 0,
  }
}

const MOD_LABEL: Record<ModType, string> = {
  move: 'Moved',
  color: 'Changed color',
  size: 'Changed size',
}

export function BlinkGame() {
  const [phase, setPhase] = useState<
    'intro' | 'preview' | 'guessing' | 'roundResult' | 'done'
  >('intro')
  const [rounds, setRounds] = useState<Round[]>([])
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, 'daily'))

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]

  useEffect(() => {
    if (phase !== 'preview') return
    const timer = setTimeout(() => setPhase('guessing'), PREVIEW_MS)
    return () => clearTimeout(timer)
  }, [phase, currentIndex])

  function startGame() {
    setRounds([generateRound()])
    setPhase('preview')
  }

  function handleBoardClick(e: React.MouseEvent<HTMLDivElement>) {
    if (phase !== 'guessing' || !current || current.guess) return
    const rect = e.currentTarget.getBoundingClientRect()
    const xPct = ((e.clientX - rect.left) / rect.width) * 100
    const yPct = ((e.clientY - rect.top) / rect.height) * 100
    const target = current.modifiedShapes[current.changedIndex]
    const distPct = Math.hypot(xPct - target.x, yPct - target.y)
    const hitRadiusPct = target.size / 2 + 6
    const hit = distPct <= hitRadiusPct
    const distance = (distPct / 100) * rect.width
    const score = hit ? 100 : 0

    setRounds((rs) =>
      rs.map((r, i) =>
        i === currentIndex
          ? { ...r, guess: { xPct, yPct }, distance, hit, score }
          : r,
      ),
    )
    setPhase('roundResult')
  }

  function nextRound() {
    if (rounds.length >= ROUNDS) {
      const total = rounds.reduce((sum, r) => sum + r.score, 0) / rounds.length
      const updated = addRun(GAME_ID, 'daily', total)
      setRuns(updated)
      setPhase('done')
      return
    }
    setRounds((rs) => [...rs, generateRound()])
    setPhase('preview')
  }

  function playAgain() {
    setRounds([])
    setPhase('intro')
  }

  return (
    <GameShell eyebrow="Perception" title="Blink">
      {phase === 'intro' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--text-dim)', maxWidth: 420, margin: '0 auto 28px' }}>
            Study the shapes, then spot the one that changed. {ROUNDS} rounds,
            100 points for a clean catch.
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {(phase === 'preview' || phase === 'guessing' || phase === 'roundResult') &&
        current && (
          <div>
            <RoundProgress index={currentIndex} total={ROUNDS} />
            <div
              style={{
                textAlign: 'center',
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: 0.4,
                color: 'var(--text-faint)',
                textTransform: 'uppercase',
                marginBottom: 10,
                height: 16,
              }}
            >
              {phase === 'preview' && 'Memorize'}
              {phase === 'guessing' && 'What changed?'}
              {phase === 'roundResult' && (current.hit ? 'Nice catch' : 'Missed it')}
            </div>
            <div
              onClick={handleBoardClick}
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '1 / 1',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--bg-card)',
                overflow: 'hidden',
                cursor: phase === 'guessing' ? 'pointer' : 'default',
                touchAction: 'manipulation',
              }}
            >
              {(phase === 'preview' ? current.shapes : current.modifiedShapes).map(
                (s) => (
                  <ShapeView key={s.id} shape={s} />
                ),
              )}

              {phase === 'roundResult' && (
                <>
                  <RingMarker
                    xPct={current.modifiedShapes[current.changedIndex].x}
                    yPct={current.modifiedShapes[current.changedIndex].y}
                    size={current.modifiedShapes[current.changedIndex].size}
                    color="var(--success)"
                  />
                  {current.guess && !current.hit && (
                    <ClickMarker
                      xPct={current.guess.xPct}
                      yPct={current.guess.yPct}
                      color="var(--danger)"
                    />
                  )}
                </>
              )}
            </div>

            {phase === 'roundResult' && (
              <div style={{ textAlign: 'center', marginTop: 20 }}>
                <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
                  {MOD_LABEL[current.modType]} · {current.distance.toFixed(0)}px away
                </div>
                <div style={{ fontSize: 32, fontWeight: 700, margin: '4px 0 20px' }}>
                  {current.score.toFixed(0)}
                  <span style={{ fontSize: 16, color: 'var(--text-faint)' }}>/100</span>
                </div>
                <PlayButton
                  onClick={nextRound}
                  label={rounds.length >= ROUNDS ? 'See results' : 'Next round'}
                />
              </div>
            )}
          </div>
        )}

      {phase === 'done' && (
        <div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              marginBottom: 20,
            }}
          >
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
                <span>{MOD_LABEL[r.modType]}</span>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                  {r.score.toFixed(0)}
                </span>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>
              AVERAGE SCORE
            </div>
            <div style={{ fontSize: 44, fontWeight: 700, margin: '4px 0 24px' }}>
              {(rounds.reduce((s, r) => s + r.score, 0) / rounds.length).toFixed(1)}
            </div>
            <PlayButton onClick={playAgain} label="Play again" />
          </div>
          <LocalLeaderboard runs={runs} />
        </div>
      )}
    </GameShell>
  )
}

function RoundProgress({ index, total }: { index: number; total: number }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        justifyContent: 'center',
        marginBottom: 16,
      }}
    >
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

function ShapeView({ shape }: { shape: Shape }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${shape.x}%`,
        top: `${shape.y}%`,
        width: `${shape.size}%`,
        height: `${shape.size}%`,
        transform: 'translate(-50%, -50%)',
        borderRadius: shape.kind === 'circle' ? '50%' : '18%',
        background: shape.color,
      }}
    />
  )
}

function RingMarker({
  xPct,
  yPct,
  size,
  color,
}: {
  xPct: number
  yPct: number
  size: number
  color: string
}) {
  const ringSize = size + 10
  return (
    <div
      style={{
        position: 'absolute',
        left: `${xPct}%`,
        top: `${yPct}%`,
        width: `${ringSize}%`,
        height: `${ringSize}%`,
        transform: 'translate(-50%, -50%)',
        borderRadius: '50%',
        border: `3px solid ${color}`,
        boxSizing: 'border-box',
        pointerEvents: 'none',
      }}
    />
  )
}

function ClickMarker({
  xPct,
  yPct,
  color,
}: {
  xPct: number
  yPct: number
  color: string
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${xPct}%`,
        top: `${yPct}%`,
        width: 12,
        height: 12,
        marginLeft: -6,
        marginTop: -6,
        borderRadius: '50%',
        background: color,
        boxShadow: '0 0 0 3px var(--bg-card)',
      }}
    />
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
