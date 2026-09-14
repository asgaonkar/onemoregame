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
  markDailyPlayed,
  rngFor,
  type GameMode,
  type RunConfig,
} from '../../lib/modes'
import type { Rng } from '../../lib/rng'

const GAME_ID = 'reflex'
// Sentinel "time" for a failed round (false start / timeout) — worse than any
// real reaction, so it naturally drags a run's average down without needing
// a separate 0-100 score concept. Lower is always better here.
const FAIL_MS = 2000

type Outcome = 'pending' | 'hit' | 'falseStart' | 'timeout'

type Round = {
  t: number
  sizePct: number // target diameter, as a percentage of the (square) board's width
  waitMs: number // random delay before the target appears
  maxResponseMs: number // time allowed to react once it appears
  x: number // target center, percentage of board width
  y: number // target center, percentage of board height
  outcome: Outcome
  reactionMs: number
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// t: 0 (easiest) -> 1 (hardest). The target shrinks and the response window
// tightens; the appearance delay itself stays unpredictable at every level.
function targetSizeFor(t: number): number {
  return lerp(16, 7, t)
}

function maxResponseMsFor(t: number): number {
  return lerp(1200, 550, t)
}

// The "score" for a round is just its time in ms — lower is better — except
// failures, which are penalized with a fixed worst-case sentinel.
function timeFor(round: Round): number {
  return round.outcome === 'hit' ? round.reactionMs : FAIL_MS
}

function formatMs(ms: number): string {
  return `${Math.round(ms)}ms`
}

function makeRound(rng: Rng, roundNum: number, mode: GameMode): Round {
  const t = difficultyForRound(roundNum, mode)
  const sizePct = targetSizeFor(t)
  const maxResponseMs = maxResponseMsFor(t)
  const waitMs = 600 + rng() * 1600 // [600, 2200)
  const x = sizePct / 2 + rng() * (100 - sizePct)
  const y = sizePct / 2 + rng() * (100 - sizePct)
  return {
    t,
    sizePct,
    waitMs,
    maxResponseMs,
    x,
    y,
    outcome: 'pending',
    reactionMs: 0,
  }
}

function resultMessage(round: Round): string {
  if (round.outcome === 'falseStart') return 'Too soon!'
  if (round.outcome === 'timeout') return 'Too slow!'
  return formatMs(round.reactionMs)
}

export function ReflexGame() {
  const [config, setConfig] = useState<RunConfig | null>(null)

  return (
    <GameShell eyebrow="Timing" title="Reflex">
      {!config ? (
        <GameModeSelect gameId={GAME_ID} onStart={setConfig} />
      ) : config.mode === 'vs' && config.vs ? (
        <VsSequencer
          playerCount={config.vs.playerCount}
          seed={config.seed}
          onExit={() => setConfig(null)}
          renderRun={(runConfig, onFinish) => (
            <ReflexRun
              key={`${runConfig.seed}-${runConfig.vs?.playerIndex ?? 0}`}
              config={runConfig}
              onFinish={onFinish}
              onChangeMode={() => setConfig(null)}
            />
          )}
        />
      ) : (
        <ReflexRun
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

function ReflexRun({
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

  const [phase, setPhase] = useState<'intro' | 'waiting' | 'live' | 'roundResult' | 'done'>(
    'intro',
  )
  const [rounds, setRounds] = useState<Round[]>([])
  const [lives, setLives] = useState(ENDLESS_LIVES)
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, config.mode))

  const appearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const appearAtRef = useRef(0)
  // Guards against a round being finished twice — e.g. a timeout timer firing
  // in the same tick as a click, or a rapid double-click/tap before React
  // re-renders and `phase` reflects the change. Reset per round.
  const finishedIndexRef = useRef(-1)

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]

  function clearTimers() {
    if (appearTimerRef.current) {
      clearTimeout(appearTimerRef.current)
      appearTimerRef.current = null
    }
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current)
      timeoutTimerRef.current = null
    }
  }

  useEffect(() => clearTimers, [])

  function scheduleWait(round: Round, idx: number) {
    clearTimers()
    appearTimerRef.current = setTimeout(() => {
      appearAtRef.current = performance.now()
      setPhase('live')
      timeoutTimerRef.current = setTimeout(() => {
        finishRoundWithOutcome(idx, 'timeout', 0)
      }, round.maxResponseMs)
    }, round.waitMs)
  }

  function finishRoundWithOutcome(idx: number, outcome: Outcome, reactionMs: number) {
    if (finishedIndexRef.current === idx) return
    finishedIndexRef.current = idx
    clearTimers()
    setRounds((rs) => rs.map((r, i) => (i === idx ? { ...r, outcome, reactionMs } : r)))
    if (isEndless && outcome !== 'hit') setLives((l) => l - 1)
    setPhase('roundResult')
  }

  function startGame() {
    const r = makeRound(rng, 1, config.mode)
    finishedIndexRef.current = -1
    setRounds([r])
    setLives(ENDLESS_LIVES)
    setPhase('waiting')
    scheduleWait(r, 0)
  }

  function handleFalseStart() {
    if (phase !== 'waiting') return
    finishRoundWithOutcome(currentIndex, 'falseStart', 0)
  }

  function handleTargetClick() {
    if (phase !== 'live') return
    const reactionMs = performance.now() - appearAtRef.current
    finishRoundWithOutcome(currentIndex, 'hit', reactionMs)
  }

  function finish(finalScore: number) {
    if (onFinish) {
      onFinish(finalScore)
      return
    }
    if (config.mode === 'daily') markDailyPlayed(GAME_ID, finalScore)
    if (config.mode !== 'practice') {
      // Endless's final score is "rounds survived" (higher is better, like
      // every other game's Endless). Fixed-round modes score by average
      // reaction time (lower is better) — flip the leaderboard sort for those.
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
      const idx = rounds.length
      const r = makeRound(rng, idx + 1, config.mode)
      finishedIndexRef.current = -1
      setRounds((rs) => [...rs, r])
      setPhase('waiting')
      scheduleWait(r, idx)
      return
    }
    if (rounds.length >= FIXED_ROUNDS) {
      finish(rounds.reduce((s, r) => s + timeFor(r), 0) / rounds.length)
      return
    }
    const idx = rounds.length
    const r = makeRound(rng, idx + 1, config.mode)
    finishedIndexRef.current = -1
    setRounds((rs) => [...rs, r])
    setPhase('waiting')
    scheduleWait(r, idx)
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
            A target appears at a random moment — click it the instant you see it. Click too
            soon and it&rsquo;s a false start. Lowest reaction time wins.{' '}
            {isEndless
              ? `${ENDLESS_LIVES} lives — it gets harder the longer you survive.`
              : `${FIXED_ROUNDS} rounds.`}
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {(phase === 'waiting' || phase === 'live' || phase === 'roundResult') && current && (
        <div>
          {isEndless ? (
            <EndlessHud round={rounds.length} lives={lives} />
          ) : (
            <RoundProgress index={currentIndex} total={FIXED_ROUNDS} />
          )}

          <div
            onClick={handleFalseStart}
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '1 / 1',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-card)',
              overflow: 'hidden',
              cursor: phase === 'waiting' ? 'pointer' : 'default',
              touchAction: 'manipulation',
            }}
          >
            {phase === 'waiting' && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-faint)',
                  fontSize: 14,
                  pointerEvents: 'none',
                }}
              >
                Wait for it…
              </div>
            )}
            {phase === 'live' && (
              <div
                onClick={(e) => {
                  e.stopPropagation()
                  handleTargetClick()
                }}
                style={{
                  position: 'absolute',
                  left: `${current.x}%`,
                  top: `${current.y}%`,
                  width: `${current.sizePct}%`,
                  height: `${current.sizePct}%`,
                  transform: 'translate(-50%, -50%)',
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                }}
              />
            )}
          </div>

          {phase === 'roundResult' && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <div style={{ fontSize: 32, fontWeight: 700, margin: '20px 0' }}>
                {resultMessage(current)}
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
                    {resultMessage(r)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>
              {isEndless ? 'ROUNDS SURVIVED' : 'AVERAGE TIME'}
            </div>
            <div style={{ fontSize: 44, fontWeight: 700, margin: '4px 0 24px' }}>
              {isEndless
                ? rounds.length
                : formatMs(rounds.reduce((s, r) => s + timeFor(r), 0) / rounds.length)}
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
