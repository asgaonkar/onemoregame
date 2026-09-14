import { useEffect, useState } from 'react'

export type PointerKind = 'coarse' | 'fine'

function matches(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
}

// 'coarse' = touch/stylus-primary input (phone, tablet); 'fine' = mouse or
// trackpad-primary input (laptop, desktop). Used to show which games suit
// the visitor's device — it's informational only, never gates anything.
export function usePointerKind(): PointerKind {
  const [coarse, setCoarse] = useState(matches)

  useEffect(() => {
    const mql = window.matchMedia('(pointer: coarse)')
    const onChange = () => setCoarse(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return coarse ? 'coarse' : 'fine'
}
