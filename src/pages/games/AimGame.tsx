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
  markDailyPlayed,
  rngFor,
  type RunConfig,
} from '../../lib/modes'
import type { Rng } from '../../lib/rng'

const GAME_ID = 'aim'

// A "round" here is a whole timed session, not a single click.
const DURATION_MS_EASY = 10000
const DURATION_MS_HARD = 6000
const SIZE_PCT_EASY = 9 // target diameter, as a percentage of board width
const SIZE_PCT_HARD = 4
const MOVE_THRESHOLD = 0.5 // targets only move once difficulty t exceeds this
const MOVE_SPEED_MIN = 6 // %/s (of board width) at t just above the threshold
const MOVE_SPEED_MAX = 18 // %/s at t = 1
// The board keeps a 4/3 aspect ratio, so a target that's visually circular
// needs a different percentage-of-height size than its percentage-of-width
// size (matching the same compensation CrowdGame uses for dot velocity).
const ASPECT_Y = 4 / 3

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function durationMsFor(t: number): number {
  return lerp(DURATION_MS_EASY, DURATION_MS_HARD, t)
}

function sizePctFor(t: number): number {
  return lerp(SIZE_PCT_EASY, SIZE_PCT_HARD, t)
}

// Target position/velocity/size live in percentage-space: x/size as % of
// board width, y as % of board height (so it renders as a circle even
// though the board itself isn't square).
type Target = { x: number; y: number; vx: number; vy: number; sizePct: number }

type Session = {
  t: number
  durationMs: number
  hits: number
  misses: number
  score: number
}

// Net score: every hit is worth 1 point, every miss costs half a point —
// spamming clicks to rack up hits isn't free, but a session can't finish
// below 0 ("highest wins", and a negative number would be confusing).
function scoreForSession(hits: number, misses: number): number {
  return Math.max(0, hits - misses / 2)
}

function spawnTarget(rng: Rng, t: number, sizePct: number): Target {
  const heightPct = sizePct * ASPECT_Y
  const marginX = sizePct / 2
  const marginY = heightPct / 2
  const x = marginX + rng() * (100 - 2 * marginX)
  const y = marginY + rng() * (100 - 2 * marginY)

  let vx = 0
  let vy = 0
  if (t > MOVE_THRESHOLD) {
    const speed = lerp(
      MOVE_SPEED_MIN,
      MOVE_SPEED_MAX,
      (t - MOVE_THRESHOLD) / (1 - MOVE_THRESHOLD),
    )
    const angle = rng() * Math.PI * 2
    vx = Math.cos(angle) * speed
    vy = Math.sin(angle) * speed * ASPECT_Y
  }

  return { x, y, vx, vy, sizePct }
}

function stepTarget(target: Target, dt: number) {
  const heightPct = target.sizePct * ASPECT_Y
  const marginX = target.sizePct / 2
  const marginY = heightPct / 2

  target.x += target.vx * dt
  target.y += target.vy * dt

  if (target.x < marginX) {
    target.x = marginX + (marginX - target.x)
    target.vx = -target.vx
  } else if (target.x > 100 - marginX) {
    target.x = 100 - marginX - (target.x - (100 - marginX))
    target.vx = -target.vx
  }
  if (target.y < marginY) {
    target.y = marginY + (marginY - target.y)
    target.vy = -target.vy
  } else if (target.y > 100 - marginY) {
    target.y = 100 - marginY - (target.y - (100 - marginY))
    target.vy = -target.vy
  }

  target.x = Math.min(100 - marginX, Math.max(marginX, target.x))
  target.y = Math.min(100 - marginY, Math.max(marginY, target.y))
}

export function AimGame() {
  const [config, setConfig] = useState<RunConfig | null>(null)

  return (
    <GameShell eyebrow="Precision" title="Aim">
      {!config ? (
        <GameModeSelect gameId={GAME_ID} onStart={setConfig} />
      ) : config.mode === 'vs' && config.vs ? (
        <VsSequencer
          playerCount={config.vs.playerCount}
          seed={config.seed}
          onExit={() => setConfig(null)}
          renderRun={(runConfig, onFinish) => (
            <AimRun
              key={`${runConfig.seed}-${runConfig.vs?.playerIndex ?? 0}`}
              config={runConfig}
              onFinish={onFinish}
              onChangeMode={() => setConfig(null)}
            />
          )}
        />
      ) : (
        <AimRun
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

function AimRun({
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
  const [sessions, setSessions] = useState<Session[]>([])
  const [target, setTarget] = useState<Target | null>(null)
  const [progress, setProgress] = useState(1) // 1 -> 0 over the session duration
  const [hits, setHits] = useState(0)
  const [misses, setMisses] = useState(0)
  const [lives, setLives] = useState(ENDLESS_LIVES)
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, config.mode))

  const targetRef = useRef<Target | null>(null)
  const hitsRef = useRef(0)
  const missesRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  const currentIndex = sessions.length - 1
  const current = sessions[currentIndex]

  function clearTimers() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  useEffect(() => clearTimers, [])

  function finishSession() {
    const finalHits = hitsRef.current
    const finalMisses = missesRef.current
    const score = scoreForSession(finalHits, finalMisses)
    setSessions((s) =>
      s.map((sess, i) =>
        i === s.length - 1 ? { ...sess, hits: finalHits, misses: finalMisses, score } : sess,
      ),
    )
    // No net positive hits after accounting for misses costs a life — the
    // standard isMiss(score<40) rule doesn't apply here since this score is
    // an open-ended hit count, not a 0-100 scale.
    if (isEndless && score <= 0) setLives((l) => l - 1)
    setPhase('roundResult')
  }

  function startSession(sessionNum: number) {
    clearTimers()
    const t = difficultyForRound(sessionNum, config.mode)
    const durationMs = durationMsFor(t)
    const sizePct = sizePctFor(t)

    hitsRef.current = 0
    missesRef.current = 0
    setHits(0)
    setMisses(0)
    setProgress(1)

    const firstTarget = spawnTarget(rng, t, sizePct)
    targetRef.current = firstTarget
    setTarget(firstTarget)
    setSessions((s) => [...s, { t, durationMs, hits: 0, misses: 0, score: 0 }])
    setPhase('playing')

    const start = performance.now()
    let last = start

    function frame(now: number) {
      const dt = (now - last) / 1000
      last = now
      const elapsed = now - start

      const tg = targetRef.current
      if (tg && (tg.vx !== 0 || tg.vy !== 0)) {
        stepTarget(tg, dt)
        setTarget({ ...tg })
      }
      setProgress(Math.max(0, 1 - elapsed / durationMs))

      if (elapsed < durationMs) {
        rafRef.current = requestAnimationFrame(frame)
      } else {
        rafRef.current = null
        finishSession()
      }
    }

    rafRef.current = requestAnimationFrame(frame)
  }

  function startGame() {
    setSessions([])
    setLives(ENDLESS_LIVES)
    startSession(1)
  }

  function handleBoardClick(e: React.MouseEvent<HTMLDivElement>) {
    if (phase !== 'playing' || !targetRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const xPct = ((e.clientX - rect.left) / rect.width) * 100
    const yPct = ((e.clientY - rect.top) / rect.height) * 100

    const tg = targetRef.current
    const dxPx = ((tg.x - xPct) / 100) * rect.width
    const dyPx = ((tg.y - yPct) / 100) * rect.height
    const distPx = Math.hypot(dxPx, dyPx)
    const radiusPx = ((tg.sizePct / 100) * rect.width) / 2

    if (distPx <= radiusPx) {
      hitsRef.current += 1
      setHits(hitsRef.current)
      const t = current?.t ?? 0
      const newTarget = spawnTarget(rng, t, tg.sizePct)
      targetRef.current = newTarget
      setTarget(newTarget)
    } else {
      missesRef.current += 1
      setMisses(missesRef.current)
    }
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
        finish(sessions.length)
        return
      }
      startSession(sessions.length + 1)
      return
    }
    if (sessions.length >= FIXED_ROUNDS) {
      finish(sessions.reduce((sum, s) => sum + s.score, 0) / sessions.length)
      return
    }
    startSession(sessions.length + 1)
  }

  const isRunOver = isEndless ? lives <= 0 : sessions.length >= FIXED_ROUNDS
  const resultAccuracy =
    current && current.hits + current.misses > 0
      ? current.hits / (current.hits + current.misses)
      : 0

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
            Targets pop up one at a time. Click as many as you can before time runs
            out.{' '}
            {isEndless
              ? `${ENDLESS_LIVES} lives — each timed session gets harder the longer you survive.`
              : `${FIXED_ROUNDS} sessions, each a little harder than the last.`}
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {(phase === 'playing' || phase === 'roundResult') && current && (
        <div>
          {isEndless ? (
            <EndlessHud round={sessions.length} lives={lives} />
          ) : (
            <RoundProgress index={currentIndex} total={FIXED_ROUNDS} />
          )}
          <div
            style={{
              textAlign: 'center',
              fontSize: 13,
              color: 'var(--text-dim)',
              marginBottom: 10,
              minHeight: 16,
            }}
          >
            {phase === 'playing' ? `Hits ${hits} · Misses ${misses}` : ' '}
          </div>
          <div
            onClick={handleBoardClick}
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '4 / 3',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-card)',
              overflow: 'hidden',
              cursor: phase === 'playing' ? 'crosshair' : 'default',
              touchAction: 'manipulation',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 4,
                background: 'var(--border)',
                zIndex: 1,
              }}
            >
              <div
                style={{
                  width: `${progress * 100}%`,
                  height: '100%',
                  background: 'var(--accent)',
                }}
              />
            </div>
            {target && (
              <div
                style={{
                  position: 'absolute',
                  left: `${target.x}%`,
                  top: `${target.y}%`,
                  width: `${target.sizePct}%`,
                  height: `${target.sizePct * ASPECT_Y}%`,
                  transform: 'translate(-50%, -50%)',
                  borderRadius: '50%',
                  background: 'var(--accent)',
                }}
              />
            )}
          </div>

          {phase === 'roundResult' && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
                {current.hits} hits · {current.misses} misses ·{' '}
                {(resultAccuracy * 100).toFixed(0)}% accuracy
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, margin: '4px 0 20px' }}>
                {current.score.toFixed(1)}
                <span style={{ fontSize: 16, color: 'var(--text-faint)' }}> points</span>
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
              {sessions.map((s, i) => (
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
                  <span>{s.hits} hits</span>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                    {s.score.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>
              {isEndless ? 'ROUNDS SURVIVED' : 'AVERAGE POINTS'}
            </div>
            <div style={{ fontSize: 44, fontWeight: 700, margin: '4px 0 24px' }}>
              {isEndless
                ? sessions.length
                : (sessions.reduce((s, r) => s + r.score, 0) / sessions.length).toFixed(1)}
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
              formatScore={isEndless ? (s) => `${s.toFixed(0)} rounds` : (s) => `${s.toFixed(1)} points`}
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
