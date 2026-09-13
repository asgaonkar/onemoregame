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

const GAME_ID = 'trace'
const RESAMPLE_COUNT = 40
// Calibrated in percentage-space (board is 0-100 on each axis): a careful
// retrace lands well under this, a careless scribble lands at or above it.
const MAX_REASONABLE_DIST = 50

// t: 0 (easiest) -> 1 (hardest). Harder rounds get more waypoints and a
// shorter memorize window.
const MIN_WAYPOINTS = 4
const MAX_WAYPOINTS = 8
const MIN_SHOW_DURATION_MS = 1100
const MAX_SHOW_DURATION_MS = 2500

function waypointCountFor(t: number): number {
  return Math.round(MIN_WAYPOINTS + (MAX_WAYPOINTS - MIN_WAYPOINTS) * t)
}

function showDurationFor(t: number): number {
  return Math.round(MAX_SHOW_DURATION_MS - (MAX_SHOW_DURATION_MS - MIN_SHOW_DURATION_MS) * t)
}

// Waypoints/points live in percentage space (0-100), just like CenterGame's
// boxes — no DOM measurement is needed to generate a round. The board only
// gets measured (getBoundingClientRect) inside pointer handlers, where it
// already exists on screen.
type Point = { x: number; y: number }

type Round = {
  path: Point[]
  drawn: Point[]
  avgDist: number
  score: number
  showDurationMs: number
}

function randomPath(rng: Rng, t: number): Point[] {
  const count = waypointCountFor(t)
  const margin = 12
  const points: Point[] = []
  for (let i = 0; i < count; i++) {
    points.push({
      x: margin + rng() * (100 - margin * 2),
      y: margin + rng() * (100 - margin * 2),
    })
  }
  return points
}

function pathLength(points: Point[]): number {
  let len = 0
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return len
}

// Walks the polyline at evenly-spaced arc-length intervals so two paths with
// different point densities (a 5-waypoint original vs. a dense drawn stroke)
// can be compared point-for-point.
function resample(points: Point[], count: number): Point[] {
  if (points.length === 0) return []
  if (points.length === 1) return Array.from({ length: count }, () => points[0])
  const total = pathLength(points)
  if (total === 0) return Array.from({ length: count }, () => points[0])

  const step = total / (count - 1)
  const result: Point[] = []
  let segIndex = 0
  let segStart = points[0]
  let segEnd = points[1]
  let segLen = Math.hypot(segEnd.x - segStart.x, segEnd.y - segStart.y)
  let accumulated = 0

  for (let i = 0; i < count; i++) {
    const targetDist = step * i
    while (accumulated + segLen < targetDist && segIndex < points.length - 2) {
      accumulated += segLen
      segIndex++
      segStart = points[segIndex]
      segEnd = points[segIndex + 1]
      segLen = Math.hypot(segEnd.x - segStart.x, segEnd.y - segStart.y)
    }
    const distIntoSeg = targetDist - accumulated
    const t = segLen === 0 ? 0 : Math.min(1, Math.max(0, distIntoSeg / segLen))
    result.push({
      x: segStart.x + (segEnd.x - segStart.x) * t,
      y: segStart.y + (segEnd.y - segStart.y) * t,
    })
  }
  return result
}

function scorePaths(
  original: Point[],
  drawn: Point[],
  maxReasonableDist: number,
): { avgDist: number; score: number } {
  if (drawn.length < 2) return { avgDist: maxReasonableDist, score: 0 }
  const a = resample(original, RESAMPLE_COUNT)
  const b = resample(drawn, RESAMPLE_COUNT)
  let sum = 0
  for (let i = 0; i < RESAMPLE_COUNT; i++) {
    sum += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y)
  }
  const avgDist = sum / RESAMPLE_COUNT
  const score = Math.max(0, Math.min(100, 100 * (1 - avgDist / maxReasonableDist)))
  return { avgDist, score }
}

function toPointsAttr(points: Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ')
}

function pointFromEvent(e: React.PointerEvent<HTMLDivElement>): Point {
  const rect = e.currentTarget.getBoundingClientRect()
  const x = ((e.clientX - rect.left) / rect.width) * 100
  const y = ((e.clientY - rect.top) / rect.height) * 100
  return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) }
}

export function TraceGame() {
  const [config, setConfig] = useState<RunConfig | null>(null)

  return (
    <GameShell eyebrow="Memory" title="Trace">
      {!config ? (
        <GameModeSelect gameId={GAME_ID} onStart={setConfig} />
      ) : config.mode === 'vs' && config.vs ? (
        <VsSequencer
          playerCount={config.vs.playerCount}
          seed={config.seed}
          onExit={() => setConfig(null)}
          renderRun={(runConfig, onFinish) => (
            <TraceRun
              key={`${runConfig.seed}-${runConfig.vs?.playerIndex ?? 0}`}
              config={runConfig}
              onFinish={onFinish}
              onChangeMode={() => setConfig(null)}
            />
          )}
        />
      ) : (
        <TraceRun
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

type Phase = 'intro' | 'memorize' | 'draw' | 'roundResult' | 'done'

function TraceRun({
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

  const [phase, setPhase] = useState<Phase>('intro')
  const [rounds, setRounds] = useState<Round[]>([])
  const [drawing, setDrawing] = useState<Point[]>([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [lives, setLives] = useState(ENDLESS_LIVES)
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, config.mode))

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]

  function makeRound(roundNum: number): Round {
    const t = difficultyForRound(roundNum, config.mode)
    return {
      path: randomPath(rng, t),
      drawn: [],
      avgDist: 0,
      score: 0,
      showDurationMs: showDurationFor(t),
    }
  }

  // Show the path for a window that shrinks with difficulty, then hide it
  // and let the player draw.
  useEffect(() => {
    if (phase !== 'memorize' || !current) return
    const t = setTimeout(() => setPhase('draw'), current.showDurationMs)
    return () => clearTimeout(t)
  }, [phase, current])

  function startGame() {
    setRounds([makeRound(1)])
    setDrawing([])
    setLives(ENDLESS_LIVES)
    setPhase('memorize')
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (phase !== 'draw') return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrawing([pointFromEvent(e)])
    setIsDrawing(true)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (phase !== 'draw' || !isDrawing) return
    // Compute the point synchronously — React (in StrictMode) can invoke a
    // functional setState updater more than once, and by a second
    // invocation the SyntheticEvent's currentTarget has been nulled out.
    const pt = pointFromEvent(e)
    setDrawing((pts) => [...pts, pt])
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (phase !== 'draw' || !isDrawing || !current) return
    setIsDrawing(false)
    const finalPoints =
      drawing.length > 0 ? [...drawing, pointFromEvent(e)] : [pointFromEvent(e)]
    const { avgDist, score } = scorePaths(current.path, finalPoints, MAX_REASONABLE_DIST)
    setRounds((rs) =>
      rs.map((r, i) =>
        i === currentIndex ? { ...r, drawn: finalPoints, avgDist, score } : r,
      ),
    )
    if (isEndless && isMiss(score)) setLives((l) => l - 1)
    setPhase('roundResult')
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
    if (isEndless) {
      if (lives <= 0) {
        finish(rounds.length)
        return
      }
      setRounds((rs) => [...rs, makeRound(rs.length + 1)])
      setDrawing([])
      setPhase('memorize')
      return
    }
    if (rounds.length >= FIXED_ROUNDS) {
      finish(rounds.reduce((sum, r) => sum + r.score, 0) / rounds.length)
      return
    }
    setRounds((rs) => [...rs, makeRound(rs.length + 1)])
    setDrawing([])
    setPhase('memorize')
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
            Watch the path, then redraw it from memory.{' '}
            {isEndless
              ? `${ENDLESS_LIVES} lives — it gets harder the longer you survive.`
              : `${FIXED_ROUNDS} rounds, scored by how closely you retrace it.`}
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {(phase === 'memorize' || phase === 'draw' || phase === 'roundResult') && current && (
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
              minHeight: 18,
            }}
          >
            {phase === 'memorize' && 'Memorize the path'}
            {phase === 'draw' && 'Draw it from memory'}
            {phase === 'roundResult' &&
              (current.score >= 70 ? 'Nice trace' : 'Here’s how it compared')}
          </div>
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '4 / 3',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-card)',
              overflow: 'hidden',
              cursor: phase === 'draw' ? 'crosshair' : 'default',
              touchAction: 'none',
            }}
          >
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            >
              {(phase === 'memorize' || phase === 'roundResult') && (
                <polyline
                  points={toPointsAttr(current.path)}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {phase === 'memorize' && (
                <circle
                  cx={current.path[0].x}
                  cy={current.path[0].y}
                  r={3}
                  fill="var(--accent)"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {(phase === 'draw' || phase === 'roundResult') &&
                (phase === 'draw' ? drawing : current.drawn).length > 1 && (
                  <polyline
                    points={toPointsAttr(phase === 'draw' ? drawing : current.drawn)}
                    fill="none"
                    stroke={
                      phase === 'roundResult'
                        ? current.score >= 70
                          ? 'var(--success)'
                          : 'var(--danger)'
                        : 'var(--text)'
                    }
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
            </svg>
          </div>

          {phase === 'roundResult' && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
                {current.avgDist.toFixed(1)} avg gap
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, margin: '4px 0 20px' }}>
                {current.score.toFixed(1)}
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
                  <span>{r.avgDist.toFixed(1)} avg gap</span>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                    {r.score.toFixed(1)}
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
