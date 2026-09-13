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

const GAME_ID = 'count'

// Dot positions are generated in percentage-space (0-100) up front, so the
// board never needs to be measured to lay a round out — only the flash
// duration and count depend on difficulty. Real pixels only matter for
// rendering, which the browser handles via percentage CSS.
type Point = { x: number; y: number }

type Round = {
  count: number
  dots: Point[]
  duration: number
  guess: number | null
  score: number
}

// t: 0 (easiest) -> 1 (hardest). More dots, less time to look at them.
// Capped well below where rejection-sampling could get slow.
function paramsForDifficulty(t: number): { min: number; max: number; duration: number } {
  const min = Math.round(8 + 17 * t)
  const max = Math.min(45, Math.round(12 + 23 * t))
  const duration = Math.round(1200 - 700 * t)
  return { min, max, duration }
}

function randomCount(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

// Rejection-sample dot positions so denser rounds still read as distinct
// dots rather than an overlapping blob; falls back to an unchecked
// placement if a spot can't be found within a reasonable number of tries.
function generateDots(rng: Rng, count: number): Point[] {
  const dots: Point[] = []
  const minDist = Math.max(5, 26 - count * 0.55)
  const maxAttempts = 200

  for (let i = 0; i < count; i++) {
    let placed = false
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const x = 8 + rng() * 84
      const y = 8 + rng() * 84
      if (dots.every((d) => Math.hypot(d.x - x, d.y - y) >= minDist)) {
        dots.push({ x, y })
        placed = true
        break
      }
    }
    if (!placed) {
      dots.push({ x: 8 + rng() * 84, y: 8 + rng() * 84 })
    }
  }
  return dots
}

export function CountGame() {
  const [config, setConfig] = useState<RunConfig | null>(null)

  return (
    <GameShell eyebrow="Perception" title="Count">
      {!config ? (
        <GameModeSelect gameId={GAME_ID} onStart={setConfig} />
      ) : config.mode === 'vs' && config.vs ? (
        <VsSequencer
          playerCount={config.vs.playerCount}
          seed={config.seed}
          onExit={() => setConfig(null)}
          renderRun={(runConfig, onFinish) => (
            <CountRun
              key={`${runConfig.seed}-${runConfig.vs?.playerIndex ?? 0}`}
              config={runConfig}
              onFinish={onFinish}
              onChangeMode={() => setConfig(null)}
            />
          )}
        />
      ) : (
        <CountRun
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

function CountRun({
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
    'intro' | 'showing' | 'guessing' | 'roundResult' | 'done'
  >('intro')
  const [rounds, setRounds] = useState<Round[]>([])
  const [guessDraft, setGuessDraft] = useState(10)
  const [lives, setLives] = useState(ENDLESS_LIVES)
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, config.mode))

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]

  function makeRound(roundNum: number): Round {
    const t = difficultyForRound(roundNum, config.mode)
    const { min, max, duration } = paramsForDifficulty(t)
    const count = randomCount(rng, min, max)
    return { count, dots: generateDots(rng, count), duration, guess: null, score: 0 }
  }

  // Flash the dots, then blank the board after this round's duration.
  useEffect(() => {
    if (phase !== 'showing') return
    const round = rounds[currentIndex]
    if (!round) return
    const timer = window.setTimeout(() => setPhase('guessing'), round.duration)
    return () => window.clearTimeout(timer)
  }, [phase, currentIndex])

  function startGame() {
    setGuessDraft(10)
    setRounds([makeRound(1)])
    setLives(ENDLESS_LIVES)
    setPhase('showing')
  }

  function submitGuess() {
    if (!current || phase !== 'guessing') return
    const guess = Math.max(0, Math.round(guessDraft))
    const diff = Math.abs(guess - current.count)
    const score = Math.max(0, Math.min(100, 100 * (1 - diff / current.count)))
    setRounds((rs) =>
      rs.map((r, i) => (i === currentIndex ? { ...r, guess, score } : r)),
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
      setGuessDraft(10)
      setRounds((rs) => [...rs, makeRound(rs.length + 1)])
      setPhase('showing')
      return
    }
    if (rounds.length >= FIXED_ROUNDS) {
      finish(rounds.reduce((s, r) => s + r.score, 0) / rounds.length)
      return
    }
    setGuessDraft(10)
    setRounds((rs) => [...rs, makeRound(rs.length + 1)])
    setPhase('showing')
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
            Dots flash on screen for a moment. Count them before they vanish.{' '}
            {isEndless
              ? `${ENDLESS_LIVES} lives — it gets harder the longer you survive.`
              : `${FIXED_ROUNDS} rounds, each faster and busier than the last.`}
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {(phase === 'showing' || phase === 'guessing' || phase === 'roundResult') &&
        current && (
          <div>
            {isEndless ? (
              <EndlessHud round={rounds.length} lives={lives} />
            ) : (
              <RoundProgress index={currentIndex} total={FIXED_ROUNDS} />
            )}

            <div
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '4 / 3',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--bg-card)',
                overflow: 'hidden',
              }}
            >
              {(phase === 'showing' || phase === 'roundResult') &&
                current.dots.map((d, i) => <Dot key={i} xPct={d.x} yPct={d.y} />)}

              {phase === 'guessing' && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-faint)',
                    fontSize: 14,
                  }}
                >
                  How many were there?
                </div>
              )}

              {phase === 'roundResult' && (
                <div
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 12,
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: 0.4,
                    color: 'var(--text-faint)',
                    textTransform: 'uppercase',
                  }}
                >
                  {current.count} actual
                </div>
              )}
            </div>

            {phase === 'showing' && (
              <div
                style={{
                  textAlign: 'center',
                  marginTop: 16,
                  color: 'var(--text-faint)',
                  fontSize: 13,
                }}
              >
                Watch closely…
              </div>
            )}

            {phase === 'guessing' && (
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <Stepper value={guessDraft} onChange={setGuessDraft} />
                <div style={{ marginTop: 20 }}>
                  <PlayButton onClick={submitGuess} label="Lock in guess" />
                </div>
              </div>
            )}

            {phase === 'roundResult' && current.guess !== null && (
              <div style={{ textAlign: 'center', marginTop: 20 }}>
                <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
                  You guessed {current.guess} · actual was {current.count}
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
                  <span>
                    {r.guess ?? '–'} guessed · {r.count} actual
                  </span>
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

function Dot({ xPct, yPct }: { xPct: number; yPct: number }) {
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
        background: 'var(--accent)',
      }}
    />
  )
}

function Stepper({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
      }}
    >
      <StepButton label="−" onClick={() => onChange(Math.max(0, value - 1))} />
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          onChange(Number.isNaN(n) ? 0 : Math.max(0, n))
        }}
        style={{
          width: 90,
          textAlign: 'center',
          fontSize: 28,
          fontWeight: 700,
          padding: '10px 8px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)',
          background: 'var(--bg-card)',
          color: 'var(--text)',
        }}
      />
      <StepButton label="+" onClick={() => onChange(value + 1)} />
    </div>
  )
}

function StepButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 44,
        height: 44,
        borderRadius: '50%',
        border: '1px solid var(--border)',
        background: 'var(--bg-card)',
        color: 'var(--text)',
        fontSize: 20,
        fontWeight: 700,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
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
