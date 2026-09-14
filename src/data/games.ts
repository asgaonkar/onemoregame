export type GameCategory =
  | 'Memory'
  | 'Precision'
  | 'Timing'
  | 'Perception'
  | 'Strategy'

export type GameStatus = 'live' | 'soon'

// How simple the RULES are to grasp at a glance — not how hard the game is
// to score well at (that's the separate, dynamic per-round difficulty ramp
// every game already has). A game can be "easy" here and still get brutally
// hard in Endless mode.
export type GameComplexity = 'easy' | 'medium' | 'hard'

// Which input the game plays best with. 'both' means it works equally well
// with a mouse/trackpad or a touchscreen; 'mouse'/'touch' flags a game that's
// noticeably more precise or comfortable on that input type specifically.
export type BestOn = 'both' | 'mouse' | 'touch'

export type GameMeta = {
  id: string
  name: string
  tagline: string
  category: GameCategory
  status: GameStatus
  complexity: GameComplexity
  bestOn: BestOn
}

export const games: GameMeta[] = [
  {
    id: 'trace',
    name: 'Trace',
    tagline: 'Watch a path, then redraw it from memory.',
    category: 'Memory',
    status: 'live',
    complexity: 'medium',
    bestOn: 'both',
  },
  {
    id: 'swap',
    name: 'Swap',
    tagline: 'Objects swap places fast. Find where one ended up.',
    category: 'Memory',
    status: 'live',
    complexity: 'easy',
    bestOn: 'both',
  },
  {
    id: 'guess-distance',
    name: 'Guess Distance',
    tagline: 'Two points flash briefly. Recall the gap between them.',
    category: 'Memory',
    status: 'live',
    complexity: 'hard',
    bestOn: 'both',
  },
  {
    id: 'center',
    name: 'Center',
    tagline: 'Click the exact center. Scored to the pixel.',
    category: 'Precision',
    status: 'live',
    complexity: 'easy',
    bestOn: 'both',
  },
  {
    id: 'wait',
    name: 'Wait',
    tagline: 'Stop the timer on an exact target.',
    category: 'Timing',
    status: 'live',
    complexity: 'medium',
    bestOn: 'both',
  },
  {
    id: 'crowd',
    name: 'Crowd',
    tagline: 'Track one dot through a moving crowd.',
    category: 'Perception',
    status: 'live',
    complexity: 'easy',
    bestOn: 'mouse',
  },
  {
    id: 'blink',
    name: 'Blink',
    tagline: 'Spot what changed between two flashes.',
    category: 'Perception',
    status: 'live',
    complexity: 'easy',
    bestOn: 'both',
  },
  {
    id: 'count',
    name: 'Count',
    tagline: 'A crowd of objects flashes by. How many?',
    category: 'Perception',
    status: 'live',
    complexity: 'medium',
    bestOn: 'both',
  },
  {
    id: 'mirror',
    name: 'Mirror',
    tagline: 'Memorize the pattern, then recreate its mirror image.',
    category: 'Memory',
    status: 'live',
    complexity: 'hard',
    bestOn: 'both',
  },
  {
    id: 'reflex',
    name: 'Reflex',
    tagline: 'Wait for it, then click as fast as you can.',
    category: 'Timing',
    status: 'live',
    complexity: 'easy',
    bestOn: 'mouse',
  },
  {
    id: 'sequence',
    name: 'Sequence',
    tagline: 'Watch the sequence, then repeat it back.',
    category: 'Memory',
    status: 'live',
    complexity: 'easy',
    bestOn: 'both',
  },
  {
    id: 'aim',
    name: 'Aim',
    tagline: 'Click as many targets as you can before time runs out.',
    category: 'Precision',
    status: 'live',
    complexity: 'easy',
    bestOn: 'mouse',
  },
  {
    id: 'risk',
    name: 'Risk',
    tagline: 'Cash out, or push your luck for more.',
    category: 'Strategy',
    status: 'live',
    complexity: 'medium',
    bestOn: 'both',
  },
  {
    id: 'match',
    name: 'Match',
    tagline: 'Flip cards to find every matching pair.',
    category: 'Memory',
    status: 'live',
    complexity: 'easy',
    bestOn: 'both',
  },
]

export const categoryOrder: GameCategory[] = [
  'Memory',
  'Precision',
  'Timing',
  'Perception',
  'Strategy',
]

export function getGame(id: string): GameMeta | undefined {
  return games.find((g) => g.id === id)
}
