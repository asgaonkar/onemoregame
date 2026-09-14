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
  type GameMode,
  type RunConfig,
} from '../../lib/modes'
import type { Rng } from '../../lib/rng'

const GAME_ID = 'flash'

// Shapes live in percentage-space (0-100) on a square board, so a click's
// percent offsets can be compared directly to a shape's percent position —
// no DOM measurement needed except to convert a hit distance to pixels for
// display.
type ShapeKind = 'circle' | 'square'
type Shape = { x: number; y: number; color: string; kind: ShapeKind }

type QuestionType = 'count' | 'color' | 'missing'

type Round = {
  questionType: QuestionType
  t: number
  flashMs: number
  m: number
  shapes: Shape[]
  circleIndex: number // 'color' rounds only; -1 otherwise
  missingIndex: number // 'missing' rounds only; -1 otherwise
  countGuess: number | null
  colorGuess: string | null
  positionGuess: { xPct: number; yPct: number } | null
  distance: number
  score: number
}

const PALETTE = ['#f97316', '#eab308', '#14b8a6', '#06b6d4', '#8b5cf6', '#ec4899']

const SHAPE_SIZE_PCT = 10
const GAP_MS = 400 // brief hide between the two looks in a 'missing' round

function pickColor(rng: Rng): string {
  return PALETTE[Math.floor(rng() * PALETTE.length)]
}

function pickQuestionType(rng: Rng): QuestionType {
  const r = rng()
  if (r < 1 / 3) return 'count'
  if (r < 2 / 3) return 'color'
  return 'missing'
}

// t: 0 (easiest) -> 1 (hardest). Shorter flash, more shapes, as round climbs.
function flashMsFor(t: number): number {
  return Math.round(1400 - 800 * t)
}

function shapeCountFor(t: number): number {
  return Math.round(5 + 5 * t)
}

// Rejection-sample positions so shapes read as distinct even at the higher
// counts, falling back to an unchecked placement if a spot can't be found.
function generateShapes(
  rng: Rng,
  count: number,
  decorate: (index: number) => { color: string; kind: ShapeKind },
): Shape[] {
  const shapes: Shape[] = []
  const margin = SHAPE_SIZE_PCT / 2 + 4
  let attempts = 0
  while (shapes.length < count && attempts < count * 80) {
    attempts++
    const x = margin + rng() * (100 - 2 * margin)
    const y = margin + rng() * (100 - 2 * margin)
    const overlaps = shapes.some((s) => Math.hypot(x - s.x, y - s.y) < SHAPE_SIZE_PCT + 3)
    if (overlaps) continue
    const { color, kind } = decorate(shapes.length)
    shapes.push({ x, y, color, kind })
  }
  while (shapes.length < count) {
    const { color, kind } = decorate(shapes.length)
    shapes.push({ x: margin + rng() * (100 - 2 * margin), y: margin + rng() * (100 - 2 * margin), color, kind })
  }
  return shapes
}

function generateRound(rng: Rng, roundNum: number, mode: GameMode): Round {
  const t = difficultyForRound(roundNum, mode)
  const flashMs = flashMsFor(t)
  const m = shapeCountFor(t)
  const questionType = pickQuestionType(rng)

  if (questionType === 'count') {
    const shapes = generateShapes(rng, m, () => ({ color: 'var(--accent)', kind: 'circle' }))
    return {
      questionType,
      t,
      flashMs,
      m,
      shapes,
      circleIndex: -1,
      missingIndex: -1,
      countGuess: null,
      colorGuess: null,
      positionGuess: null,
      distance: 0,
      score: 0,
    }
  }

  if (questionType === 'color') {
    const circleIndex = Math.floor(rng() * m)
    const shapes = generateShapes(rng, m, (i) => ({
      color: pickColor(rng),
      kind: i === circleIndex ? 'circle' : 'square',
    }))
    return {
      questionType,
      t,
      flashMs,
      m,
      shapes,
      circleIndex,
      missingIndex: -1,
      countGuess: null,
      colorGuess: null,
      positionGuess: null,
      distance: 0,
      score: 0,
    }
  }

  // missing
  const missingIndex = Math.floor(rng() * m)
  const shapes = generateShapes(rng, m, () => ({
    color: pickColor(rng),
    kind: rng() < 0.5 ? 'circle' : 'square',
  }))
  return {
    questionType,
    t,
    flashMs,
    m,
    shapes,
    circleIndex: -1,
    missingIndex,
    countGuess: null,
    colorGuess: null,
    positionGuess: null,
    distance: 0,
    score: 0,
  }
}

const QUESTION_LABEL: Record<QuestionType, string> = {
  count: 'Count',
  color: 'Color',
  missing: 'Missing',
}

export function FlashGame() {
  const [config, setConfig] = useState<RunConfig | null>(null)

  return (
    <GameShell eyebrow="Perception" title="Flash">
      {!config ? (
        <GameModeSelect gameId={GAME_ID} onStart={setConfig} />
      ) : config.mode === 'vs' && config.vs ? (
        <VsSequencer
          playerCount={config.vs.playerCount}
          seed={config.seed}
          onExit={() => setConfig(null)}
          renderRun={(runConfig, onFinish) => (
            <FlashRun
              key={`${runConfig.seed}-${runConfig.vs?.playerIndex ?? 0}`}
              config={runConfig}
              onFinish={onFinish}
              onChangeMode={() => setConfig(null)}
            />
          )}
        />
      ) : (
        <FlashRun
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

function headerLabel(phase: Phase, current: Round | undefined): string {
  if (!current) return ''
  if (phase === 'flash1') return current.questionType === 'missing' ? 'Memorize' : 'Watch closely'
  if (phase === 'gap') return ''
  if (phase === 'flash2') return 'Look again'
  if (phase === 'guessing') {
    if (current.questionType === 'count') return 'How many were there?'
    if (current.questionType === 'color') return 'What color was the circle?'
    return 'Which one is missing?'
  }
  if (phase === 'roundResult' && current.questionType === 'missing') {
    return current.score >= 100 ? 'Nice catch' : 'Missed it'
  }
  return ''
}

type Phase = 'intro' | 'flash1' | 'gap' | 'flash2' | 'guessing' | 'roundResult' | 'done'

function FlashRun({
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
  const [guessDraft, setGuessDraft] = useState(10)
  const [lives, setLives] = useState(ENDLESS_LIVES)
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, config.mode))

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]

  // Timed phase sequence: flash1 -> (gap -> flash2 for 'missing' only) -> guessing.
  useEffect(() => {
    if (!current) return
    if (phase === 'flash1') {
      const next = current.questionType === 'missing' ? 'gap' : 'guessing'
      const timer = window.setTimeout(() => setPhase(next), current.flashMs)
      return () => window.clearTimeout(timer)
    }
    if (phase === 'gap') {
      const timer = window.setTimeout(() => setPhase('flash2'), GAP_MS)
      return () => window.clearTimeout(timer)
    }
    if (phase === 'flash2') {
      const timer = window.setTimeout(() => setPhase('guessing'), current.flashMs)
      return () => window.clearTimeout(timer)
    }
  }, [phase, currentIndex, current])

  function makeRound(roundNum: number): Round {
    return generateRound(rng, roundNum, config.mode)
  }

  function startGame() {
    setGuessDraft(10)
    setRounds([makeRound(1)])
    setLives(ENDLESS_LIVES)
    setPhase('flash1')
  }

  function updateRound(patch: Partial<Round>) {
    setRounds((rs) => rs.map((r, i) => (i === currentIndex ? { ...r, ...patch } : r)))
  }

  function afterAnswer(score: number) {
    if (isEndless && isMiss(score)) setLives((l) => l - 1)
    setPhase('roundResult')
  }

  function submitCountGuess() {
    if (!current || phase !== 'guessing') return
    const guess = Math.max(0, Math.round(guessDraft))
    const score = Math.max(0, Math.min(100, 100 * (1 - Math.abs(guess - current.m) / current.m)))
    updateRound({ countGuess: guess, score })
    afterAnswer(score)
  }

  function submitColorGuess(color: string) {
    if (!current || phase !== 'guessing' || current.circleIndex < 0) return
    const correct = current.shapes[current.circleIndex].color
    const score = color === correct ? 100 : 0
    updateRound({ colorGuess: color, score })
    afterAnswer(score)
  }

  function handleMissingClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!current || phase !== 'guessing' || current.missingIndex < 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const xPct = ((e.clientX - rect.left) / rect.width) * 100
    const yPct = ((e.clientY - rect.top) / rect.height) * 100
    const target = current.shapes[current.missingIndex]
    const distPct = Math.hypot(xPct - target.x, yPct - target.y)
    const hitRadiusPct = SHAPE_SIZE_PCT / 2 + 6
    const hit = distPct <= hitRadiusPct
    const distance = (distPct / 100) * rect.width
    const score = hit ? 100 : 0
    updateRound({ positionGuess: { xPct, yPct }, distance, score })
    afterAnswer(score)
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
      setPhase('flash1')
      return
    }
    if (rounds.length >= FIXED_ROUNDS) {
      finish(rounds.reduce((s, r) => s + r.score, 0) / rounds.length)
      return
    }
    setGuessDraft(10)
    setRounds((rs) => [...rs, makeRound(rs.length + 1)])
    setPhase('flash1')
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
            A scene flashes by. Answer fast: how many, what color, or what went missing.{' '}
            {isEndless
              ? `${ENDLESS_LIVES} lives — it gets harder the longer you survive.`
              : `${FIXED_ROUNDS} rounds, each faster and busier than the last.`}
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {(phase === 'flash1' ||
        phase === 'gap' ||
        phase === 'flash2' ||
        phase === 'guessing' ||
        phase === 'roundResult') &&
        current && (
          <div>
            {isEndless ? (
              <EndlessHud round={rounds.length} lives={lives} />
            ) : (
              <RoundProgress index={currentIndex} total={FIXED_ROUNDS} />
            )}
            <div
              style={{
                textAlign: 'center',
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: 0.4,
                color: 'var(--text-faint)',
                textTransform: 'uppercase',
                marginBottom: 10,
                height: 16,
              }}
            >
              {headerLabel(phase, current)}
            </div>
            <div
              onClick={
                current.questionType === 'missing' && phase === 'guessing'
                  ? handleMissingClick
                  : undefined
              }
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '1 / 1',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--bg-card)',
                overflow: 'hidden',
                cursor:
                  current.questionType === 'missing' && phase === 'guessing'
                    ? 'pointer'
                    : 'default',
                touchAction: 'manipulation',
              }}
            >
              {phase === 'flash1' &&
                current.shapes.map((s, i) => <ShapeView key={i} shape={s} />)}

              {phase === 'flash2' &&
                current.shapes
                  .filter((_, i) => i !== current.missingIndex)
                  .map((s, i) => <ShapeView key={i} shape={s} />)}

              {phase === 'roundResult' &&
                current.questionType === 'missing' &&
                current.missingIndex >= 0 && (
                  <>
                    {current.shapes
                      .filter((_, i) => i !== current.missingIndex)
                      .map((s, i) => (
                        <ShapeView key={i} shape={s} />
                      ))}
                    <RingMarker
                      xPct={current.shapes[current.missingIndex].x}
                      yPct={current.shapes[current.missingIndex].y}
                      color="var(--success)"
                    />
                    {current.positionGuess && current.score < 100 && (
                      <ClickMarker
                        xPct={current.positionGuess.xPct}
                        yPct={current.positionGuess.yPct}
                        color="var(--danger)"
                      />
                    )}
                  </>
                )}

              {phase === 'roundResult' && current.questionType === 'count' && (
                <>{current.shapes.map((s, i) => <ShapeView key={i} shape={s} />)}</>
              )}

              {phase === 'roundResult' && current.questionType === 'color' && (
                <>
                  {current.shapes.map((s, i) => <ShapeView key={i} shape={s} />)}
                  {current.circleIndex >= 0 && (
                    <RingMarker
                      xPct={current.shapes[current.circleIndex].x}
                      yPct={current.shapes[current.circleIndex].y}
                      color="var(--success)"
                    />
                  )}
                </>
              )}
            </div>

            {phase === 'guessing' && current.questionType === 'count' && (
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <Stepper value={guessDraft} onChange={setGuessDraft} />
                <div style={{ marginTop: 20 }}>
                  <PlayButton onClick={submitCountGuess} label="Lock in guess" />
                </div>
              </div>
            )}

            {phase === 'guessing' && current.questionType === 'color' && (
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <ColorSwatchRow colors={PALETTE} guess={null} onPick={submitColorGuess} />
              </div>
            )}

            {phase === 'roundResult' && current.questionType === 'count' && (
              <div style={{ textAlign: 'center', marginTop: 20 }}>
                <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
                  You guessed {current.countGuess} · actual was {current.m}
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

            {phase === 'roundResult' && current.questionType === 'color' && (
              <div style={{ textAlign: 'center', marginTop: 20 }}>
                <ColorSwatchRow
                  colors={PALETTE}
                  guess={current.colorGuess}
                  correct={current.shapes[current.circleIndex]?.color}
                  disabled
                />
                <div style={{ fontSize: 32, fontWeight: 700, margin: '16px 0 20px' }}>
                  {current.score.toFixed(0)}
                  <span style={{ fontSize: 16, color: 'var(--text-faint)' }}>/100</span>
                </div>
                <PlayButton
                  onClick={nextRound}
                  label={isRunOver ? 'See results' : 'Next round'}
                />
              </div>
            )}

            {phase === 'roundResult' && current.questionType === 'missing' && (
              <div style={{ textAlign: 'center', marginTop: 20 }}>
                <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
                  {current.distance.toFixed(0)}px off
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
                  <span>{QUESTION_LABEL[r.questionType]}</span>
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

function ShapeView({ shape }: { shape: Shape }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${shape.x}%`,
        top: `${shape.y}%`,
        width: `${SHAPE_SIZE_PCT}%`,
        height: `${SHAPE_SIZE_PCT}%`,
        transform: 'translate(-50%, -50%)',
        borderRadius: shape.kind === 'circle' ? '50%' : '18%',
        background: shape.color,
      }}
    />
  )
}

function RingMarker({ xPct, yPct, color }: { xPct: number; yPct: number; color: string }) {
  const ringSize = SHAPE_SIZE_PCT + 10
  return (
    <div
      style={{
        position: 'absolute',
        left: `${xPct}%`,
        top: `${yPct}%`,
        width: `${ringSize}%`,
        height: `${ringSize}%`,
        transform: 'translate(-50%, -50%)',
        borderRadius: '50%',
        border: `3px solid ${color}`,
        boxSizing: 'border-box',
        pointerEvents: 'none',
      }}
    />
  )
}

function ClickMarker({ xPct, yPct, color }: { xPct: number; yPct: number; color: string }) {
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

function ColorSwatchRow({
  colors,
  guess,
  correct,
  onPick,
  disabled,
}: {
  colors: string[]
  guess: string | null
  correct?: string
  onPick?: (color: string) => void
  disabled?: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
      {colors.map((c) => {
        const isCorrect = correct === c
        const isWrongGuess = correct !== undefined && guess === c && !isCorrect
        const border = isCorrect
          ? '3px solid var(--success)'
          : isWrongGuess
            ? '3px solid var(--danger)'
            : '1px solid var(--border)'
        return (
          <button
            key={c}
            onClick={() => onPick?.(c)}
            disabled={disabled}
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: c,
              border,
              cursor: disabled ? 'default' : 'pointer',
              padding: 0,
            }}
          />
        )
      })}
    </div>
  )
}

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
