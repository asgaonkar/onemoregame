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

const GAME_ID = 'guess-distance'

// Points live in percentage-space (0-100), same trick as CenterGame: nothing
// that needs the board's real pixel size exists on the intro screen, so we
// generate layouts as percentages and only convert to real px once the board
// has mounted and getBoundingClientRect works (see the boardRef effect below).
type Point = { x: number; y: number }

type Round = {
  anchor: Point
  target: Point
  // Filled in by the boardRef effect once the board has mounted and its real
  // pixel size is known. null means "not computed yet".
  actualDistance: number | null
  diagonal: number
  hintLo: number
  hintHi: number
  guessedDistance: number | null
  score: number
  diffPx: number
  flashMs: number
  t: number
}

function randomPoint(rng: Rng): Point {
  return { x: 8 + rng() * 84, y: 8 + rng() * 84 }
}

function pctDist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// t: 0 (easiest) -> 1 (hardest). Harder rounds force the two dots further
// apart, which makes the gap harder to judge precisely.
function randomPair(rng: Rng, t: number): [Point, Point] {
  const minSep = 20 + 35 * t // 20 -> 55
  const a = randomPoint(rng)
  let b = randomPoint(rng)
  let attempts = 0
  while (pctDist(a, b) < minSep && attempts < 20) {
    b = randomPoint(rng)
    attempts++
  }
  return [a, b]
}

// t: 0 (easiest) -> 1 (hardest). Harder rounds flash the dots for less time.
function flashMsFor(t: number): number {
  return 1500 - 900 * t
}

function emptyRound(rng: Rng, t: number): Round {
  const [anchor, target] = randomPair(rng, t)
  return {
    anchor,
    target,
    actualDistance: null,
    diagonal: 0,
    hintLo: 0,
    hintHi: 0,
    guessedDistance: null,
    score: 0,
    diffPx: 0,
    flashMs: flashMsFor(t),
    t,
  }
}

function toPx(p: Point, rectW: number, rectH: number) {
  return { x: (p.x / 100) * rectW, y: (p.y / 100) * rectH }
}

// t: 0 (easiest) -> 1 (hardest). Range narrows as difficulty rises.
function hintRangeFor(rng: Rng, actualPx: number, t: number): { lo: number; hi: number } {
  const widthFrac = 0.6 - 0.35 * t // 60% of actual at t=0, down to 25% at t=1
  const width = Math.max(24, actualPx * widthFrac)
  // Place the actual value at a random fraction (not always the middle) of the range.
  const fraction = 0.15 + rng() * 0.7 // actual sits somewhere in the middle 70% of the range, but rarely dead center
  const lo = Math.max(0, Math.round(actualPx - width * fraction))
  const hi = Math.round(lo + width)
  return { lo, hi }
}

function scoreFor(actualDistance: number, guessedDistance: number, diagonal: number) {
  const diff = Math.abs(guessedDistance - actualDistance)
  return Math.max(0, 100 * (1 - diff / diagonal))
}

export function GuessDistanceGame() {
  const [config, setConfig] = useState<RunConfig | null>(null)

  return (
    <GameShell eyebrow="Memory" title="Guess Distance">
      {!config ? (
        <GameModeSelect gameId={GAME_ID} onStart={setConfig} />
      ) : config.mode === 'vs' && config.vs ? (
        <VsSequencer
          playerCount={config.vs.playerCount}
          seed={config.seed}
          onExit={() => setConfig(null)}
          renderRun={(runConfig, onFinish) => (
            <GuessDistanceRun
              key={`${runConfig.seed}-${runConfig.vs?.playerIndex ?? 0}`}
              config={runConfig}
              onFinish={onFinish}
              onChangeMode={() => setConfig(null)}
            />
          )}
        />
      ) : (
        <GuessDistanceRun
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

type Phase = 'intro' | 'showing' | 'guessing' | 'roundResult' | 'done'

function GuessDistanceRun({
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
  const [guessDraft, setGuessDraft] = useState(50)

  // The board div (rendered continuously through showing/guessing/roundResult)
  // so we can read its real pixel size once it exists — the click-to-guess
  // interaction is gone, so this is now the only way to convert the anchor
  // and target's percentage coordinates into real pixel distances.
  const boardRef = useRef<HTMLDivElement>(null)

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]
  // Guards against a round being scored twice — e.g. a rapid double-tap on
  // "Lock in guess" before React re-renders and `phase` reflects the change.
  const processedRef = useRef(-1)

  useEffect(() => {
    if (phase !== 'showing' || !current) return
    const timer = setTimeout(() => setPhase('guessing'), current.flashMs)
    return () => clearTimeout(timer)
  }, [phase, currentIndex, current])

  // Once the board has mounted for this round, compute the real pixel
  // distance between the anchor/target and this round's hint range. Guarded
  // on actualDistance being null so this (and the rng() draw inside
  // hintRangeFor) only ever runs once per round.
  useEffect(() => {
    if (!current || current.actualDistance !== null) return
    const rect = boardRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return
    const anchorPx = toPx(current.anchor, rect.width, rect.height)
    const targetPx = toPx(current.target, rect.width, rect.height)
    const actualDistance = Math.hypot(targetPx.x - anchorPx.x, targetPx.y - anchorPx.y)
    const diagonal = Math.hypot(rect.width, rect.height)
    const { lo, hi } = hintRangeFor(rng, actualDistance, current.t)
    setRounds((rs) =>
      rs.map((r, i) =>
        i === currentIndex ? { ...r, actualDistance, diagonal, hintLo: lo, hintHi: hi } : r,
      ),
    )
    setGuessDraft(Math.round((lo + hi) / 2))
  }, [phase, currentIndex, current, rng])

  function makeRound(roundNum: number): Round {
    const t = difficultyForRound(roundNum, config.mode)
    return emptyRound(rng, t)
  }

  function startGame() {
    setRounds([makeRound(1)])
    setLives(ENDLESS_LIVES)
    setPhase('showing')
  }

  function submitGuess() {
    if (
      !current ||
      phase !== 'guessing' ||
      current.actualDistance === null ||
      processedRef.current === currentIndex
    )
      return
    processedRef.current = currentIndex
    const guessedDistance = Math.max(0, Math.round(guessDraft))
    const score = scoreFor(current.actualDistance, guessedDistance, current.diagonal)
    const diffPx = Math.abs(guessedDistance - current.actualDistance)
    setRounds((rs) =>
      rs.map((r, i) => (i === currentIndex ? { ...r, guessedDistance, score, diffPx } : r)),
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
    if (config.mode !== 'practice') {
      // Endless's final score is "rounds survived" (higher is better, like
      // every other game's Endless). Fixed-round modes score by average
      // pixel difference (lower is better) — flip the leaderboard sort.
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
      setRounds((rs) => [...rs, makeRound(rs.length + 1)])
      setPhase('showing')
      return
    }
    if (rounds.length >= FIXED_ROUNDS) {
      finish(rounds.reduce((s, r) => s + r.diffPx, 0) / rounds.length)
      return
    }
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
          <p style={{ color: 'var(--text-dim)', maxWidth: 440, margin: '0 auto 28px' }}>
            Two dots flash briefly. One reappears as an anchor. Guess the real
            pixel distance to where the other one was.{' '}
            {isEndless
              ? `${ENDLESS_LIVES} lives — it gets harder the longer you survive.`
              : `${FIXED_ROUNDS} rounds, scored by how close your guessed distance is to the real one.`}
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
            <p
              style={{
                textAlign: 'center',
                fontSize: 13,
                color: 'var(--text-faint)',
                minHeight: 18,
                margin: '0 0 10px',
              }}
            >
              {phase === 'showing' && 'Memorize the gap…'}
              {phase === 'guessing' && 'How far apart were they?'}
              {phase === 'roundResult' && ' '}
            </p>
            <div
              ref={boardRef}
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '4 / 3',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--bg-card)',
                overflow: 'hidden',
                touchAction: 'manipulation',
              }}
            >
              {phase === 'showing' && (
                <>
                  <Dot xPct={current.anchor.x} yPct={current.anchor.y} color="var(--accent)" />
                  <Dot xPct={current.target.x} yPct={current.target.y} color="var(--accent)" />
                </>
              )}

              {phase === 'guessing' && (
                <Dot xPct={current.anchor.x} yPct={current.anchor.y} color="var(--accent)" />
              )}

              {phase === 'roundResult' && (
                <>
                  <svg
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                  >
                    <line
                      x1={current.anchor.x}
                      y1={current.anchor.y}
                      x2={current.target.x}
                      y2={current.target.y}
                      stroke="var(--accent)"
                      strokeWidth={0.4}
                      strokeDasharray="2,2"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  <Dot xPct={current.anchor.x} yPct={current.anchor.y} color="var(--accent)" />
                  <Dot xPct={current.target.x} yPct={current.target.y} color="var(--accent)" />
                </>
              )}
            </div>

            {phase === 'guessing' && (
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <p style={{ fontSize: 13, color: 'var(--text-faint)', marginBottom: 12 }}>
                  It's somewhere between {current.hintLo}px and {current.hintHi}px
                </p>
                <Stepper value={guessDraft} onChange={setGuessDraft} />
                <div style={{ marginTop: 20 }}>
                  <PlayButton onClick={submitGuess} label="Lock in guess" />
                </div>
              </div>
            )}

            {phase === 'roundResult' && current.actualDistance !== null && current.guessedDistance !== null && (
              <div style={{ textAlign: 'center', marginTop: 20 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    gap: 20,
                    fontSize: 13,
                    color: 'var(--text-dim)',
                    marginBottom: 8,
                  }}
                >
                  <span>Actual: {current.actualDistance.toFixed(0)}px</span>
                  <span>Guessed: {current.guessedDistance.toFixed(0)}px</span>
                </div>
                <div style={{ fontSize: 32, fontWeight: 700, margin: '4px 0 20px' }}>
                  {current.diffPx.toFixed(0)}
                  <span style={{ fontSize: 16, color: 'var(--text-faint)' }}> px off</span>
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
                    {r.diffPx.toFixed(0)}px off
                  </span>
                </div>
              ))}
            </div>
          )}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>
              {isEndless ? 'ROUNDS SURVIVED' : 'AVERAGE PX OFF'}
            </div>
            <div style={{ fontSize: 44, fontWeight: 700, margin: '4px 0 24px' }}>
              {isEndless
                ? rounds.length
                : (rounds.reduce((s, r) => s + r.diffPx, 0) / rounds.length).toFixed(0)}
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
              formatScore={isEndless ? (s) => `${s.toFixed(0)} rounds` : (s) => `${s.toFixed(0)}px off`}
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

function Dot({
  xPct,
  yPct,
  color,
}: {
  xPct: number
  yPct: number
  color: string
}) {
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
        background: color,
        boxShadow: '0 0 0 3px var(--bg-card)',
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

// Same +/- stepper pattern as CountGame's Stepper/StepButton, adapted here
// (not imported — this codebase keeps each game's UI self-contained) with a
// bigger step since distances run tens-to-hundreds of px rather than a dot
// count.
function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
      }}
    >
      <StepButton label="−" onClick={() => onChange(Math.max(0, value - 5))} />
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
      <StepButton label="+" onClick={() => onChange(value + 5)} />
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
