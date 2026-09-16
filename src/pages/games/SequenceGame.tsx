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

const GAME_ID = 'sequence'

// Fixed content palette for the tiles themselves (like BlinkGame's shape
// colors) — UI chrome still uses CSS vars everywhere else.
const PALETTE = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899']

// A perfect round's ceiling scales with difficulty, same as Swap/Crowd/Blink
// — a longer, faster sequence pays more for a flawless repeat than a short,
// slow one, on top of the partial credit for how far you got.
const SCORE_CEILING_MIN = 60
const SCORE_CEILING_MAX = 100

type Round = {
  t: number
  tileCount: number
  stepMs: number
  sequence: number[]
  correctCount: number
  score: number
}

export function SequenceGame() {
  const [config, setConfig] = useState<RunConfig | null>(null)

  return (
    <GameShell eyebrow="Memory" title="Sequence">
      {!config ? (
        <GameModeSelect gameId={GAME_ID} onStart={setConfig} />
      ) : config.mode === 'vs' && config.vs ? (
        <VsSequencer
          playerCount={config.vs.playerCount}
          seed={config.seed}
          onExit={() => setConfig(null)}
          renderRun={(runConfig, onFinish) => (
            <SequenceRun
              key={`${runConfig.seed}-${runConfig.vs?.playerIndex ?? 0}`}
              config={runConfig}
              onFinish={onFinish}
              onChangeMode={() => setConfig(null)}
            />
          )}
        />
      ) : (
        <SequenceRun
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

function SequenceRun({
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

  const [phase, setPhase] = useState<'intro' | 'playback' | 'input' | 'roundResult' | 'done'>(
    'intro',
  )
  const [rounds, setRounds] = useState<Round[]>([])
  const [lives, setLives] = useState(ENDLESS_LIVES)
  const [runs, setRuns] = useState(() => getRuns(GAME_ID, config.mode))
  const [highlight, setHighlight] = useState<number | null>(null)
  const [tapIndex, setTapIndex] = useState(0)

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]
  // Guards against a round being completed twice — e.g. a rapid double-tap
  // on a tile before React re-renders and `phase` reflects the change.
  const processedRef = useRef(-1)

  function makeRound(roundNum: number): Round {
    const t = difficultyForRound(roundNum, config.mode)
    const tileCount = Math.round(4 + 2 * t)
    const length = Math.round(3 + 5 * t)
    const stepMs = Math.round(600 - 280 * t)
    const sequence = Array.from({ length }, () => Math.floor(rng() * tileCount))
    return { t, tileCount, stepMs, sequence, correctCount: 0, score: 0 }
  }

  // Steps through the current round's sequence, highlighting one tile at a
  // time, then hands off to the input phase. Timeouts are scheduled up front
  // (rather than recursively) so cleanup on round/phase change is trivial.
  useEffect(() => {
    if (phase !== 'playback' || !current) return
    const timers: ReturnType<typeof setTimeout>[] = []
    let elapsed = 0
    for (const tile of current.sequence) {
      const onAt = elapsed
      timers.push(setTimeout(() => setHighlight(tile), onAt))
      elapsed += current.stepMs
      const offAt = elapsed
      timers.push(setTimeout(() => setHighlight(null), offAt))
      elapsed += current.stepMs * 0.3
    }
    timers.push(
      setTimeout(() => {
        setHighlight(null)
        setTapIndex(0)
        setPhase('input')
      }, elapsed),
    )
    return () => timers.forEach(clearTimeout)
  }, [phase, currentIndex, current])

  function startGame() {
    setRounds([makeRound(1)])
    setLives(ENDLESS_LIVES)
    setPhase('playback')
  }

  function completeRound(correctCount: number) {
    if (!current || processedRef.current === currentIndex) return
    processedRef.current = currentIndex
    const ceiling = SCORE_CEILING_MIN + (SCORE_CEILING_MAX - SCORE_CEILING_MIN) * current.t
    const score = Math.round(ceiling * (correctCount / current.sequence.length))
    setRounds((rs) =>
      rs.map((r, i) => (i === currentIndex ? { ...r, correctCount, score } : r)),
    )
    if (isEndless && isMiss(score)) setLives((l) => l - 1)
    setPhase('roundResult')
  }

  function handleTileTap(tileIdx: number) {
    if (phase !== 'input' || !current) return
    const expected = current.sequence[tapIndex]
    if (tileIdx !== expected) {
      completeRound(tapIndex)
      return
    }
    const next = tapIndex + 1
    if (next >= current.sequence.length) {
      completeRound(next)
      return
    }
    setTapIndex(next)
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
      setRounds((rs) => [...rs, makeRound(rs.length + 1)])
      setPhase('playback')
      return
    }
    if (rounds.length >= FIXED_ROUNDS) {
      finish(rounds.filter((r) => r.correctCount === r.sequence.length).length)
      return
    }
    setRounds((rs) => [...rs, makeRound(rs.length + 1)])
    setPhase('playback')
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
            Watch the tiles light up in order, then tap them back the same way.{' '}
            {isEndless
              ? `${ENDLESS_LIVES} lives — it gets harder the longer you survive.`
              : `${FIXED_ROUNDS} rounds, scored by how far you get before a mistake.`}
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {(phase === 'playback' || phase === 'input' || phase === 'roundResult') && current && (
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
              color:
                phase === 'roundResult'
                  ? current.correctCount === current.sequence.length
                    ? 'var(--success)'
                    : 'var(--danger)'
                  : 'var(--text-faint)',
              textTransform: 'uppercase',
              marginBottom: 16,
              height: 16,
              transition: 'color 0.15s ease',
            }}
          >
            {phase === 'playback' && 'Watch closely'}
            {phase === 'input' && 'Repeat it back'}
            {phase === 'roundResult' &&
              (current.correctCount === current.sequence.length ? 'Perfect' : 'Missed one')}
          </div>

          <TileGrid
            tileCount={current.tileCount}
            highlight={phase === 'playback' ? highlight : null}
            disabled={phase !== 'input'}
            onTap={handleTileTap}
          />

          {phase === 'input' && (
            <TapProgress done={tapIndex} total={current.sequence.length} />
          )}

          {phase === 'roundResult' && (
            <>
              <SequenceReveal sequence={current.sequence} correctCount={current.correctCount} />
              <div style={{ textAlign: 'center', marginTop: 12 }}>
                <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
                  {current.correctCount} of {current.sequence.length} correct
                </div>
                <div
                  style={{
                    fontSize: 14,
                    color: 'var(--text-faint)',
                    margin: '4px 0 20px',
                  }}
                >
                  {current.sequence.length} tiles · {current.stepMs}ms/tile
                </div>
                <PlayButton
                  onClick={nextRound}
                  label={isRunOver ? 'See results' : 'Next round'}
                />
              </div>
            </>
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
                    {r.correctCount === r.sequence.length ? 'Perfect' : 'Missed one'}
                  </span>
                  <span>
                    {r.sequence.length} tiles · {r.stepMs}ms/tile
                  </span>
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
                  {rounds.filter((r) => r.correctCount === r.sequence.length).length}
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

function TileGrid({
  tileCount,
  highlight,
  disabled,
  onTap,
}: {
  tileCount: number
  highlight: number | null
  disabled: boolean
  onTap: (index: number) => void
}) {
  const cols = tileCount <= 4 ? 2 : 3

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        padding: '20px 16px',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-card)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, minmax(58px, 84px))`,
          gap: 14,
        }}
      >
        {Array.from({ length: tileCount }).map((_, i) => (
          <Tile
            key={i}
            color={PALETTE[i % PALETTE.length]}
            lit={highlight === i}
            disabled={disabled}
            onTap={() => onTap(i)}
            label={`Tile ${i + 1}`}
          />
        ))}
      </div>
    </div>
  )
}

function Tile({
  color,
  lit,
  disabled,
  onTap,
  label,
}: {
  color: string
  lit: boolean
  disabled: boolean
  onTap: () => void
  label: string
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onTap}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={disabled}
      aria-label={label}
      style={{
        width: '100%',
        aspectRatio: '1 / 1',
        border: 'none',
        borderRadius: 'var(--radius-md)',
        background: lit ? color : 'var(--bg-raised)',
        boxShadow: lit
          ? `0 0 0 2px ${color}, 0 10px 26px -6px ${color}b3`
          : `inset 0 0 0 2px ${color}40`,
        transform: lit ? 'scale(1.07)' : hovered && !disabled ? 'scale(1.03)' : 'scale(1)',
        transition:
          'transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 180ms ease, background 120ms ease',
        cursor: disabled ? 'default' : 'pointer',
        padding: 0,
        touchAction: 'manipulation',
      }}
    />
  )
}

function TapProgress({ done, total }: { done: number; total: number }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        justifyContent: 'center',
        marginTop: 16,
      }}
    >
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: i < done ? 'var(--success)' : 'var(--border)',
            transform: i < done ? 'scale(1.15)' : 'scale(1)',
            transition: 'background 150ms ease, transform 150ms ease',
          }}
        />
      ))}
    </div>
  )
}

function SequenceReveal({
  sequence,
  correctCount,
}: {
  sequence: number[]
  correctCount: number
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 7,
        justifyContent: 'center',
        flexWrap: 'wrap',
        margin: '4px 0 4px',
      }}
    >
      {sequence.map((tile, i) => (
        <div
          key={i}
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: i <= correctCount ? PALETTE[tile % PALETTE.length] : 'var(--bg-raised)',
            border: i < correctCount ? 'none' : '1px solid var(--border)',
            opacity: i < correctCount ? 1 : i === correctCount ? 0.9 : 0.45,
            boxShadow: i === correctCount ? '0 0 0 2px var(--danger)' : 'none',
            transition: 'opacity 150ms ease, box-shadow 150ms ease',
          }}
        />
      ))}
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
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--accent)',
        color: 'var(--accent-text)',
        border: 'none',
        borderRadius: 999,
        padding: '14px 32px',
        fontSize: 16,
        fontWeight: 600,
        cursor: 'pointer',
        transform: hovered ? 'translateY(-1px) scale(1.02)' : 'none',
        boxShadow: hovered ? '0 8px 20px -6px var(--accent)' : 'none',
        transition: 'transform 150ms ease, box-shadow 150ms ease',
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
