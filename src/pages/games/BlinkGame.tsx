import { useEffect, useMemo, useRef, useState } from 'react'
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

const GAME_ID = 'blink'

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
  previewMs: number
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

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function pickColor(rng: Rng, exclude?: string): string {
  const options = exclude ? COLORS.filter((c) => c !== exclude) : COLORS
  return options[Math.floor(rng() * options.length)]
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

// t: 0 (easiest) -> 1 (hardest). At t=0 the replacement color is picked from
// the whole palette (often very different); at t=1 it's restricted to the
// hue-closest color(s), making the swap much subtler to spot.
function pickCloseColor(rng: Rng, current: string, t: number): string {
  const candidates = COLORS.filter((c) => c !== current)
    .map((c) => ({ c, diff: hueDiff(hexToHue(c), hexToHue(current)) }))
    .sort((a, b) => a.diff - b.diff)
  const poolSize = Math.max(1, Math.round(candidates.length * (1 - 0.8 * t)))
  const pool = candidates.slice(0, poolSize)
  return pool[Math.floor(rng() * pool.length)].c
}

function randomShapes(rng: Rng, count: number): Shape[] {
  const shapes: Shape[] = []
  let attempts = 0
  while (shapes.length < count && attempts < count * 60) {
    attempts++
    const size = 10 + rng() * 8
    const margin = size / 2 + 4
    const x = margin + rng() * (100 - 2 * margin)
    const y = margin + rng() * (100 - 2 * margin)
    const overlaps = shapes.some(
      (s) => Math.hypot(x - s.x, y - s.y) < (size + s.size) / 2 + 3,
    )
    if (overlaps) continue
    shapes.push({
      id: shapes.length,
      x,
      y,
      size,
      color: pickColor(rng),
      kind: rng() < 0.5 ? 'circle' : 'square',
    })
  }
  return shapes
}

// t: 0 (easiest) -> 1 (hardest). Harder rounds move the shape a shorter
// distance, making the change subtler to spot.
function moveShape(rng: Rng, shapes: Shape[], idx: number, t: number): Shape[] {
  const modified = shapes.map((s) => ({ ...s }))
  const target = modified[idx]
  const margin = target.size / 2 + 4
  const distMin = lerp(15, 8, t)
  const distMax = lerp(35, 14, t)
  let attempts = 0
  while (attempts < 60) {
    attempts++
    const angle = rng() * Math.PI * 2
    const dist = distMin + rng() * (distMax - distMin)
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
  target.x = clamp(target.x + distMin, margin, 100 - margin)
  target.y = clamp(target.y + distMin, margin, 100 - margin)
  return modified
}

// t: 0 (easiest) -> 1 (hardest). Harder rounds change the size by a smaller
// factor, making the change subtler to spot.
function resizeShape(rng: Rng, shapes: Shape[], idx: number, t: number): Shape[] {
  const modified = shapes.map((s) => ({ ...s }))
  const target = modified[idx]
  const growFactor = lerp(1.8, 1.15, t)
  const shrinkFactor = lerp(0.5, 0.85, t)
  const grow = target.size < 16 || rng() < 0.5
  target.size = clamp(grow ? target.size * growFactor : target.size * shrinkFactor, 6, 26)
  return modified
}

function recolorShape(rng: Rng, shapes: Shape[], idx: number, t: number): Shape[] {
  const modified = shapes.map((s) => ({ ...s }))
  const target = modified[idx]
  target.color = pickCloseColor(rng, target.color, t)
  return modified
}

function generateRound(rng: Rng, roundNum: number, mode: GameMode): Round {
  const t = difficultyForRound(roundNum, mode)
  const count = clamp(6 + Math.floor(rng() * 5) + Math.round(t * 3), 6, 13)
  const shapes = randomShapes(rng, count)
  const changedIndex = Math.floor(rng() * shapes.length)
  const modType: ModType = (['move', 'color', 'size'] as ModType[])[
    Math.floor(rng() * 3)
  ]
  const modifiedShapes =
    modType === 'move'
      ? moveShape(rng, shapes, changedIndex, t)
      : modType === 'color'
        ? recolorShape(rng, shapes, changedIndex, t)
        : resizeShape(rng, shapes, changedIndex, t)
  const previewMs = Math.round(lerp(1700, 800, t))

  return {
    shapes,
    modifiedShapes,
    changedIndex,
    modType,
    previewMs,
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

// Pause between the first blink (original) and the second blink (modified),
// giving the two flashes a real gap instead of a snappy sub-second flicker.
const BLINK_GAP_MS = 1500

export function BlinkGame() {
  const [config, setConfig] = useState<RunConfig | null>(null)

  return (
    <GameShell eyebrow="Perception" title="Blink">
      {!config ? (
        <GameModeSelect gameId={GAME_ID} onStart={setConfig} />
      ) : config.mode === 'vs' && config.vs ? (
        <VsSequencer
          playerCount={config.vs.playerCount}
          seed={config.seed}
          onExit={() => setConfig(null)}
          renderRun={(runConfig, onFinish) => (
            <BlinkRun
              key={`${runConfig.seed}-${runConfig.vs?.playerIndex ?? 0}`}
              config={runConfig}
              onFinish={onFinish}
              onChangeMode={() => setConfig(null)}
            />
          )}
        />
      ) : (
        <BlinkRun
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

function BlinkRun({
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

  const [phase, setPhase] = useState<
    'intro' | 'preview' | 'blank' | 'preview2' | 'guessing' | 'roundResult' | 'done'
  >('intro')
  const [rounds, setRounds] = useState<Round[]>([])
  const [lives, setLives] = useState(ENDLESS_LIVES)
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, config.mode))

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]
  // Guards against a round being scored twice — e.g. a rapid double-tap on
  // the board before React re-renders and `current.guess` reflects it.
  const processedRef = useRef(-1)

  // Two-blink flash sequence: original (preview) -> blank gap -> modified
  // (preview2) -> interactive guessing. Each timed phase advances itself.
  useEffect(() => {
    if (!current) return
    if (phase === 'preview') {
      const timer = setTimeout(() => setPhase('blank'), current.previewMs)
      return () => clearTimeout(timer)
    }
    if (phase === 'blank') {
      const timer = setTimeout(() => setPhase('preview2'), BLINK_GAP_MS)
      return () => clearTimeout(timer)
    }
    if (phase === 'preview2') {
      const timer = setTimeout(() => setPhase('guessing'), current.previewMs)
      return () => clearTimeout(timer)
    }
  }, [phase, currentIndex, current])

  function makeRound(roundNum: number): Round {
    return generateRound(rng, roundNum, config.mode)
  }

  function startGame() {
    setRounds([makeRound(1)])
    setLives(ENDLESS_LIVES)
    setPhase('preview')
  }

  function handleBoardClick(e: React.MouseEvent<HTMLDivElement>) {
    if (
      phase !== 'guessing' ||
      !current ||
      current.guess ||
      processedRef.current === currentIndex
    )
      return
    processedRef.current = currentIndex
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
        i === currentIndex ? { ...r, guess: { xPct, yPct }, distance, hit, score } : r,
      ),
    )
    if (isEndless && isMiss(score)) setLives((l) => l - 1)
    setPhase('roundResult')
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
    if (isEndless) {
      if (lives <= 0) {
        finish(rounds.length)
        return
      }
      setRounds((rs) => [...rs, makeRound(rs.length + 1)])
      setPhase('preview')
      return
    }
    if (rounds.length >= FIXED_ROUNDS) {
      finish(rounds.reduce((s, r) => s + r.score, 0) / rounds.length)
      return
    }
    setRounds((rs) => [...rs, makeRound(rs.length + 1)])
    setPhase('preview')
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
            Study the shapes, then spot the one that changed.{' '}
            {isEndless
              ? `${ENDLESS_LIVES} lives — it gets harder the longer you survive.`
              : `${FIXED_ROUNDS} rounds, 100 points for a clean catch.`}
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {(phase === 'preview' ||
        phase === 'blank' ||
        phase === 'preview2' ||
        phase === 'guessing' ||
        phase === 'roundResult') &&
        current && (
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
                fontWeight: 600,
                letterSpacing: 0.4,
                color: 'var(--text-faint)',
                textTransform: 'uppercase',
                marginBottom: 10,
                height: 16,
              }}
            >
              {phase === 'preview' && 'Memorize'}
              {phase === 'preview2' && 'Look again'}
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
              {phase !== 'blank' &&
                (phase === 'preview' ? current.shapes : current.modifiedShapes).map(
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
                  label={isRunOver ? 'See results' : 'Next round'}
                />
              </div>
            )}
          </div>
        )}

      {phase === 'done' && (
        <div>
          {!isEndless && (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}
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
