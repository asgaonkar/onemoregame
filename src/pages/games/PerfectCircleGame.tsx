import { useRef, useState } from 'react'
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
  type RunConfig,
} from '../../lib/modes'

const GAME_ID = 'perfect-circle'

// The board is a perfect square (aspect-ratio 1 / 1), so a percentage of its
// width and a percentage of its height are the same real-world distance.
// That's what lets us treat these percentage points as a plain 2D coordinate
// system (SVG viewBox "0 0 100 100") without ever measuring pixels.
type Point = { x: number; y: number }

type Round = {
  points: Point[]
  centroid: Point | null
  meanRadius: number
  score: number
  t: number // difficulty (0 easiest -> 1 hardest) this round was scored at
}

// t: 0 (easiest) -> 1 (hardest). No randomness needed to set a round up —
// the player draws freehand — only the scoring strictness scales with t.
function emptyRound(t: number): Round {
  return { points: [], centroid: null, meanRadius: 0, score: 0, t }
}

function avg(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length
}

// Fits a circle to the stroke (centroid + mean radius) and scores how
// consistent the radius is across all captured points. A perfect circle has
// zero variation; a wobbly stroke has high variation. We use the
// coefficient of variation (stddev / mean) so the score is scale-independent
// — a tiny circle and a huge circle drawn with the same relative wobble
// score the same. `t` (0 easiest -> 1 hardest, from difficultyForRound)
// scales up how harshly wobble and an unclosed loop are punished.
function scoreStroke(
  points: Point[],
  t: number,
): { centroid: Point; meanRadius: number; score: number } {
  const centroid = { x: avg(points.map((p) => p.x)), y: avg(points.map((p) => p.y)) }
  const radii = points.map((p) => Math.hypot(p.x - centroid.x, p.y - centroid.y))
  const meanRadius = avg(radii)

  if (points.length < 8 || meanRadius < 4) {
    return { centroid, meanRadius, score: 0 }
  }

  const variance = avg(radii.map((r) => (r - meanRadius) ** 2))
  const cv = Math.sqrt(variance) / meanRadius

  // Secondary penalty: how far apart the stroke's start and end points are,
  // relative to the radius — rewards actually closing the loop.
  const first = points[0]
  const last = points[points.length - 1]
  const gapRatio = Math.hypot(last.x - first.x, last.y - first.y) / meanRadius

  const cvPenalty = cv * (320 + 160 * t)
  const closureWeight = 40 + 20 * t
  const closureCap = 20 + 6 * t
  const closurePenalty = Math.min(closureCap, gapRatio * closureWeight)
  const score = Math.max(0, Math.min(100, 100 - cvPenalty - closurePenalty))

  return { centroid, meanRadius, score }
}

function pathFrom(points: Point[]): string {
  if (points.length === 0) return ''
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
}

export function PerfectCircleGame() {
  const [config, setConfig] = useState<RunConfig | null>(null)

  return (
    <GameShell eyebrow="Precision" title="Perfect Circle">
      {!config ? (
        <GameModeSelect gameId={GAME_ID} onStart={setConfig} />
      ) : config.mode === 'vs' && config.vs ? (
        <VsSequencer
          playerCount={config.vs.playerCount}
          seed={config.seed}
          onExit={() => setConfig(null)}
          renderRun={(runConfig, onFinish) => (
            <PerfectCircleRun
              key={`${runConfig.seed}-${runConfig.vs?.playerIndex ?? 0}`}
              config={runConfig}
              onFinish={onFinish}
              onChangeMode={() => setConfig(null)}
            />
          )}
        />
      ) : (
        <PerfectCircleRun
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

function PerfectCircleRun({
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
  const isEndless = config.mode === 'endless'

  const [phase, setPhase] = useState<'intro' | 'playing' | 'roundResult' | 'done'>(
    'intro',
  )
  const [rounds, setRounds] = useState<Round[]>([])
  const [livePoints, setLivePoints] = useState<Point[]>([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [lives, setLives] = useState(ENDLESS_LIVES)
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, config.mode))
  const rectRef = useRef<DOMRect | null>(null)

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]

  function makeRound(roundNum: number): Round {
    const t = difficultyForRound(roundNum, config.mode)
    return emptyRound(t)
  }

  function startGame() {
    setRounds([makeRound(1)])
    setLivePoints([])
    setLives(ENDLESS_LIVES)
    setPhase('playing')
  }

  function pctFromEvent(e: React.PointerEvent<HTMLDivElement>): Point | null {
    const rect = rectRef.current
    if (!rect) return null
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (phase !== 'playing' || current?.centroid) return
    rectRef.current = e.currentTarget.getBoundingClientRect()
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = pctFromEvent(e)
    if (!p) return
    setLivePoints([p])
    setIsDrawing(true)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDrawing) return
    const p = pctFromEvent(e)
    if (!p) return
    setLivePoints((pts) => [...pts, p])
  }

  function handlePointerUp() {
    if (!isDrawing) return
    setIsDrawing(false)
    setLivePoints((pts) => {
      finishStroke(pts)
      return pts
    })
  }

  function finishStroke(points: Point[]) {
    if (points.length < 2 || !current) return
    const { centroid, meanRadius, score } = scoreStroke(points, current.t)
    setRounds((rs) =>
      rs.map((r, i) => (i === currentIndex ? { ...r, points, centroid, meanRadius, score } : r)),
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
      setLivePoints([])
      setPhase('playing')
      return
    }
    if (rounds.length >= FIXED_ROUNDS) {
      finish(rounds.reduce((sum, r) => sum + r.score, 0) / rounds.length)
      return
    }
    setRounds((rs) => [...rs, makeRound(rs.length + 1)])
    setLivePoints([])
    setPhase('playing')
  }

  const isRunOver = isEndless ? lives <= 0 : rounds.length >= FIXED_ROUNDS

  const displayPoints = current?.centroid ? current.points : livePoints
  const strokeColor =
    phase === 'roundResult' && current
      ? current.score >= 70
        ? 'var(--success)'
        : 'var(--danger)'
      : 'var(--text)'

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
            Draw a circle freehand, one continuous stroke.{' '}
            {isEndless
              ? `${ENDLESS_LIVES} lives — it gets harder the longer you survive.`
              : `${FIXED_ROUNDS} attempts, scored on how close it is to geometrically perfect.`}
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
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '1 / 1',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-card)',
              overflow: 'hidden',
              cursor: phase === 'playing' ? 'crosshair' : 'default',
              touchAction: 'none',
              userSelect: 'none',
            }}
          >
            <svg
              viewBox="0 0 100 100"
              width="100%"
              height="100%"
              style={{ display: 'block' }}
            >
              {phase === 'roundResult' && current.centroid && (
                <circle
                  cx={current.centroid.x}
                  cy={current.centroid.y}
                  r={current.meanRadius}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={0.6}
                  strokeDasharray="3 2.5"
                  opacity={0.85}
                />
              )}
              {displayPoints.length > 1 && (
                <path
                  d={pathFrom(displayPoints)}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={1.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {phase === 'roundResult' && current.centroid && (
                <circle
                  cx={current.centroid.x}
                  cy={current.centroid.y}
                  r={0.9}
                  fill="var(--accent)"
                />
              )}
            </svg>
          </div>

          {phase === 'roundResult' && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
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
