// Google Analytics 4 (gtag.js), loaded lazily and only when a real
// Measurement ID has been set below. Replace the placeholder once you've
// created a free GA4 property at analytics.google.com (Admin > Create
// Property > Web > copy the "G-XXXXXXXXXX" Measurement ID).
const GA_MEASUREMENT_ID = 'G-XXXXXXXXXX'

declare global {
  interface Window {
    dataLayer: unknown[]
    gtag: (...args: unknown[]) => void
  }
}

let initialized = false

function isConfigured(): boolean {
  return /^G-[A-Z0-9]+$/.test(GA_MEASUREMENT_ID) && GA_MEASUREMENT_ID !== 'G-XXXXXXXXXX'
}

// Skipped on localhost so local dev/testing never pollutes real analytics.
function isLocalhost(): boolean {
  return ['localhost', '127.0.0.1'].includes(window.location.hostname)
}

export function initAnalytics(): void {
  if (initialized || typeof window === 'undefined' || !isConfigured() || isLocalhost()) return
  initialized = true

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`
  document.head.appendChild(script)

  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer.push(args)
  }
  window.gtag('js', new Date())
  // send_page_view is off: HashRouter navigations never trigger a real page
  // load or a pushState history event, so GA's automatic pageview tracking
  // can't see route changes. Page views are sent manually instead — see
  // AnalyticsTracker, which fires one per route change with the game's name
  // as the page path/title, which is what makes GA4's per-page "average
  // engagement time" report break down by game rather than lumping the
  // whole single-page app into one row.
  window.gtag('config', GA_MEASUREMENT_ID, { send_page_view: false })
}

export function trackPageView(path: string, title: string): void {
  if (!initialized) return
  window.gtag('event', 'page_view', {
    page_path: path,
    page_title: title,
    page_location: window.location.href,
  })
}

export function trackEvent(name: string, params?: Record<string, unknown>): void {
  if (!initialized) return
  window.gtag('event', name, params)
}
