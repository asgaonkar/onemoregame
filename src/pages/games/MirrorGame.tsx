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

const GAME_ID = 'mirror'

// Points live in percentage-space (0-100), same trick as CenterGame/TraceGame
// — nothing that needs the board's real pixel size exists on the intro or
// memorize screens, so a round can be generated up front. Only the click
// handler (during the `place` phase) needs the board's real pixel rect, and
// the board already exists on screen by then.
type Point = { x: number; y: number }

type Placement = {
  xPct: number
  yPct: number
  distancePct: number // percentage-space distance vs. the true mirrored target — used for scoring
  distancePx: number // real px at click time — display only, never affects score
  score: number
}

type Round = {
  t: number
  k: number
  points: Point[] // original points, left half only
  placements: Placement[] // grows one-per-click as the player places points 1..k
  avgDistPct: number // used for scoring — percentage-space, so it's fair across screen sizes
  avgDistPx: number // display only
  score: number
  showDurationMs: number
}

// A "reasonable miss" ceiling in percentage-space (the board is 0-100 on
// each axis, same square-board convention as CenterGame/BlinkGame). Scoring
// in percentage-space — rather than real pixels — means the same relative
// accuracy gets the same score regardless of the viewer's screen size.
const MISS_CEILING_PCT = 20

// t: 0 (easiest) -> 1 (hardest). More points, less time to memorize them.
function pointCountFor(t: number): number {
  return Math.round(4 + 3 * t)
}

function showDurationFor(t: number): number {
  return Math.round(2200 - 1200 * t)
}

function randomPoint(rng: Rng): Point {
  // Confined to the left half of the board, with a margin so dots never sit
  // flush against the divider or the outer edge.
  return { x: 6 + rng() * 38, y: 8 + rng() * 84 }
}

function randomPoints(rng: Rng, k: number): Point[] {
  const points: Point[] = []
  const minSep = 10 // percentage-space, keeps numbered dots visually distinct
  for (let i = 0; i < k; i++) {
    let p = randomPoint(rng)
    let attempts = 0
    while (points.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < minSep) && attempts < 20) {
      p = randomPoint(rng)
      attempts++
    }
    points.push(p)
  }
  return points
}

function mirrorOf(p: Point): Point {
  return { x: 100 - p.x, y: p.y }
}

function scoreFromDistancePct(distancePct: number): number {
  return Math.max(0, Math.min(100, 100 * (1 - distancePct / MISS_CEILING_PCT)))
}

export function MirrorGame() {
  const [config, setConfig] = useState<RunConfig | null>(null)

  return (
    <GameShell eyebrow="Memory" title="Mirror">
      {!config ? (
        <GameModeSelect gameId={GAME_ID} onStart={setConfig} />
      ) : config.mode === 'vs' && config.vs ? (
        <VsSequencer
          playerCount={config.vs.playerCount}
          seed={config.seed}
          onExit={() => setConfig(null)}
          renderRun={(runConfig, onFinish) => (
            <MirrorRun
              key={`${runConfig.seed}-${runConfig.vs?.playerIndex ?? 0}`}
              config={runConfig}
              onFinish={onFinish}
              onChangeMode={() => setConfig(null)}
            />
          )}
        />
      ) : (
        <MirrorRun
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

type Phase = 'intro' | 'memorize' | 'place' | 'roundResult' | 'done'

function MirrorRun({
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
  const [lives, setLives] = useState(ENDLESS_LIVES)
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, config.mode))

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]
  // Guards against a single placement being scored twice — e.g. a rapid
  // double-tap before React re-renders and `current.placements` reflects the
  // first click. Unlike single-click games, Mirror takes several clicks per
  // round, so the guard is keyed by (round, placement index), not just round.
  const lastProcessedRef = useRef({ roundIndex: -1, placeIndex: -1 })

  function makeRound(roundNum: number): Round {
    const t = difficultyForRound(roundNum, config.mode)
    const k = pointCountFor(t)
    return {
      t,
      k,
      points: randomPoints(rng, k),
      placements: [],
      avgDistPct: 0,
      avgDistPx: 0,
      score: 0,
      showDurationMs: showDurationFor(t),
    }
  }

  // Show the numbered points for a window that shrinks with difficulty, then
  // hide them and let the player start placing.
  useEffect(() => {
    if (phase !== 'memorize' || !current) return
    const timer = setTimeout(() => setPhase('place'), current.showDurationMs)
    return () => clearTimeout(timer)
  }, [phase, current])

  function startGame() {
    setRounds([makeRound(1)])
    setLives(ENDLESS_LIVES)
    setPhase('memorize')
  }

  function handleBoardClick(e: React.MouseEvent<HTMLDivElement>) {
    if (phase !== 'place' || !current) return
    const placeIndex = current.placements.length
    if (placeIndex >= current.k) return
    if (
      lastProcessedRef.current.roundIndex === currentIndex &&
      lastProcessedRef.current.placeIndex === placeIndex
    )
      return
    lastProcessedRef.current = { roundIndex: currentIndex, placeIndex }

    const rect = e.currentTarget.getBoundingClientRect()
    const xPct = ((e.clientX - rect.left) / rect.width) * 100
    const yPct = ((e.clientY - rect.top) / rect.height) * 100

    const target = mirrorOf(current.points[placeIndex])
    // Scored in percentage-space so accuracy is judged the same regardless of
    // the viewer's screen size; real px is computed only for display below.
    const distancePct = Math.hypot(xPct - target.x, yPct - target.y)
    const guessPx = { x: (xPct / 100) * rect.width, y: (yPct / 100) * rect.height }
    const targetPx = { x: (target.x / 100) * rect.width, y: (target.y / 100) * rect.height }
    const distancePx = Math.hypot(guessPx.x - targetPx.x, guessPx.y - targetPx.y)
    const placement: Placement = {
      xPct,
      yPct,
      distancePct,
      distancePx,
      score: scoreFromDistancePct(distancePct),
    }

    const placements = [...current.placements, placement]
    const isLastPoint = placements.length >= current.k
    const avgDistPct = isLastPoint
      ? placements.reduce((s, p) => s + p.distancePct, 0) / placements.length
      : current.avgDistPct
    const avgDistPx = isLastPoint
      ? placements.reduce((s, p) => s + p.distancePx, 0) / placements.length
      : current.avgDistPx
    const roundScore = isLastPoint ? scoreFromDistancePct(avgDistPct) : current.score

    setRounds((rs) =>
      rs.map((r, i) =>
        i === currentIndex ? { ...r, placements, avgDistPct, avgDistPx, score: roundScore } : r,
      ),
    )

    if (isLastPoint) {
      if (isEndless && isMiss(roundScore)) setLives((l) => l - 1)
      setPhase('roundResult')
    }
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
      setPhase('memorize')
      return
    }
    if (rounds.length >= FIXED_ROUNDS) {
      finish(rounds.reduce((s, r) => s + r.score, 0) / rounds.length)
      return
    }
    setRounds((rs) => [...rs, makeRound(rs.length + 1)])
    setPhase('memorize')
  }

  const isRunOver = isEndless ? lives <= 0 : rounds.length >= FIXED_ROUNDS
  const placeIndex = current ? current.placements.length : 0

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
          <p style={{ color: 'var(--text-dim)', maxWidth: 440, margin: '0 auto 28px' }}>
            Memorize the numbered points on the left, then place their mirror
            image across the line.{' '}
            {isEndless
              ? `${ENDLESS_LIVES} lives — it gets harder the longer you survive.`
              : `${FIXED_ROUNDS} rounds, scored by how close each mirrored point lands.`}
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {(phase === 'memorize' || phase === 'place' || phase === 'roundResult') && current && (
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
            {phase === 'memorize' && 'Memorize the points'}
            {phase === 'place' && `Place point ${Math.min(placeIndex + 1, current.k)} of ${current.k}`}
            {phase === 'roundResult' && (current.score >= 70 ? 'Nice mirroring' : "Here's how it compared")}
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
              cursor: phase === 'place' ? 'crosshair' : 'default',
              touchAction: 'manipulation',
            }}
          >
            {/* Constant visual reference for what "mirrored" means — not
                affected by difficulty. */}
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: 0,
                bottom: 0,
                width: 1,
                background: 'var(--border)',
              }}
            />

            {phase === 'memorize' &&
              current.points.map((p, i) => (
                <NumberedDot key={i} xPct={p.x} yPct={p.y} label={i + 1} color="var(--accent)" />
              ))}

            {phase === 'place' &&
              current.placements.map((p, i) => (
                <NumberedDot
                  key={i}
                  xPct={p.xPct}
                  yPct={p.yPct}
                  label={i + 1}
                  color="var(--accent)"
                  opacity={0.45}
                />
              ))}

            {phase === 'roundResult' && (
              <>
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                >
                  {current.placements.map((p, i) => {
                    const target = mirrorOf(current.points[i])
                    return (
                      <line
                        key={i}
                        x1={target.x}
                        y1={target.y}
                        x2={p.xPct}
                        y2={p.yPct}
                        stroke="var(--accent)"
                        strokeWidth={0.4}
                        strokeDasharray="2,2"
                        vectorEffect="non-scaling-stroke"
                      />
                    )
                  })}
                </svg>
                {current.points.map((p, i) => (
                  <NumberedDot
                    key={`orig-${i}`}
                    xPct={p.x}
                    yPct={p.y}
                    label={i + 1}
                    color="var(--accent)"
                    opacity={0.35}
                  />
                ))}
                {current.points.map((p, i) => {
                  const target = mirrorOf(p)
                  return (
                    <NumberedDot
                      key={`target-${i}`}
                      xPct={target.x}
                      yPct={target.y}
                      label={i + 1}
                      color="var(--accent)"
                    />
                  )
                })}
                {current.placements.map((p, i) => (
                  <NumberedDot
                    key={`guess-${i}`}
                    xPct={p.xPct}
                    yPct={p.yPct}
                    label={i + 1}
                    color={p.score >= 70 ? 'var(--success)' : 'var(--danger)'}
                  />
                ))}
              </>
            )}
          </div>

          {phase === 'roundResult' && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
                {current.avgDistPx.toFixed(0)}px avg miss
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
                  <span>{r.avgDistPx.toFixed(0)}px avg miss</span>
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

function NumberedDot({
  xPct,
  yPct,
  label,
  color,
  opacity = 1,
}: {
  xPct: number
  yPct: number
  label: number
  color: string
  opacity?: number
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${xPct}%`,
        top: `${yPct}%`,
        width: 18,
        height: 18,
        marginLeft: -9,
        marginTop: -9,
        borderRadius: '50%',
        background: color,
        opacity,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10,
        fontWeight: 700,
        color: 'var(--accent-text)',
        boxShadow: '0 0 0 3px var(--bg-card)',
      }}
    >
      {label}
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
