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

const GAME_ID = 'guess-distance'

// Points live in percentage-space (0-100), same trick as CenterGame: nothing
// that needs the board's real pixel size exists on the intro screen, so we
// generate layouts as percentages and only convert to px inside the click
// handler, where the board already exists and getBoundingClientRect works.
type Point = { x: number; y: number }

type Round = {
  anchor: Point
  target: Point
  guess: Point | null
  actualDistance: number
  guessedDistance: number
  score: number
  flashMs: number
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
    guess: null,
    actualDistance: 0,
    guessedDistance: 0,
    score: 0,
    flashMs: flashMsFor(t),
  }
}

function toPx(p: Point, rectW: number, rectH: number) {
  return { x: (p.x / 100) * rectW, y: (p.y / 100) * rectH }
}

function scoreFor(round: Round, guess: Point, rectW: number, rectH: number) {
  const diagonal = Math.hypot(rectW, rectH)
  const anchorPx = toPx(round.anchor, rectW, rectH)
  const targetPx = toPx(round.target, rectW, rectH)
  const guessPx = toPx(guess, rectW, rectH)
  const actualDistance = Math.hypot(targetPx.x - anchorPx.x, targetPx.y - anchorPx.y)
  const guessedDistance = Math.hypot(guessPx.x - anchorPx.x, guessPx.y - anchorPx.y)
  const diff = Math.abs(guessedDistance - actualDistance)
  const score = Math.max(0, 100 * (1 - diff / diagonal))
  return { actualDistance, guessedDistance, score }
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

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]

  useEffect(() => {
    if (phase !== 'showing' || !current) return
    const timer = setTimeout(() => setPhase('guessing'), current.flashMs)
    return () => clearTimeout(timer)
  }, [phase, currentIndex, current])

  function makeRound(roundNum: number): Round {
    const t = difficultyForRound(roundNum, config.mode)
    return emptyRound(rng, t)
  }

  function startGame() {
    setRounds([makeRound(1)])
    setLives(ENDLESS_LIVES)
    setPhase('showing')
  }

  function handleStageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (phase !== 'guessing' || !current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const guess: Point = {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    }
    const { actualDistance, guessedDistance, score } = scoreFor(
      current,
      guess,
      rect.width,
      rect.height,
    )
    setRounds((rs) =>
      rs.map((r, i) =>
        i === currentIndex ? { ...r, guess, actualDistance, guessedDistance, score } : r,
      ),
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
      setRounds((rs) => [...rs, makeRound(rs.length + 1)])
      setPhase('showing')
      return
    }
    if (rounds.length >= FIXED_ROUNDS) {
      finish(rounds.reduce((s, r) => s + r.score, 0) / rounds.length)
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
            Two dots flash briefly. One reappears as an anchor — click where
            the other one was, relative to it.{' '}
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
              {phase === 'guessing' && 'Click where the second dot was'}
              {phase === 'roundResult' && ' '}
            </p>
            <div
              onClick={handleStageClick}
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '4 / 3',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--bg-card)',
                overflow: 'hidden',
                cursor: phase === 'guessing' ? 'crosshair' : 'default',
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

              {phase === 'roundResult' && current.guess && (
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
                    <line
                      x1={current.anchor.x}
                      y1={current.anchor.y}
                      x2={current.guess.x}
                      y2={current.guess.y}
                      stroke={current.score >= 70 ? 'var(--success)' : 'var(--danger)'}
                      strokeWidth={0.4}
                      strokeDasharray="2,2"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  <Dot xPct={current.anchor.x} yPct={current.anchor.y} color="var(--accent)" />
                  <Dot xPct={current.target.x} yPct={current.target.y} color="var(--accent)" />
                  <Dot
                    xPct={current.guess.x}
                    yPct={current.guess.y}
                    color={current.score >= 70 ? 'var(--success)' : 'var(--danger)'}
                  />
                </>
              )}
            </div>

            {phase === 'roundResult' && (
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
                <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
                  {Math.abs(current.guessedDistance - current.actualDistance).toFixed(0)}px off
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
                  <span>{Math.abs(r.guessedDistance - r.actualDistance).toFixed(0)}px off</span>
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
