import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { getGame } from '../data/games'
import { initAnalytics, trackPageView } from '../lib/analytics'

// Renders nothing — just fires a page_view on every route change after the
// first, which HashRouter navigation wouldn't otherwise produce (see
// analytics.ts). The first page_view is left to gtag.js's own reliable
// auto-send on init instead of a manually-pushed one.
export function AnalyticsTracker() {
  const location = useLocation()
  const startedRef = useRef(false)

  useEffect(() => {
    if (!startedRef.current) {
      initAnalytics()
      startedRef.current = true
      return
    }
    const id = location.pathname.replace(/^\//, '')
    const game = getGame(id)
    const title = game ? `${game.name} · onemoregame` : id ? `${id} (not found) · onemoregame` : 'onemoregame'
    trackPageView(location.pathname || '/', title)
  }, [location.pathname])

  return null
}
