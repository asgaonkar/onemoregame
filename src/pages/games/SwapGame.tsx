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

const GAME_ID = 'swap'
const SLOT_COUNT = 5
const SETTLE_MS = 500
const CORRECT_SCORE_MIN = 60
const CORRECT_SCORE_MAX = 100

// Slots are fixed percentage coordinates arranged in a gentle arc, so the
// board never needs to be measured before render — only the swap/guess
// logic cares about which slot index a token sits in.
const SLOTS: { x: number; y: number }[] = [
  { x: 12, y: 58 },
  { x: 31, y: 38 },
  { x: 50, y: 30 },
  { x: 69, y: 38 },
  { x: 88, y: 58 },
]

type Phase =
  | 'intro'
  | 'revealTarget'
  | 'swapping'
  | 'guessing'
  | 'roundResult'
  | 'done'

type Round = {
  targetTokenId: number
  swaps: [number, number][]
  correctSlot: number
  guessSlot: number | null
  score: number
  revealMs: number
  swapStepMs: number
  t: number
}

function randomSwapPair(rng: Rng, prev: [number, number] | null): [number, number] {
  let a = 0
  let b = 0
  do {
    a = Math.floor(rng() * SLOT_COUNT)
    b = Math.floor(rng() * SLOT_COUNT)
  } while (
    a === b ||
    (prev && ((a === prev[0] && b === prev[1]) || (a === prev[1] && b === prev[0])))
  )
  return [a, b]
}

// t: 0 (easiest) -> 1 (hardest). Harder rounds chain together more swaps.
function generateSwaps(rng: Rng, t: number): [number, number][] {
  const count = Math.round(4 + 5 * t) // 4 at t=0 -> 9 at t=1
  const swaps: [number, number][] = []
  let prev: [number, number] | null = null
  for (let i = 0; i < count; i++) {
    const pair = randomSwapPair(rng, prev)
    swaps.push(pair)
    prev = pair
  }
  return swaps
}

// Simulates the swap sequence against the identity layout (token i starts
// in slot i) to find each token's final resting slot.
function finalTokenSlots(swaps: [number, number][]): number[] {
  const slotToken = [0, 1, 2, 3, 4]
  const tokenSlot = [0, 1, 2, 3, 4]
  for (const [s1, s2] of swaps) {
    const t1 = slotToken[s1]
    const t2 = slotToken[s2]
    slotToken[s1] = t2
    slotToken[s2] = t1
    tokenSlot[t1] = s2
    tokenSlot[t2] = s1
  }
  return tokenSlot
}

function makeRound(rng: Rng, roundNum: number, mode: RunConfig['mode']): Round {
  const t = difficultyForRound(roundNum, mode)
  const swaps = generateSwaps(rng, t)
  const targetTokenId = Math.floor(rng() * SLOT_COUNT)
  const correctSlot = finalTokenSlots(swaps)[targetTokenId]
  // Reveal shortens with difficulty but never drops below ~500ms — even at
  // max difficulty the target highlight must stay legible.
  const revealMs = Math.max(500, 900 - 400 * t)
  // Each swap step animates faster as difficulty rises.
  const swapStepMs = 550 - 270 * t
  return {
    targetTokenId,
    swaps,
    correctSlot,
    guessSlot: null,
    score: 0,
    revealMs,
    swapStepMs,
    t,
  }
}

export function SwapGame() {
  const [config, setConfig] = useState<RunConfig | null>(null)

  return (
    <GameShell eyebrow="Memory" title="Swap">
      {!config ? (
        <GameModeSelect gameId={GAME_ID} onStart={setConfig} />
      ) : config.mode === 'vs' && config.vs ? (
        <VsSequencer
          playerCount={config.vs.playerCount}
          seed={config.seed}
          onExit={() => setConfig(null)}
          renderRun={(runConfig, onFinish) => (
            <SwapRun
              key={`${runConfig.seed}-${runConfig.vs?.playerIndex ?? 0}`}
              config={runConfig}
              onFinish={onFinish}
              onChangeMode={() => setConfig(null)}
            />
          )}
        />
      ) : (
        <SwapRun
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

function SwapRun({
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
  const [liveTokenSlot, setLiveTokenSlot] = useState<number[]>([0, 1, 2, 3, 4])
  const [highlightOn, setHighlightOn] = useState(false)
  const [lives, setLives] = useState(ENDLESS_LIVES)
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, config.mode))

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]
  // Guards against a round being scored twice — e.g. a rapid double-tap on
  // a slot before React re-renders and `current.guessSlot` reflects it.
  const processedRef = useRef(-1)

  // Phase 1: show the target token, stationary, for a beat.
  useEffect(() => {
    if (phase !== 'revealTarget' || !current) return
    const t = setTimeout(() => setPhase('swapping'), current.revealMs)
    return () => clearTimeout(t)
  }, [phase, current])

  // Phase 2: hide the highlight the instant swapping starts — otherwise the
  // target stays visually distinguishable through every swap and can just be
  // watched instead of tracked from memory. Then replay the swap sequence
  // step by step.
  useEffect(() => {
    if (phase !== 'swapping' || !current) return
    setHighlightOn(false)
    const timeouts: ReturnType<typeof setTimeout>[] = []

    current.swaps.forEach(([a, b], i) => {
      const t = setTimeout(() => {
        setLiveTokenSlot((slots) => {
          const next = [...slots]
          const tokenAtA = next.findIndex((s) => s === a)
          const tokenAtB = next.findIndex((s) => s === b)
          next[tokenAtA] = b
          next[tokenAtB] = a
          return next
        })
      }, i * current.swapStepMs)
      timeouts.push(t)
    })

    const finalTimeout = setTimeout(
      () => {
        setPhase('guessing')
      },
      current.swaps.length * current.swapStepMs + SETTLE_MS,
    )
    timeouts.push(finalTimeout)

    return () => timeouts.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentIndex])

  function startGame() {
    setRounds([makeRound(rng, 1, config.mode)])
    setLiveTokenSlot([0, 1, 2, 3, 4])
    setHighlightOn(true)
    setLives(ENDLESS_LIVES)
    setPhase('revealTarget')
  }

  function handleSlotClick(slotIndex: number) {
    if (
      phase !== 'guessing' ||
      !current ||
      current.guessSlot !== null ||
      processedRef.current === currentIndex
    )
      return
    processedRef.current = currentIndex
    const score =
      slotIndex === current.correctSlot
        ? Math.round(CORRECT_SCORE_MIN + (CORRECT_SCORE_MAX - CORRECT_SCORE_MIN) * current.t)
        : 0
    setRounds((rs) =>
      rs.map((r, i) => (i === currentIndex ? { ...r, guessSlot: slotIndex, score } : r)),
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
      setRounds((rs) => [...rs, makeRound(rng, rs.length + 1, config.mode)])
      setLiveTokenSlot([0, 1, 2, 3, 4])
      setHighlightOn(true)
      setPhase('revealTarget')
      return
    }
    if (rounds.length >= FIXED_ROUNDS) {
      finish(rounds.reduce((s, r) => s + r.score, 0) / rounds.length)
      return
    }
    setRounds((rs) => [...rs, makeRound(rng, rs.length + 1, config.mode)])
    setLiveTokenSlot([0, 1, 2, 3, 4])
    setHighlightOn(true)
    setPhase('revealTarget')
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
            One token lights up, then everything shuffles. Click the slot it ended up in.{' '}
            {isEndless
              ? `${ENDLESS_LIVES} lives — it gets harder the longer you survive.`
              : `${FIXED_ROUNDS} rounds, and it gets harder each round.`}
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {phase !== 'intro' && phase !== 'done' && current && (
        <div>
          {isEndless ? (
            <EndlessHud round={rounds.length} lives={lives} />
          ) : (
            <RoundProgress index={currentIndex} total={FIXED_ROUNDS} />
          )}

          <div style={{ height: 22, textAlign: 'center', marginBottom: 8 }}>
            {phase === 'guessing' && (
              <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>
                Where did it end up?
              </span>
            )}
          </div>

          <div
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '2 / 1',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-card)',
              overflow: 'hidden',
              touchAction: 'manipulation',
            }}
          >
            {/* Static landing pads — the click targets during guessing, and
                the reveal rings afterwards. These never move. */}
            {SLOTS.map((slot, slotIndex) => {
              let ringColor = 'var(--border)'
              if (phase === 'roundResult') {
                if (slotIndex === current.guessSlot) {
                  ringColor = current.score > 0 ? 'var(--success)' : 'var(--danger)'
                } else if (slotIndex === current.correctSlot) {
                  ringColor = 'var(--accent)'
                }
              }

              return (
                <div
                  key={slotIndex}
                  onClick={() => handleSlotClick(slotIndex)}
                  style={{
                    position: 'absolute',
                    left: `${slot.x}%`,
                    top: `${slot.y}%`,
                    width: 48,
                    height: 48,
                    marginLeft: -24,
                    marginTop: -24,
                    borderRadius: '50%',
                    border: `2px solid ${ringColor}`,
                    cursor: phase === 'guessing' ? 'pointer' : 'default',
                    transition: 'border-color 0.2s ease',
                  }}
                />
              )
            })}

            {/* Movable tokens — one per token id, keyed stably so each one
                slides (via the left/top CSS transition) to its new slot's
                percentage position instead of teleporting. */}
            {liveTokenSlot.map((slotIndex, tokenId) => {
              const slot = SLOTS[slotIndex]
              const isTarget = tokenId === current.targetTokenId
              const showHighlight = highlightOn && isTarget
              const revealTarget = phase === 'roundResult' && isTarget

              return (
                <div
                  key={tokenId}
                  style={{
                    position: 'absolute',
                    left: `${slot.x}%`,
                    top: `${slot.y}%`,
                    width: 26,
                    height: 26,
                    marginLeft: -13,
                    marginTop: -13,
                    borderRadius: '50%',
                    background:
                      showHighlight || revealTarget
                        ? 'var(--accent)'
                        : 'var(--text-dim)',
                    pointerEvents: 'none',
                    transition: `left ${current.swapStepMs}ms ease, top ${current.swapStepMs}ms ease, background 0.2s ease`,
                  }}
                />
              )
            })}
          </div>

          {phase === 'roundResult' && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
                {current.score > 0 ? 'Correct' : `It was slot ${current.correctSlot + 1}`}
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, margin: '4px 0 20px' }}>
                {current.score.toFixed(0)}
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
                  <span>{r.score > 0 ? 'Correct' : 'Missed'}</span>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                    {r.score.toFixed(0)}
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
