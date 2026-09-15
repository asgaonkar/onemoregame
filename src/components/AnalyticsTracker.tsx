import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { getGame } from '../data/games'
import { initAnalytics, trackPageView } from '../lib/analytics'

// Renders nothing — just fires a page_view on every route change, which
// HashRouter navigation wouldn't otherwise produce (see analytics.ts).
export function AnalyticsTracker() {
  const location = useLocation()
  const startedRef = useRef(false)

  useEffect(() => {
    if (!startedRef.current) {
      initAnalytics()
      startedRef.current = true
    }
    const id = location.pathname.replace(/^\//, '')
    const game = getGame(id)
    const title = game ? `${game.name} · onemoregame` : id ? `${id} (not found) · onemoregame` : 'onemoregame'
    trackPageView(location.pathname || '/', title)
  }, [location.pathname])

  return null
}
