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
  type RunConfig,
} from '../../lib/modes'
import type { Rng } from '../../lib/rng'

const GAME_ID = 'crowd'

// t: 0 (easiest) -> 1 (hardest). Dot count ramps 8 -> 17 for fixed-length
// modes; endless is allowed to climb further (up to 26) since it keeps
// getting harder the longer a run survives.
const BASE_DOTS = 8
const MAX_DOTS_FIXED = 17
const MAX_DOTS_ENDLESS = 26

const HIGHLIGHT_MS = 1000
const BASE_MOVE_MS = 3500
const MAX_MOVE_MS_BONUS = 2000 // extra tracking time (and difficulty) at t=1

// A correct hit's score scales with difficulty, same as Swap — harder
// rounds (a bigger, faster-moving crowd) pay more for a correct guess.
const CORRECT_SCORE_MIN = 60
const CORRECT_SCORE_MAX = 100

const DOT_R = 4 // dot "radius" in board percentage-space, keeps dots off the edges
const MIN_SEPARATION_PCT = 12
// The board keeps a 4/3 aspect ratio, so a dot moving at the same %/s in x
// and y would visually appear slower vertically (less real height than
// width). Scale the y velocity component to compensate.
const ASPECT_Y_COMPENSATION = 4 / 3

// Dot position/velocity live in percentage-space (0-100), matching the
// Center pattern: nothing needs the board's real pixel size until a click
// happens, at which point the board already exists and we can read its rect.
type DotState = { id: number; x: number; y: number; vx: number; vy: number }

type Round = {
  t: number
  count: number
  moveMs: number
  targetId: number
  guessId: number | null
  correct: boolean
  score: number
}

type Stage = 'highlight' | 'moving' | 'guessing'

function dotCountFor(t: number, isEndless: boolean): number {
  const max = isEndless ? MAX_DOTS_ENDLESS : MAX_DOTS_FIXED
  return Math.round(BASE_DOTS + t * (max - BASE_DOTS))
}

function moveMsFor(t: number): number {
  return BASE_MOVE_MS + t * MAX_MOVE_MS_BONUS
}

function randomDots(rng: Rng, count: number, t: number): DotState[] {
  const dots: DotState[] = []
  for (let id = 0; id < count; id++) {
    let x = 0
    let y = 0
    let attempts = 0
    do {
      x = DOT_R + rng() * (100 - 2 * DOT_R)
      y = DOT_R + rng() * (100 - 2 * DOT_R)
      attempts++
    } while (
      attempts < 40 &&
      dots.some((d) => Math.hypot(d.x - x, d.y - y) < MIN_SEPARATION_PCT)
    )

    const angle = rng() * Math.PI * 2
    const speedMin = 10 + t * 8
    const speedRange = 8 + t * 8
    const speed = speedMin + rng() * speedRange // %/s, faster at higher difficulty
    dots.push({
      id,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * ASPECT_Y_COMPENSATION,
    })
  }
  return dots
}

function stepDots(dots: DotState[], dt: number) {
  for (const d of dots) {
    d.x += d.vx * dt
    d.y += d.vy * dt

    if (d.x < DOT_R) {
      d.x = DOT_R + (DOT_R - d.x)
      d.vx = -d.vx
    } else if (d.x > 100 - DOT_R) {
      d.x = 100 - DOT_R - (d.x - (100 - DOT_R))
      d.vx = -d.vx
    }
    if (d.y < DOT_R) {
      d.y = DOT_R + (DOT_R - d.y)
      d.vy = -d.vy
    } else if (d.y > 100 - DOT_R) {
      d.y = 100 - DOT_R - (d.y - (100 - DOT_R))
      d.vy = -d.vy
    }

    // Safety clamp in case of an unusually large dt spike.
    d.x = Math.min(100 - DOT_R, Math.max(DOT_R, d.x))
    d.y = Math.min(100 - DOT_R, Math.max(DOT_R, d.y))
  }
}

export function CrowdGame() {
  const [config, setConfig] = useState<RunConfig | null>(null)

  return (
    <GameShell eyebrow="Perception" title="Crowd">
      {!config ? (
        <GameModeSelect gameId={GAME_ID} onStart={setConfig} />
      ) : config.mode === 'vs' && config.vs ? (
        <VsSequencer
          playerCount={config.vs.playerCount}
          seed={config.seed}
          onExit={() => setConfig(null)}
          renderRun={(runConfig, onFinish) => (
            <CrowdRun
              key={`${runConfig.seed}-${runConfig.vs?.playerIndex ?? 0}`}
              config={runConfig}
              onFinish={onFinish}
              onChangeMode={() => setConfig(null)}
            />
          )}
        />
      ) : (
        <CrowdRun
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

function CrowdRun({
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
  const [stage, setStage] = useState<Stage>('highlight')
  const [rounds, setRounds] = useState<Round[]>([])
  const [dots, setDots] = useState<DotState[]>([])
  const [lives, setLives] = useState(ENDLESS_LIVES)
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, config.mode))

  const dotsRef = useRef<DotState[]>([])
  const rafRef = useRef<number | null>(null)
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]
  // Guards against a round being scored twice — e.g. a rapid double-tap on
  // the board before React re-renders and `stage`/`phase` reflect the change.
  const processedRef = useRef(-1)

  function clearTimers() {
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current)
      highlightTimeoutRef.current = null
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  useEffect(() => clearTimers, [])

  function startMoving(moveMs: number) {
    const start = performance.now()
    let last = start

    function frame(now: number) {
      const dt = (now - last) / 1000
      last = now
      stepDots(dotsRef.current, dt)
      setDots(dotsRef.current.map((d) => ({ ...d })))

      if (now - start < moveMs) {
        rafRef.current = requestAnimationFrame(frame)
      } else {
        rafRef.current = null
        setStage('guessing')
      }
    }

    rafRef.current = requestAnimationFrame(frame)
  }

  function startRound(roundNum: number) {
    clearTimers()
    const t = difficultyForRound(roundNum, config.mode)
    const count = dotCountFor(t, isEndless)
    const moveMs = moveMsFor(t)
    const newDots = randomDots(rng, count, t)
    const targetId = newDots[Math.floor(rng() * newDots.length)].id

    dotsRef.current = newDots
    setDots(newDots)
    setRounds((rs) => [
      ...rs,
      { t, count, moveMs, targetId, guessId: null, correct: false, score: 0 },
    ])
    setStage('highlight')
    setPhase('playing')

    highlightTimeoutRef.current = setTimeout(() => {
      setStage('moving')
      startMoving(moveMs)
    }, HIGHLIGHT_MS)
  }

  function startGame() {
    setRounds([])
    setLives(ENDLESS_LIVES)
    startRound(1)
  }

  function handleBoardClick(e: React.MouseEvent<HTMLDivElement>) {
    if (
      phase !== 'playing' ||
      stage !== 'guessing' ||
      !current ||
      processedRef.current === currentIndex
    )
      return
    processedRef.current = currentIndex
    const rect = e.currentTarget.getBoundingClientRect()
    const xPct = ((e.clientX - rect.left) / rect.width) * 100
    const yPct = ((e.clientY - rect.top) / rect.height) * 100

    let nearestId: number | null = null
    let nearestDistPx = Infinity
    for (const d of dotsRef.current) {
      const dxPx = ((d.x - xPct) / 100) * rect.width
      const dyPx = ((d.y - yPct) / 100) * rect.height
      const distPx = Math.hypot(dxPx, dyPx)
      if (distPx < nearestDistPx) {
        nearestDistPx = distPx
        nearestId = d.id
      }
    }

    const hitRadiusPx = Math.max(28, rect.width * (DOT_R / 100) * 2.2)
    const guessId = nearestDistPx <= hitRadiusPx ? nearestId : null
    const correct = guessId !== null && guessId === current.targetId
    const score = correct
      ? Math.round(CORRECT_SCORE_MIN + (CORRECT_SCORE_MAX - CORRECT_SCORE_MIN) * current.t)
      : 0

    setRounds((rs) =>
      rs.map((r, i) => (i === currentIndex ? { ...r, guessId, correct, score } : r)),
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
      startRound(rounds.length + 1)
      return
    }
    if (rounds.length >= FIXED_ROUNDS) {
      finish(rounds.filter((r) => r.correct).length)
      return
    }
    startRound(rounds.length + 1)
  }

  const isRunOver = isEndless ? lives <= 0 : rounds.length >= FIXED_ROUNDS

  const statusLabel =
    phase === 'playing'
      ? stage === 'highlight'
        ? 'Watch the highlighted dot'
        : stage === 'moving'
          ? 'Tracking…'
          : 'Click the dot you were tracking'
      : null

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
            One dot flashes, then the crowd scatters. Track it and click it once
            they stop.{' '}
            {isEndless
              ? `${ENDLESS_LIVES} lives — the crowd grows and moves faster the longer you survive.`
              : `${FIXED_ROUNDS} rounds, the crowd grows each time.`}
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
          {statusLabel && (
            <div
              style={{
                textAlign: 'center',
                fontSize: 13,
                color: 'var(--text-dim)',
                marginBottom: 10,
                minHeight: 16,
              }}
            >
              {statusLabel}
            </div>
          )}
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
              cursor:
                phase === 'playing' && stage === 'guessing' ? 'crosshair' : 'default',
              touchAction: 'manipulation',
            }}
          >
            {dots.map((d) => {
              let color = 'var(--text-dim)'
              let ring = false

              if (phase === 'playing' && stage === 'highlight' && d.id === current.targetId) {
                color = 'var(--accent)'
                ring = true
              } else if (phase === 'roundResult') {
                if (d.id === current.targetId) {
                  color = 'var(--success)'
                  ring = true
                } else if (d.id === current.guessId) {
                  color = 'var(--danger)'
                } else {
                  color = 'var(--text-faint)'
                }
              }

              return <Dot key={d.id} xPct={d.x} yPct={d.y} color={color} ring={ring} />
            })}
          </div>

          {phase === 'roundResult' && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
                {current.correct
                  ? 'Correct!'
                  : current.guessId === null
                    ? "You didn't select a dot"
                    : 'Not quite'}
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: 'var(--text-faint)',
                  margin: '4px 0 20px',
                }}
              >
                {current.count} dots · {Math.round(current.moveMs)}ms tracking
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
                    {r.correct ? 'Hit' : 'Miss'}
                  </span>
                  <span>{r.count} dots</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>ROUNDS SURVIVED</div>
            <div style={{ fontSize: 44, fontWeight: 700, margin: '4px 0 24px' }}>
              {isEndless ? (
                rounds.length
              ) : (
                <>
                  {rounds.filter((r) => r.correct).length}
                  <span style={{ fontSize: 20, color: 'var(--text-faint)' }}>
                    /{FIXED_ROUNDS}
                  </span>
                </>
              )}
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
            <LocalLeaderboard runs={runs} formatScore={(s) => `${s.toFixed(0)} rounds`} />
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
  ring,
}: {
  xPct: number
  yPct: number
  color: string
  ring?: boolean
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${xPct}%`,
        top: `${yPct}%`,
        width: 14,
        height: 14,
        marginLeft: -7,
        marginTop: -7,
        borderRadius: '50%',
        background: color,
        boxShadow: ring
          ? `0 0 0 3px var(--bg-card), 0 0 0 6px ${color}`
          : '0 0 0 3px var(--bg-card)',
        transition: 'background 0.15s ease, box-shadow 0.15s ease',
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
