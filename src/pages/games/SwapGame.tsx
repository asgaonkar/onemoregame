import { useEffect, useState } from 'react'
import { GameShell } from '../../components/GameShell'
import { LocalLeaderboard } from '../../components/LocalLeaderboard'
import { addRun, getRuns } from '../../lib/leaderboard'

const GAME_ID = 'swap'
const ROUNDS = 5
const SLOT_COUNT = 5
const REVEAL_MS = 900
const SWAP_STEP_MS = 550
const SETTLE_MS = 500

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
}

function randomSwapPair(prev: [number, number] | null): [number, number] {
  let a = 0
  let b = 0
  do {
    a = Math.floor(Math.random() * SLOT_COUNT)
    b = Math.floor(Math.random() * SLOT_COUNT)
  } while (
    a === b ||
    (prev && ((a === prev[0] && b === prev[1]) || (a === prev[1] && b === prev[0])))
  )
  return [a, b]
}

function generateSwaps(): [number, number][] {
  const count = 4 + Math.floor(Math.random() * 3) // 4-6
  const swaps: [number, number][] = []
  let prev: [number, number] | null = null
  for (let i = 0; i < count; i++) {
    const pair = randomSwapPair(prev)
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

function makeRound(): Round {
  const swaps = generateSwaps()
  const targetTokenId = Math.floor(Math.random() * SLOT_COUNT)
  const correctSlot = finalTokenSlots(swaps)[targetTokenId]
  return { targetTokenId, swaps, correctSlot, guessSlot: null, score: 0 }
}

export function SwapGame() {
  const [phase, setPhase] = useState<Phase>('intro')
  const [rounds, setRounds] = useState<Round[]>([])
  const [liveTokenSlot, setLiveTokenSlot] = useState<number[]>([0, 1, 2, 3, 4])
  const [highlightOn, setHighlightOn] = useState(false)
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, 'daily'))

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]

  // Phase 1: show the target token, stationary, for a beat.
  useEffect(() => {
    if (phase !== 'revealTarget') return
    const t = setTimeout(() => setPhase('swapping'), REVEAL_MS)
    return () => clearTimeout(t)
  }, [phase])

  // Phase 2: replay the swap sequence step by step, then hide the
  // highlight and hand control to the player.
  useEffect(() => {
    if (phase !== 'swapping' || !current) return
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
      }, i * SWAP_STEP_MS)
      timeouts.push(t)
    })

    const finalTimeout = setTimeout(
      () => {
        setHighlightOn(false)
        setPhase('guessing')
      },
      current.swaps.length * SWAP_STEP_MS + SETTLE_MS,
    )
    timeouts.push(finalTimeout)

    return () => timeouts.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentIndex])

  function startGame() {
    setRounds([makeRound()])
    setLiveTokenSlot([0, 1, 2, 3, 4])
    setHighlightOn(true)
    setPhase('revealTarget')
  }

  function handleSlotClick(slotIndex: number) {
    if (phase !== 'guessing' || !current || current.guessSlot !== null) return
    const score = slotIndex === current.correctSlot ? 100 : 0
    setRounds((rs) =>
      rs.map((r, i) =>
        i === currentIndex ? { ...r, guessSlot: slotIndex, score } : r,
      ),
    )
    setPhase('roundResult')
  }

  function nextRound() {
    if (rounds.length >= ROUNDS) {
      const total = rounds.reduce((sum, r) => sum + r.score, 0) / rounds.length
      const updated = addRun(GAME_ID, 'daily', total)
      setRuns(updated)
      setPhase('done')
      return
    }
    setRounds((rs) => [...rs, makeRound()])
    setLiveTokenSlot([0, 1, 2, 3, 4])
    setHighlightOn(true)
    setPhase('revealTarget')
  }

  function playAgain() {
    setRounds([])
    setPhase('intro')
  }

  return (
    <GameShell eyebrow="Memory" title="Swap">
      {phase === 'intro' && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--text-dim)', maxWidth: 420, margin: '0 auto 28px' }}>
            One token lights up, then everything shuffles. Click the slot it
            ended up in. {ROUNDS} rounds.
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {phase !== 'intro' && phase !== 'done' && current && (
        <div>
          <RoundProgress index={currentIndex} total={ROUNDS} />

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
                  ringColor = current.score === 100 ? 'var(--success)' : 'var(--danger)'
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
                    transition: `left ${SWAP_STEP_MS}ms ease, top ${SWAP_STEP_MS}ms ease, background 0.2s ease`,
                  }}
                />
              )
            })}
          </div>

          {phase === 'roundResult' && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
                {current.score === 100 ? 'Correct' : `It was slot ${current.correctSlot + 1}`}
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, margin: '4px 0 20px' }}>
                {current.score.toFixed(0)}
                <span style={{ fontSize: 16, color: 'var(--text-faint)' }}>/100</span>
              </div>
              <PlayButton
                onClick={nextRound}
                label={rounds.length >= ROUNDS ? 'See results' : 'Next round'}
              />
            </div>
          )}
        </div>
      )}

      {phase === 'done' && (
        <div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              marginBottom: 20,
            }}
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
                <span>{r.score === 100 ? 'Correct' : 'Missed'}</span>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                  {r.score.toFixed(0)}
                </span>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>
              AVERAGE SCORE
            </div>
            <div style={{ fontSize: 44, fontWeight: 700, margin: '4px 0 24px' }}>
              {(rounds.reduce((s, r) => s + r.score, 0) / rounds.length).toFixed(1)}
            </div>
            <PlayButton onClick={playAgain} label="Play again" />
          </div>
          <LocalLeaderboard runs={runs} />
        </div>
      )}
    </GameShell>
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
