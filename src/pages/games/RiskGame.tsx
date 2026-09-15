import { useRef, useState } from 'react'
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
  type RunConfig,
} from '../../lib/modes'
import { createRng } from '../../lib/rng'

const GAME_ID = 'risk'

const RUNGS = [10, 20, 35, 55, 80, 115, 160, 220]
const BASE_BUST = [0.03, 0.07, 0.13, 0.2, 0.3, 0.42, 0.56, 0.72]

function bustProbFor(step: number, t: number): number {
  return Math.min(0.92, BASE_BUST[step] + 0.15 * t)
}

// Derived deterministically from (seed, roundNum, step) rather than pulled
// from a shared sequential RNG stream — this way two VS players (or a Daily
// player replaying vs. a friend) who push the same number of times always
// see the same bust/no-bust outcomes, regardless of how many times some
// OTHER player happened to push in their own rounds.
function rollBust(seed: string, roundNum: number, step: number): number {
  return createRng(`${seed}:r${roundNum}:push${step}`)()
}

type RoundStatus = 'active' | 'taken' | 'busted'

type RoundState = {
  roundNum: number
  t: number
  step: number
  status: RoundStatus
  roundScore: number
}

function makeRound(roundNum: number, mode: RunConfig['mode']): RoundState {
  return {
    roundNum,
    t: difficultyForRound(roundNum, mode),
    step: 0,
    status: 'active',
    roundScore: 0,
  }
}

export function RiskGame() {
  const [config, setConfig] = useState<RunConfig | null>(null)

  return (
    <GameShell eyebrow="Strategy" title="Risk">
      {!config ? (
        <GameModeSelect gameId={GAME_ID} onStart={setConfig} />
      ) : config.mode === 'vs' && config.vs ? (
        <VsSequencer
          playerCount={config.vs.playerCount}
          seed={config.seed}
          onExit={() => setConfig(null)}
          renderRun={(runConfig, onFinish) => (
            <RiskRun
              key={`${runConfig.seed}-${runConfig.vs?.playerIndex ?? 0}`}
              config={runConfig}
              onFinish={onFinish}
              onChangeMode={() => setConfig(null)}
            />
          )}
        />
      ) : (
        <RiskRun
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

function RiskRun({
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

  const [phase, setPhase] = useState<'intro' | 'playing' | 'roundResult' | 'done'>('intro')
  const [rounds, setRounds] = useState<RoundState[]>([])
  const [lives, setLives] = useState(ENDLESS_LIVES)
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, config.mode))

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]
  const totalSoFar = rounds.reduce((s, r) => s + r.roundScore, 0)
  // Guards against a single decision (Take/Push at a given step) being
  // processed twice — e.g. a rapid double-click before React re-renders and
  // `current.status`/`current.step` reflect the change. Push is legitimately
  // callable multiple times per round (once per rung), so the guard is keyed
  // by (round, step), not just round.
  const lastProcessedRef = useRef({ roundIndex: -1, step: -1 })

  function startGame() {
    setRounds([makeRound(1, config.mode)])
    setLives(ENDLESS_LIVES)
    setPhase('playing')
  }

  function handleTake() {
    if (!current || current.status !== 'active') return
    if (
      lastProcessedRef.current.roundIndex === currentIndex &&
      lastProcessedRef.current.step === current.step
    )
      return
    lastProcessedRef.current = { roundIndex: currentIndex, step: current.step }
    const score = RUNGS[current.step]
    setRounds((rs) =>
      rs.map((r, i) => (i === currentIndex ? { ...r, status: 'taken', roundScore: score } : r)),
    )
    setPhase('roundResult')
  }

  function handlePush() {
    if (!current || current.status !== 'active') return
    if (
      lastProcessedRef.current.roundIndex === currentIndex &&
      lastProcessedRef.current.step === current.step
    )
      return
    lastProcessedRef.current = { roundIndex: currentIndex, step: current.step }
    const bustProb = bustProbFor(current.step, current.t)
    const roll = rollBust(config.seed, current.roundNum, current.step)
    if (roll < bustProb) {
      setRounds((rs) =>
        rs.map((r, i) => (i === currentIndex ? { ...r, status: 'busted', roundScore: 0 } : r)),
      )
      if (isEndless) setLives((l) => l - 1)
      setPhase('roundResult')
    } else {
      setRounds((rs) => rs.map((r, i) => (i === currentIndex ? { ...r, step: r.step + 1 } : r)))
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
        finish(totalSoFar)
        return
      }
      setRounds((rs) => [...rs, makeRound(rs.length + 1, config.mode)])
      setPhase('playing')
      return
    }
    if (rounds.length >= FIXED_ROUNDS) {
      finish(totalSoFar)
      return
    }
    setRounds((rs) => [...rs, makeRound(rs.length + 1, config.mode)])
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
            Cash out to bank your points, or push your luck for more — bust and the round pays
            nothing.{' '}
            {isEndless
              ? `${ENDLESS_LIVES} lives — busting costs a life, cashing out never does.`
              : `${FIXED_ROUNDS} rounds, scored by total points banked.`}
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {(phase === 'playing' || phase === 'roundResult') && current && (
        <div>
          {isEndless ? (
            <EndlessHud round={current.roundNum} lives={lives} totalSoFar={totalSoFar} />
          ) : (
            <FixedHud index={currentIndex} total={FIXED_ROUNDS} totalSoFar={totalSoFar} />
          )}

          <div
            style={{
              textAlign: 'center',
              padding: '32px 20px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-card)',
            }}
          >
            {phase === 'playing' ? (
              <>
                <div style={{ fontSize: 13, color: 'var(--text-faint)', marginBottom: 6 }}>
                  ON THE LADDER
                </div>
                <div style={{ fontSize: 40, fontWeight: 700, marginBottom: 24 }}>
                  {RUNGS[current.step]} pts
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 10,
                    justifyContent: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <PlayButton onClick={handleTake} label={`Take ${RUNGS[current.step]} points`} />
                  {current.step + 1 < RUNGS.length && (
                    <OutlineButton
                      onClick={handlePush}
                      label={`Push for ${RUNGS[current.step + 1]} points (${Math.round(
                        bustProbFor(current.step, current.t) * 100,
                      )}% bust risk)`}
                    />
                  )}
                </div>
              </>
            ) : (
              <>
                {current.status === 'busted' ? (
                  <>
                    <div style={{ fontSize: 15, color: 'var(--danger)', fontWeight: 600 }}>
                      Busted!
                    </div>
                    <div style={{ fontSize: 32, fontWeight: 700, margin: '4px 0 20px' }}>
                      +0 pts
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 15, color: 'var(--success)', fontWeight: 600 }}>
                      Banked!
                    </div>
                    <div style={{ fontSize: 32, fontWeight: 700, margin: '4px 0 20px' }}>
                      +{current.roundScore} pts
                    </div>
                  </>
                )}
                <PlayButton
                  onClick={nextRound}
                  label={isRunOver ? 'See results' : 'Next round'}
                />
              </>
            )}
          </div>
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
                  <span>{r.status === 'busted' ? 'Busted' : `Banked ${r.roundScore}`}</span>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                    {r.roundScore} pts
                  </span>
                </div>
              ))}
            </div>
          )}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>TOTAL POINTS</div>
            <div style={{ fontSize: 44, fontWeight: 700, margin: '4px 0 24px' }}>
              {totalSoFar.toFixed(0)}
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
            <LocalLeaderboard runs={runs} formatScore={(s) => `${s.toFixed(0)} pts`} />
          )}
        </div>
      )}
    </div>
  )
}

function FixedHud({
  index,
  total,
  totalSoFar,
}: {
  index: number
  total: number
  totalSoFar: number
}) {
  return (
    <div
      style={{
        textAlign: 'center',
        marginBottom: 16,
        fontSize: 13,
        color: 'var(--text-dim)',
      }}
    >
      Round {index + 1} of {total} · Total so far: {totalSoFar} pts
    </div>
  )
}

function EndlessHud({
  round,
  lives,
  totalSoFar,
}: {
  round: number
  lives: number
  totalSoFar: number
}) {
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
        flexWrap: 'wrap',
      }}
    >
      <span>Round {round}</span>
      <span>Total so far: {totalSoFar} pts</span>
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

function OutlineButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        borderRadius: 999,
        padding: '14px 24px',
        fontSize: 15,
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
