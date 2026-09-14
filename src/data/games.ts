export type GameCategory =
  | 'Memory'
  | 'Precision'
  | 'Timing'
  | 'Perception'
  | 'Strategy'

export type GameStatus = 'live' | 'soon'

export type GameMeta = {
  id: string
  name: string
  tagline: string
  category: GameCategory
  status: GameStatus
}

export const games: GameMeta[] = [
  {
    id: 'trace',
    name: 'Trace',
    tagline: 'Watch a path, then redraw it from memory.',
    category: 'Memory',
    status: 'live',
  },
  {
    id: 'swap',
    name: 'Swap',
    tagline: 'Objects swap places fast. Find where one ended up.',
    category: 'Memory',
    status: 'live',
  },
  {
    id: 'guess-distance',
    name: 'Guess Distance',
    tagline: 'Two points flash briefly. Recall the gap between them.',
    category: 'Memory',
    status: 'live',
  },
  {
    id: 'center',
    name: 'Center',
    tagline: 'Click the exact center. Scored to the pixel.',
    category: 'Precision',
    status: 'live',
  },
  {
    id: 'wait',
    name: 'Wait',
    tagline: 'Stop the timer on an exact target.',
    category: 'Timing',
    status: 'live',
  },
  {
    id: 'crowd',
    name: 'Crowd',
    tagline: 'Track one dot through a moving crowd.',
    category: 'Perception',
    status: 'live',
  },
  {
    id: 'blink',
    name: 'Blink',
    tagline: 'Spot what changed between two flashes.',
    category: 'Perception',
    status: 'live',
  },
  {
    id: 'count',
    name: 'Count',
    tagline: 'A crowd of objects flashes by. How many?',
    category: 'Perception',
    status: 'live',
  },
  {
    id: 'mirror',
    name: 'Mirror',
    tagline: 'Memorize the pattern, then recreate its mirror image.',
    category: 'Memory',
    status: 'live',
  },
  {
    id: 'reflex',
    name: 'Reflex',
    tagline: 'Wait for it, then click as fast as you can.',
    category: 'Timing',
    status: 'live',
  },
  {
    id: 'sequence',
    name: 'Sequence',
    tagline: 'Watch the sequence, then repeat it back.',
    category: 'Memory',
    status: 'live',
  },
  {
    id: 'aim',
    name: 'Aim',
    tagline: 'Click as many targets as you can before time runs out.',
    category: 'Precision',
    status: 'live',
  },
  {
    id: 'risk',
    name: 'Risk',
    tagline: 'Cash out, or push your luck for more.',
    category: 'Strategy',
    status: 'live',
  },
  {
    id: 'match',
    name: 'Match',
    tagline: 'Flip cards to find every matching pair.',
    category: 'Memory',
    status: 'live',
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
