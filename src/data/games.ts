export type GameCategory = 'Memory' | 'Precision' | 'Timing' | 'Perception'

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
    status: 'soon',
  },
  {
    id: 'swap',
    name: 'Swap',
    tagline: 'Objects swap places fast. Find where one ended up.',
    category: 'Memory',
    status: 'soon',
  },
  {
    id: 'guess-distance',
    name: 'Guess Distance',
    tagline: 'Two points flash briefly. Recall the gap between them.',
    category: 'Memory',
    status: 'soon',
  },
  {
    id: 'perfect-circle',
    name: 'Perfect Circle',
    tagline: 'Draw a circle freehand. Scored on geometry.',
    category: 'Precision',
    status: 'soon',
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
    status: 'soon',
  },
  {
    id: 'predict',
    name: 'Predict',
    tagline: 'Watch it move, then call where it stops.',
    category: 'Timing',
    status: 'soon',
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
    status: 'soon',
  },
  {
    id: 'count',
    name: 'Count',
    tagline: 'A crowd of objects flashes by. How many?',
    category: 'Perception',
    status: 'soon',
  },
]

export const categoryOrder: GameCategory[] = [
  'Memory',
  'Precision',
  'Timing',
  'Perception',
]

export function getGame(id: string): GameMeta | undefined {
  return games.find((g) => g.id === id)
}
