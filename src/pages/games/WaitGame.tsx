import { useMemo, useRef, useState } from 'react'
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

const GAME_ID = 'wait'

type Round = {
  targetMs: number
  elapsedMs: number
  diffMs: number
}

// t: 0 (easiest) -> 1 (hardest). Harder rounds pick a target from a wider
// range and round it to an "awkward", more precise value (fewer round
// numbers to anchor on).
function makeTargetMs(rng: Rng, t: number): number {
  const rawMs = 2000 + rng() * 5000
  const step = 500 - 450 * t // 500ms steps when easy, down to ~50ms when hard
  return Math.round(rawMs / step) * step
}

// Not shown to the player — purely an internal cutoff so Endless mode still
// has stakes ("close enough to survive"). The player only ever sees their
// raw ms-off; there's no percentage/tolerance concept in the scoring itself.
function endlessFailMsFor(t: number): number {
  return 600 - 350 * t
}

function emptyRound(targetMs: number): Round {
  return { targetMs, elapsedMs: 0, diffMs: 0 }
}

function formatSeconds(ms: number) {
  return (ms / 1000).toFixed(3) + 's'
}

function formatMs(ms: number) {
  return `${Math.round(ms)}ms`
}

export function WaitGame() {
  const [config, setConfig] = useState<RunConfig | null>(null)

  return (
    <GameShell eyebrow="Timing" title="Wait">
      {!config ? (
        <GameModeSelect gameId={GAME_ID} onStart={setConfig} />
      ) : config.mode === 'vs' && config.vs ? (
        <VsSequencer
          playerCount={config.vs.playerCount}
          seed={config.seed}
          onExit={() => setConfig(null)}
          renderRun={(runConfig, onFinish) => (
            <WaitRun
              key={`${runConfig.seed}-${runConfig.vs?.playerIndex ?? 0}`}
              config={runConfig}
              onFinish={onFinish}
              onChangeMode={() => setConfig(null)}
            />
          )}
        />
      ) : (
        <WaitRun
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

function WaitRun({
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
    'intro' | 'ready' | 'running' | 'roundResult' | 'done'
  >('intro')
  const [rounds, setRounds] = useState<Round[]>([])
  const [lives, setLives] = useState(ENDLESS_LIVES)
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, config.mode))
  const startRef = useRef<number>(0)
  // Guards against stopTimer firing twice for the same round (e.g. a rapid
  // double-click/tap on "Stop" before React re-renders and `phase` updates).
  const resolvedIndexRef = useRef(-1)

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]

  function makeRound(roundNum: number): Round {
    const t = difficultyForRound(roundNum, config.mode)
    return emptyRound(makeTargetMs(rng, t))
  }

  function startGame() {
    resolvedIndexRef.current = -1
    setRounds([makeRound(1)])
    setLives(ENDLESS_LIVES)
    setPhase('ready')
  }

  function startTimer() {
    startRef.current = performance.now()
    setPhase('running')
  }

  function stopTimer() {
    if (phase !== 'running' || !current || resolvedIndexRef.current === currentIndex) return
    resolvedIndexRef.current = currentIndex
    const elapsedMs = performance.now() - startRef.current
    const diffMs = Math.abs(elapsedMs - current.targetMs)
    setRounds((rs) =>
      rs.map((r, i) => (i === currentIndex ? { ...r, elapsedMs, diffMs } : r)),
    )
    if (isEndless) {
      const t = difficultyForRound(rounds.length, config.mode)
      if (diffMs > endlessFailMsFor(t)) setLives((l) => l - 1)
    }
    setPhase('roundResult')
  }

  function finish(finalScore: number) {
    trackEvent('game_finish', { game: GAME_ID, mode: config.mode, score: finalScore })
    if (onFinish) {
      onFinish(finalScore)
      return
    }
    if (config.mode === 'daily') markDailyPlayed(GAME_ID, finalScore)
    if (config.mode !== 'practice') {
      // Endless's final score is "rounds survived" (higher is better, like
      // every other game's Endless). Fixed-round modes score by average
      // ms-off (lower is better) — flip the leaderboard sort for those.
      setRuns(addRun(GAME_ID, config.mode, finalScore, { ascending: !isEndless }))
    }
    setPhase('done')
  }

  function nextRound() {
    if (isEndless) {
      if (lives <= 0) {
        finish(rounds.length)
        return
      }
      resolvedIndexRef.current = -1
      setRounds((rs) => [...rs, makeRound(rs.length + 1)])
      setPhase('ready')
      return
    }
    if (rounds.length >= FIXED_ROUNDS) {
      finish(rounds.reduce((s, r) => s + r.diffMs, 0) / rounds.length)
      return
    }
    resolvedIndexRef.current = -1
    setRounds((rs) => [...rs, makeRound(rs.length + 1)])
    setPhase('ready')
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
            Stop the timer on the exact target. Lowest total time off wins.{' '}
            {isEndless
              ? `${ENDLESS_LIVES} lives — it gets harder the longer you survive.`
              : `${FIXED_ROUNDS} rounds.`}
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {(phase === 'ready' || phase === 'running' || phase === 'roundResult') &&
        current && (
          <div>
            {isEndless ? (
              <EndlessHud round={rounds.length} lives={lives} />
            ) : (
              <RoundProgress index={currentIndex} total={FIXED_ROUNDS} />
            )}

            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>TARGET</div>
              <div style={{ fontSize: 28, fontWeight: 700, margin: '4px 0 24px' }}>
                {formatSeconds(current.targetMs)}
              </div>
            </div>

            <div
              style={{
                width: '100%',
                aspectRatio: '4 / 3',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--bg-card)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {phase === 'ready' && <Ring pulsing={false} />}
              {phase === 'running' && <Ring pulsing={true} />}
              {phase === 'roundResult' && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>
                    YOUR TIME
                  </div>
                  <div style={{ fontSize: 32, fontWeight: 700, margin: '4px 0 8px' }}>
                    {formatSeconds(current.elapsedMs)}
                  </div>
                </div>
              )}
            </div>

            <div style={{ textAlign: 'center', marginTop: 24 }}>
              {phase === 'ready' && <PlayButton onClick={startTimer} label="Go" />}
              {phase === 'running' && (
                <PlayButton onClick={stopTimer} label="Stop" />
              )}
              {phase === 'roundResult' && (
                <>
                  <div style={{ fontSize: 32, fontWeight: 700, margin: '4px 0 20px' }}>
                    {formatMs(current.diffMs)}
                    <span style={{ fontSize: 16, color: 'var(--text-faint)' }}> off</span>
                  </div>
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
                  <span>{formatSeconds(r.targetMs)} target</span>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                    {formatMs(r.diffMs)} off
                  </span>
                </div>
              ))}
            </div>
          )}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>
              {isEndless ? 'ROUNDS SURVIVED' : 'AVERAGE TIME OFF'}
            </div>
            <div style={{ fontSize: 44, fontWeight: 700, margin: '4px 0 24px' }}>
              {isEndless
                ? rounds.length
                : formatMs(rounds.reduce((s, r) => s + r.diffMs, 0) / rounds.length)}
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
              formatScore={isEndless ? (s) => `${s.toFixed(0)} rounds` : (s) => formatMs(s)}
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

function Ring({ pulsing }: { pulsing: boolean }) {
  return (
    <div
      style={{
        width: 64,
        height: 64,
        borderRadius: '50%',
        background: 'var(--accent)',
        opacity: pulsing ? undefined : 0.35,
        animation: pulsing ? 'wait-pulse 1.1s ease-in-out infinite' : 'none',
      }}
    >
      <style>{`
        @keyframes wait-pulse {
          0%, 100% { transform: scale(0.85); opacity: 0.35; }
          50% { transform: scale(1.15); opacity: 0.9; }
        }
      `}</style>
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
