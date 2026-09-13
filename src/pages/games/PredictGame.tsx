import { useEffect, useMemo, useRef, useState } from 'react'
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

const GAME_ID = 'predict'

// Prediction horizon: how far past the visible window the dot keeps
// travelling (invisibly) before the target moment we score against.
// Scales with difficulty t (0 -> 1): a further-out target is harder to
// extrapolate to.
const HORIZON_BASE_SECONDS = 0.9
const HORIZON_RANGE_SECONDS = 0.9

// Minimum start->truePoint distance also scales with t: a longer
// trajectory over roughly the same window means a faster-moving dot,
// which is harder to track and extrapolate.
const MIN_DIST_BASE = 28
const MIN_DIST_RANGE = 47

// All positions/velocities live in percentage-space (0-100), so a round
// can be generated before the board exists (e.g. on the intro screen)
// without measuring any DOM node. Only the click handler needs the
// board's real pixel rect, and the board always exists by then.
type Point = { x: number; y: number }
type Velocity = { vx: number; vy: number }

type Round = {
  start: Point
  velocity: Velocity
  visibleDuration: number
  lastVisible: Point
  truePoint: Point
  guess: Point | null
  distance: number
  score: number
}

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function randomPoint(rng: Rng, margin: number): Point {
  return {
    x: margin + rng() * (100 - margin * 2),
    y: margin + rng() * (100 - margin * 2),
  }
}

// A straight line between two points inside a convex region (our square
// board) never leaves that region, so picking both the start and the
// eventual true point at random inside a margin guarantees the whole
// trajectory — visible and hidden portions alike — stays on-board.
// Distance between them (and therefore speed, since duration is mostly
// fixed per round) grows with difficulty t for a consistent ramp.
function makeRound(rng: Rng, roundNum: number, mode: RunConfig['mode']): Round {
  const t = difficultyForRound(roundNum, mode)
  const margin = 12
  const visibleDuration = 1.5 + rng() * 0.5
  const horizon = HORIZON_BASE_SECONDS + t * HORIZON_RANGE_SECONDS
  const totalTime = visibleDuration + horizon

  const start = randomPoint(rng, margin)
  const minDist = MIN_DIST_BASE + t * MIN_DIST_RANGE
  let truePoint = randomPoint(rng, margin)
  let attempts = 0
  while (dist(start, truePoint) < minDist && attempts < 20) {
    truePoint = randomPoint(rng, margin)
    attempts++
  }

  const velocity: Velocity = {
    vx: (truePoint.x - start.x) / totalTime,
    vy: (truePoint.y - start.y) / totalTime,
  }
  const lastVisible: Point = {
    x: start.x + velocity.vx * visibleDuration,
    y: start.y + velocity.vy * visibleDuration,
  }

  return {
    start,
    velocity,
    visibleDuration,
    lastVisible,
    truePoint,
    guess: null,
    distance: 0,
    score: 0,
  }
}

export function PredictGame() {
  const [config, setConfig] = useState<RunConfig | null>(null)

  return (
    <GameShell eyebrow="Timing" title="Predict">
      {!config ? (
        <GameModeSelect gameId={GAME_ID} onStart={setConfig} />
      ) : config.mode === 'vs' && config.vs ? (
        <VsSequencer
          playerCount={config.vs.playerCount}
          seed={config.seed}
          onExit={() => setConfig(null)}
          renderRun={(runConfig, onFinish) => (
            <PredictRun
              key={`${runConfig.seed}-${runConfig.vs?.playerIndex ?? 0}`}
              config={runConfig}
              onFinish={onFinish}
              onChangeMode={() => setConfig(null)}
            />
          )}
        />
      ) : (
        <PredictRun
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

function PredictRun({
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

  const [phase, setPhase] = useState<'intro' | 'playing' | 'roundResult' | 'done'>(
    'intro',
  )
  const [rounds, setRounds] = useState<Round[]>([])
  const [lives, setLives] = useState(ENDLESS_LIVES)
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, config.mode))
  const [pos, setPos] = useState<Point>({ x: 50, y: 50 })
  const [dotVisible, setDotVisible] = useState(false)
  const [canGuess, setCanGuess] = useState(false)
  const rafRef = useRef<number | null>(null)

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]

  // Drives the visible portion of the dot's motion. Runs only while
  // playing a round; cancels cleanly on round change/unmount.
  useEffect(() => {
    if (phase !== 'playing' || !current) return

    setPos(current.start)
    setDotVisible(true)
    setCanGuess(false)

    const startTime = performance.now()

    function frame(now: number) {
      const elapsed = (now - startTime) / 1000
      if (elapsed >= current.visibleDuration) {
        setPos(current.lastVisible)
        setDotVisible(false)
        setCanGuess(true)
        rafRef.current = null
        return
      }
      setPos({
        x: current.start.x + current.velocity.vx * elapsed,
        y: current.start.y + current.velocity.vy * elapsed,
      })
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    // current is derived from rounds/currentIndex; re-running on either
    // covers every new round while keeping the same round's identity stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentIndex])

  function startGame() {
    setRounds([makeRound(rng, 1, config.mode)])
    setLives(ENDLESS_LIVES)
    setPhase('playing')
  }

  function handleStageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (phase !== 'playing' || !canGuess || !current || current.guess) return
    const rect = e.currentTarget.getBoundingClientRect()
    const guess: Point = {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    }
    const distPx = Math.hypot(
      ((guess.x - current.truePoint.x) / 100) * rect.width,
      ((guess.y - current.truePoint.y) / 100) * rect.height,
    )
    const maxDist = Math.hypot(rect.width, rect.height) * 0.3
    const score = Math.max(0, 100 * (1 - distPx / maxDist))

    setRounds((rs) =>
      rs.map((r, i) =>
        i === currentIndex ? { ...r, guess, distance: distPx, score } : r,
      ),
    )
    if (isEndless && isMiss(score)) setLives((l) => l - 1)
    setCanGuess(false)
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
      setRounds((rs) => [...rs, makeRound(rng, rs.length + 1, config.mode)])
      setPhase('playing')
      return
    }
    if (rounds.length >= FIXED_ROUNDS) {
      finish(rounds.reduce((sum, r) => sum + r.score, 0) / rounds.length)
      return
    }
    setRounds((rs) => [...rs, makeRound(rng, rs.length + 1, config.mode)])
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
            Watch the dot move, then click where it would be a moment after it
            vanishes.{' '}
            {isEndless
              ? `${ENDLESS_LIVES} lives — it gets harder the longer you survive.`
              : `${FIXED_ROUNDS} rounds, scored by how close you land.`}
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
            onClick={handleStageClick}
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '4 / 3',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-card)',
              overflow: 'hidden',
              cursor: canGuess ? 'crosshair' : 'default',
              touchAction: 'manipulation',
            }}
          >
            {phase === 'playing' && dotVisible && (
              <Dot xPct={pos.x} yPct={pos.y} color="var(--accent)" />
            )}

            {phase === 'roundResult' && current.guess && (
              <>
                <svg
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                  }}
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  <line
                    x1={current.lastVisible.x}
                    y1={current.lastVisible.y}
                    x2={current.truePoint.x}
                    y2={current.truePoint.y}
                    stroke="var(--text-faint)"
                    strokeWidth={0.5}
                    strokeDasharray="2,2"
                    vectorEffect="non-scaling-stroke"
                  />
                  <line
                    x1={current.guess.x}
                    y1={current.guess.y}
                    x2={current.truePoint.x}
                    y2={current.truePoint.y}
                    stroke={current.score >= 70 ? 'var(--success)' : 'var(--danger)'}
                    strokeWidth={0.6}
                    strokeDasharray="3,3"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                <Dot
                  xPct={current.truePoint.x}
                  yPct={current.truePoint.y}
                  color="var(--accent)"
                />
                <Dot
                  xPct={current.guess.x}
                  yPct={current.guess.y}
                  color={current.score >= 70 ? 'var(--success)' : 'var(--danger)'}
                />
              </>
            )}
          </div>

          {phase === 'roundResult' && current.guess && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
                {current.distance.toFixed(0)}px off
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
                  <span>{r.distance.toFixed(0)}px off</span>
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

function Dot({
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
