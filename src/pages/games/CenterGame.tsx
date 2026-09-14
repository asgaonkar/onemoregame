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

const GAME_ID = 'center'

type ShapeType = 'regular' | 'irregular'

// Box position/size are percentages of the stage (0-100), so no DOM
// measurement is needed to generate a round — only the click handler
// needs the stage's real pixel rect, and the stage always exists by then.
type Box = { x: number; y: number; w: number; h: number }

type Point = { x: number; y: number }

type Round = {
  t: number
  box: Box | null
  polygon: Point[] | null
  centroid: Point | null
  guess: { xPct: number; yPct: number } | null
  distance: number
  score: number
}

// t: 0 (easiest) -> 1 (hardest). Harder rounds get a smaller box.
function randomBox(rng: Rng, t: number): Box {
  const sizeFactor = 1 - 0.45 * t
  const w = (35 + rng() * 30) * sizeFactor
  const h = (30 + rng() * 30) * sizeFactor
  const x = (100 - w) * (0.1 + rng() * 0.8)
  const y = (100 - h) * (0.1 + rng() * 0.8)
  return { x, y, w, h }
}

function scoreFor(
  box: Box,
  guess: { xPct: number; yPct: number },
  rectW: number,
  rectH: number,
) {
  const cxPx = ((box.x + box.w / 2) / 100) * rectW
  const cyPx = ((box.y + box.h / 2) / 100) * rectH
  const gxPx = (guess.xPct / 100) * rectW
  const gyPx = (guess.yPct / 100) * rectH
  const distance = Math.hypot(gxPx - cxPx, gyPx - cyPx)
  const maxDist = Math.hypot((box.w / 100) * rectW, (box.h / 100) * rectH) / 2
  const score = Math.max(0, 100 * (1 - distance / maxDist))
  return { distance, score }
}

// ---- Regular shape: fade-out difficulty mechanic ----

const FADE_MS_EASY = 3000
const FADE_MS_HARD = 900

function fadeDurationFor(t: number): number {
  return FADE_MS_EASY - (FADE_MS_EASY - FADE_MS_HARD) * t
}

// ---- Irregular shape: random polygon + true centroid ----

const MIN_VERTICES = 6
const MAX_VERTICES = 11
const MIN_IRREGULARITY = 0.12
const MAX_IRREGULARITY = 0.55

function vertexCountFor(t: number): number {
  return Math.round(MIN_VERTICES + (MAX_VERTICES - MIN_VERTICES) * t)
}

function irregularityFor(t: number): number {
  return MIN_IRREGULARITY + (MAX_IRREGULARITY - MIN_IRREGULARITY) * t
}

function randomPolygon(rng: Rng, t: number): Point[] {
  const n = vertexCountFor(t)
  const irregularity = irregularityFor(t)
  const cx = 30 + rng() * 40 // keep the shape's rough center away from the very edge
  const cy = 30 + rng() * 40
  const baseRadius = 16 + rng() * 8 // 16-24
  const points: Point[] = []
  const evenStep = (2 * Math.PI) / n
  // Bound the angle jitter to less than half the even spacing so vertices
  // stay in angular order and the polygon can't self-intersect.
  const maxJitter = evenStep * 0.4
  for (let i = 0; i < n; i++) {
    const angle = i * evenStep + (rng() * 2 - 1) * maxJitter
    const radius = baseRadius * (1 + (rng() * 2 - 1) * irregularity)
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius
    // Clamp so the shape comfortably stays on the board even at max radius.
    points.push({ x: Math.min(94, Math.max(6, x)), y: Math.min(94, Math.max(6, y)) })
  }
  return points
}

function polygonCentroid(points: Point[]): Point {
  let area = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < points.length; i++) {
    const p0 = points[i]
    const p1 = points[(i + 1) % points.length]
    const cross = p0.x * p1.y - p1.x * p0.y
    area += cross
    cx += (p0.x + p1.x) * cross
    cy += (p0.y + p1.y) * cross
  }
  area *= 0.5
  if (Math.abs(area) < 1e-6) {
    // Degenerate fallback (shouldn't normally happen with this generator)
    const n = points.length
    return {
      x: points.reduce((s, p) => s + p.x, 0) / n,
      y: points.reduce((s, p) => s + p.y, 0) / n,
    }
  }
  cx /= 6 * area
  cy /= 6 * area
  return { x: cx, y: cy }
}

function scoreForPolygon(
  polygon: Point[],
  centroid: Point,
  guess: { xPct: number; yPct: number },
  rectW: number,
  rectH: number,
) {
  const cxPx = (centroid.x / 100) * rectW
  const cyPx = (centroid.y / 100) * rectH
  const gxPx = (guess.xPct / 100) * rectW
  const gyPx = (guess.yPct / 100) * rectH
  const distance = Math.hypot(gxPx - cxPx, gyPx - cyPx)
  const vertexDists = polygon.map((p) => {
    const px = (p.x / 100) * rectW
    const py = (p.y / 100) * rectH
    return Math.hypot(px - cxPx, py - cyPx)
  })
  const meanVertexDist = vertexDists.reduce((s, d) => s + d, 0) / vertexDists.length
  const score = Math.max(0, 100 * (1 - distance / meanVertexDist))
  return { distance, score }
}

export function CenterGame() {
  const [shapeType, setShapeType] = useState<ShapeType | null>(null)
  const [config, setConfig] = useState<RunConfig | null>(null)
  const gameId = shapeType ? `${GAME_ID}-${shapeType}` : GAME_ID

  return (
    <GameShell eyebrow="Precision" title="Center">
      {!shapeType ? (
        <ShapeTypePicker onPick={setShapeType} />
      ) : !config ? (
        <div>
          <GameModeSelect gameId={gameId} onStart={setConfig} />
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <LinkButton onClick={() => setShapeType(null)} label="Change shape" />
          </div>
        </div>
      ) : config.mode === 'vs' && config.vs ? (
        <VsSequencer
          playerCount={config.vs.playerCount}
          seed={config.seed}
          onExit={() => setConfig(null)}
          renderRun={(runConfig, onFinish) => (
            <CenterRun
              key={`${runConfig.seed}-${runConfig.vs?.playerIndex ?? 0}`}
              config={runConfig}
              shapeType={shapeType}
              gameId={gameId}
              onFinish={onFinish}
              onChangeMode={() => setConfig(null)}
            />
          )}
        />
      ) : (
        <CenterRun
          key={config.seed}
          config={config}
          shapeType={shapeType}
          gameId={gameId}
          onChangeMode={() => setConfig(null)}
          onPlayAgain={
            config.mode === 'daily'
              ? undefined
              : () => setConfig(createRunConfig(config.mode, gameId))
          }
        />
      )}
    </GameShell>
  )
}

const SHAPE_CARD_STYLE: React.CSSProperties = {
  textAlign: 'left',
  padding: 20,
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

function ShapeTypePicker({ onPick }: { onPick: (shapeType: ShapeType) => void }) {
  return (
    <div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: 0.6,
          color: 'var(--text-faint)',
          textTransform: 'uppercase',
          marginBottom: 16,
          textAlign: 'center',
        }}
      >
        Choose a shape
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        <button onClick={() => onPick('regular')} style={SHAPE_CARD_STYLE}>
          <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>Regular Shape</div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            A box appears and fades away. Click where its center was.
          </div>
        </button>
        <button onClick={() => onPick('irregular')} style={SHAPE_CARD_STYLE}>
          <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>Irregular Shape</div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            A lopsided shape appears. Click its true center of mass.
          </div>
        </button>
      </div>
    </div>
  )
}

function modeLabel(config: RunConfig): string {
  if (config.vs) return `Player ${config.vs.playerIndex + 1} of ${config.vs.playerCount}`
  if (config.mode === 'daily') return 'Daily challenge'
  if (config.mode === 'endless') return 'Endless'
  return 'Practice'
}

function CenterRun({
  config,
  shapeType,
  gameId,
  onFinish,
  onChangeMode,
  onPlayAgain,
}: {
  config: RunConfig
  shapeType: ShapeType
  gameId: string
  onFinish?: (score: number) => void
  onChangeMode: () => void
  onPlayAgain?: () => void
}) {
  const rng = useMemo(() => rngFor(config), [config])
  const isEndless = config.mode === 'endless'

  const [phase, setPhase] = useState<'intro' | 'playing' | 'roundResult' | 'done'>(
    'intro',
  )
  const [rounds, setRounds] = useState<Round[]>([])
  const [lives, setLives] = useState(ENDLESS_LIVES)
  const [runs, setRuns] = useState(() => getRuns(gameId, config.mode))

  const currentIndex = rounds.length - 1
  const current = rounds[currentIndex]

  function makeRound(roundNum: number): Round {
    const t = difficultyForRound(roundNum, config.mode)
    if (shapeType === 'regular') {
      return {
        t,
        box: randomBox(rng, t),
        polygon: null,
        centroid: null,
        guess: null,
        distance: 0,
        score: 0,
      }
    }
    const polygon = randomPolygon(rng, t)
    const centroid = polygonCentroid(polygon)
    return { t, box: null, polygon, centroid, guess: null, distance: 0, score: 0 }
  }

  function startGame() {
    setRounds([makeRound(1)])
    setLives(ENDLESS_LIVES)
    setPhase('playing')
  }

  function handleStageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (phase !== 'playing' || !current || current.guess) return
    const rect = e.currentTarget.getBoundingClientRect()
    const guess = {
      xPct: ((e.clientX - rect.left) / rect.width) * 100,
      yPct: ((e.clientY - rect.top) / rect.height) * 100,
    }
    const { distance, score } =
      shapeType === 'regular'
        ? scoreFor(current.box!, guess, rect.width, rect.height)
        : scoreForPolygon(current.polygon!, current.centroid!, guess, rect.width, rect.height)
    setRounds((rs) =>
      rs.map((r, i) => (i === currentIndex ? { ...r, guess, distance, score } : r)),
    )
    if (isEndless && isMiss(score)) setLives((l) => l - 1)
    setPhase('roundResult')
  }

  function finish(finalScore: number) {
    if (onFinish) {
      onFinish(finalScore)
      return
    }
    if (config.mode === 'daily') markDailyPlayed(gameId, finalScore)
    if (config.mode !== 'practice') setRuns(addRun(gameId, config.mode, finalScore))
    setPhase('done')
  }

  function nextRound() {
    if (isEndless) {
      if (lives <= 0) {
        finish(rounds.length)
        return
      }
      setRounds((rs) => [...rs, makeRound(rs.length + 1)])
      setPhase('playing')
      return
    }
    if (rounds.length >= FIXED_ROUNDS) {
      finish(rounds.reduce((s, r) => s + r.score, 0) / rounds.length)
      return
    }
    setRounds((rs) => [...rs, makeRound(rs.length + 1)])
    setPhase('playing')
  }

  const isRunOver = isEndless ? lives <= 0 : rounds.length >= FIXED_ROUNDS

  const centerXPct =
    current && shapeType === 'regular'
      ? current.box!.x + current.box!.w / 2
      : current?.centroid?.x
  const centerYPct =
    current && shapeType === 'regular'
      ? current.box!.y + current.box!.h / 2
      : current?.centroid?.y

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
            {shapeType === 'regular'
              ? 'A box appears and fades away. Click where its center was.'
              : 'A lopsided shape appears. Click its true center of mass.'}{' '}
            {isEndless
              ? `${ENDLESS_LIVES} lives — it gets harder the longer you survive.`
              : `${FIXED_ROUNDS} rounds, scored by how close you land.`}
          </p>
          <PlayButton onClick={startGame} label="Start" />
        </div>
      )}

      {(phase === 'playing' || phase === 'roundResult') && current && (
        <div>
          {isEndless ? (
            <EndlessHud round={rounds.length} lives={lives} />
          ) : (
            <RoundProgress index={currentIndex} total={FIXED_ROUNDS} />
          )}
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
              cursor: phase === 'playing' ? 'crosshair' : 'default',
              touchAction: 'manipulation',
            }}
          >
            {shapeType === 'regular' && current.box && (
              <FadingBox
                key={currentIndex}
                box={current.box}
                durationMs={fadeDurationFor(current.t)}
              />
            )}
            {shapeType === 'irregular' && current.polygon && (
              <svg
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <polygon
                  points={current.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="var(--accent)"
                  opacity={0.3}
                />
              </svg>
            )}
            {current.guess && centerXPct !== undefined && centerYPct !== undefined && (
              <>
                <Dot xPct={centerXPct} yPct={centerYPct} color="var(--accent)" />
                <Dot
                  xPct={current.guess.xPct}
                  yPct={current.guess.yPct}
                  color={current.score >= 70 ? 'var(--success)' : 'var(--danger)'}
                />
              </>
            )}
          </div>

          {phase === 'roundResult' && current.guess && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <div style={{ fontSize: 15, color: 'var(--text-dim)' }}>
                {current.distance.toFixed(0)}px off
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
                  <span>{r.distance.toFixed(0)}px off</span>
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

// Fades a freshly-mounted (or freshly-generated) box from its base opacity to
// fully transparent over `durationMs`. Re-runs whenever a new round's box (or
// its duration) comes in, via the `box`/`durationMs` deps — combined with a
// `key={currentIndex}` at the call site so each round gets a clean remount.
function FadingBox({ box, durationMs }: { box: Box; durationMs: number }) {
  const [faded, setFaded] = useState(false)

  useEffect(() => {
    setFaded(false)
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setFaded(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [box, durationMs])

  return (
    <div
      style={{
        position: 'absolute',
        left: `${box.x}%`,
        top: `${box.y}%`,
        width: `${box.w}%`,
        height: `${box.h}%`,
        border: '2px solid var(--accent)',
        borderRadius: 8,
        opacity: faded ? 0 : 0.85,
        transition: `opacity ${durationMs}ms linear`,
      }}
    />
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

function Dot({ xPct, yPct, color }: { xPct: number; yPct: number; color: string }) {
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
