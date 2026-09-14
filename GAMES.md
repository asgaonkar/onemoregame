# Games

How each game works, how it's scored, and how it gets harder round to round.

All games share one difficulty engine: `difficultyForRound(round, mode)` returns a value `t` from
`0` (easiest) to `1` (hardest) for the current round:

- **Practice** — flat `t = 0.08` (always easy, unlimited attempts, not saved to any leaderboard).
- **Endless** — `t = min(1, (round - 1) / 11)`, ramping to full difficulty by round 12. You get 3
  lives; a life is lost on a miss (see each game's rules below), and your score is the number of
  rounds survived.
- **Daily** / **VS** — `t = (round - 1) / 4` across a fixed run of 5 rounds, using a shared seed
  (today's date for Daily, a random seed shared by all players for VS) so everyone sees the same
  sequence of rounds.

Each game turns `t` into its own concrete parameters — smaller targets, shorter timers, more
items to track, and so on. Unless noted otherwise, a round score below 40 counts as a "miss" and
costs a life in Endless mode, and a fixed-length run's final score is the average of its 5 round
scores.

---

## Trace *(Memory · easy–medium)*

Watch a path drawn between a handful of waypoints, then redraw it from memory on a blank board.

**Scoring:** both the original path and your drawn stroke are resampled to 40 evenly-spaced
points, and the average distance between corresponding points (in board-percentage space, so
screen size doesn't matter) becomes `avgDist`. Score is `100 * (1 - avgDist / 50)`, clamped to
0–100 — closer tracing means a higher score.

**Difficulty:** waypoint count grows from 4 to 8 (`round(4 + 4t)`), and the memorization window
shrinks from 2.5s to 1.1s (`round(2500 - 1400t)` ms) — more turns to remember, less time to study
them.

---

## Swap *(Memory · easy)*

One token is highlighted, then the board runs a chain of swaps. Once it stops, click the slot you
believe the highlighted token ended up in.

**Scoring:** binary. A wrong slot scores 0. A correct slot scores `round(60 + 40t)` — 60 points on
an easy round, up to 100 on the hardest, so harder rounds pay off more for getting it right.

**Difficulty:** the swap chain lengthens from 4 to 9 swaps (`round(4 + 5t)`), the initial reveal
window shortens from 900ms to 500ms, and each individual swap animates faster (550ms down to
280ms) — more to track, less time to lock onto it.

**Unique mechanic:** the highlight is only ever visible during the initial reveal. The instant
shuffling begins, the highlight turns off and every token looks identical, so you can't just track
the highlighted color through the swaps — you have to track the swap sequence itself.

---

## Guess Distance *(Memory · hard)*

Two dots flash briefly somewhere on the board, then vanish. Enter your best guess for the pixel
distance between them — you're given a hint range to guess within, but the true answer isn't
necessarily in the middle of it.

**Scoring:** `100 * (1 - |guess - actual| / diagonal)`, clamped at 0, where `diagonal` is the
board's pixel diagonal — so the penalty for being off scales with how large the board is.

**Difficulty:** the minimum separation between the two dots widens from 20% to 55% of the board
(harder to judge relative distance at a glance), the flash duration shrinks from 1.5s to 0.6s, and
the hint range narrows from ±60% of the true value down to ±25% — but its width is the only thing
that changes; where the true value falls inside that range is randomized every round.

---

## Center *(Precision · easy)*

Click the exact center of a shape. Two sub-modes, picked once per run:

- **Regular** — a rectangle that gradually fades out.
- **Irregular** — a lopsided polygon; click its centroid, not its bounding-box center.

**Scoring (regular):** `100 * (1 - distance / maxDist)`, where `maxDist` is half the box's
diagonal. **Scoring (irregular):** `100 * (1 - distance / meanVertexDist)`, where
`meanVertexDist` is the average distance from the true centroid to each of the shape's vertices.

**Difficulty (regular):** the box shrinks (`sizeFactor = 1 - 0.45t`) and fades out faster — from a
3s fade down to 0.9s. **Difficulty (irregular):** vertex count grows from 6 to 11
(`round(6 + 5t)`) and an "irregularity" factor rises from 0.12 to 0.55, producing progressively
more lopsided shapes whose visual center is harder to eyeball.

---

## Wait *(Timing · medium)*

Start a stopwatch, then stop it as close as you can to a hidden target time.

**Scoring:** raw milliseconds off target — `diffMs = |elapsedMs - targetMs|`. Lower is better; a
fixed-length run's final score is the *average* `diffMs` across its rounds, and leaderboards sort
ascending (fastest/most-accurate first). There's no 0–100 conversion and no visible tolerance —
you're always chasing an exact number.

**Difficulty:** the target time is drawn from a random 2–7s window, then rounded to a step size
that shrinks from 500ms (easy — round numbers like 3.0s) down to ~50ms (hard — awkward numbers
like 3.87s), making it much harder to anticipate the target by feel.

**Endless life rule:** unlike other games, Endless doesn't use the standard "score below 40"
miss rule. Instead there's an internal, never-displayed cutoff that tightens from 600ms down to
250ms (`600 - 350t`); go over it and you lose a life.

---

## Crowd *(Perception · easy–medium)*

One dot in a crowd is highlighted, then the whole crowd scatters and moves. Once everything stops,
click the dot you tracked.

**Scoring:** binary hit/miss. Click near enough to the tracked dot's final position (and it has to
be the closest dot to your click) and you score 100; otherwise 0.

**Difficulty:** the crowd grows from 8 dots up to 17 (Daily/VS) or 26 (Endless), the scatter
lasts longer (3.5s up to 5.5s — more time for your eyes to lose the thread), and individual dot
speed increases, all making the target harder to keep visually locked on.

---

## Blink *(Perception · easy)*

Study a scene of shapes, watch it blink off, then blink back on with exactly one shape changed —
moved, resized, or recolored. Click the shape that changed.

**Scoring:** binary. Click within range of the changed shape's new position and score 100;
otherwise 0.

**Difficulty:** shape count grows (roughly 6 to 13), each preview shows for less time (1.7s down
to 0.8s), and — crucially — the change itself gets subtler: move distance shrinks, resize factors
move closer to 1 (a smaller size change), and recolors are drawn from a narrower pool of
similar-looking hues.

**Unique mechanic:** this is a genuine two-blink sequence, not a single before/after. You see the
original scene, a blank 1.5s gap, then the modified scene, then you guess — mimicking an actual
blink-and-you-missed-it moment rather than a side-by-side comparison.

---

## Count *(Perception · medium)*

A burst of dots flashes on screen very briefly. Guess how many there were.

**Scoring:** `100 * (1 - |guess - count| / count)`, clamped to 0–100.

**Difficulty:** both the minimum and maximum possible dot count rise as rounds progress (roughly
8–20 dots early on, up to 35–45 late), and the flash duration shrinks from 1.2s to 0.5s — more to
count, less time to count it.

---

## Mirror *(Memory · hard)*

Memorize the positions of a few numbered points on the left half of a board, then click their
mirror-image positions on the right half, in order.

**Scoring:** each placement is scored by its percentage-space distance to the true mirrored
target (`100 * (1 - d/20)`, clamped, capped at 20% of the board as a total miss); a round's score
is that same formula applied to the *average* distance across all placements. Scoring intentionally
uses percentage-space rather than raw pixels, so playing on a bigger or smaller screen doesn't make
the game easier or harder.

**Difficulty:** point count grows from 4 to 7 (`round(4 + 3t)`), and the memorization window
shrinks from 2.2s to 1.0s.

---

## Reflex *(Timing · easy)*

Wait for a target to appear, then click it as fast as you possibly can. Click too early and it's a
false start.

**Scoring:** raw reaction time in milliseconds — lower wins. A hit records your actual reaction
time; a false start or a timeout records a fixed 2000ms penalty. A fixed-length run's final score
is the *average* time across its rounds, and leaderboards sort ascending (fastest first). There's
no 0–100 scale here.

**Difficulty:** the target shrinks from 16% down to 7% of the board, and your response window
tightens from 1.2s down to 0.55s before it counts as a timeout. The random appearance delay itself
(0.6–2.2s) doesn't change — only how small and how quick you need to be once it appears.

**Endless life rule:** any outcome other than a clean hit — false start or timeout — costs a
life, regardless of score.

---

## Sequence *(Memory · easy)*

Watch a sequence of tiles light up, then tap them back in the same order.

**Scoring:** `100 * (correctCount / sequenceLength)`, where `correctCount` is how many taps you
got right before your first mistake (or the full sequence if you were flawless).

**Difficulty:** the number of tiles on the board grows from 4 to 6, the sequence length grows
from 3 to 8 steps, and each step flashes for less time (600ms down to 320ms).

---

## Aim *(Precision · easy)*

Click as many targets as you can inside one timed session — a "round" here is the whole session,
not a single click.

**Scoring:** `100 * (hits / expectedHits) * accuracy`, clamped to 0–100, where `expectedHits` is
based on a pace of 1.4 hits/second for the session's length, and `accuracy = hits / (hits + misses)`.

**Difficulty:** the session shortens from 10s to 6s, targets shrink from 9% to 4% of the board
width, and past the halfway difficulty mark targets start moving, with their speed increasing the
harder the round gets.

---

## Risk *(Strategy · medium)*

A press-your-luck ladder. At each rung you can **Take** your current points, or **Push** to risk
busting (scoring 0 for the round) for a shot at the next, more valuable rung.

**Scoring:** cumulative, not averaged. Cashing out at a rung awards its fixed value —
`10, 20, 35, 55, 80, 115, 160, 220` for rungs 1–8; busting awards 0 for that round. Your total
across a run is the sum of every round's outcome.

**Difficulty:** the chance of busting on each push rises with round difficulty — from a base of
3%–72% per rung (higher rungs are always riskier) up to as much as +15 percentage points more at
full difficulty. Bust outcomes are derived deterministically from the run's seed, round, and rung
rather than pure chance in the moment, so VS players facing the same choices see the same results.

**Endless life rule:** a life is lost only on a bust — cashing out never costs a life, and Risk
doesn't use the standard score-based miss rule at all.

---

## Match *(Memory · easy)*

A grid of face-down cards. Flip them two at a time to find every matching color pair in as few
moves as possible.

**Scoring:** `100 - (moves - pairCount) * penaltyPerExtraMove`, clamped to 0–100, where
`penaltyPerExtraMove = 100 / (pairCount * 1.5)`. A perfect run (moves = pairs) scores 100; a run
that takes 2.5× as many moves as pairs scores 0.

**Difficulty:** the number of pairs grows from 4 to 7 (8–14 cards total), and the color palette
narrows toward hues clustered around a random anchor color as rounds get harder — so pairs get
visually harder to tell apart, not just more numerous.

---

## Modes reference

| Mode | Rounds | Difficulty ramp | Saved to leaderboard? |
|---|---|---|---|
| Daily | 5, fixed seed (today's date) | 0 → 1 over 5 rounds | Yes, once per day |
| Endless | Until 3 lives lost | 0 → 1 by round 12, then capped | Yes, score = rounds survived |
| Practice | Unlimited | Flat, always easy (`t = 0.08`) | No |
| VS (2–4 players) | 5, shared random seed | 0 → 1 over 5 rounds | Local pass-and-play, compared at the end |
