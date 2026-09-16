// Google Analytics 4 (gtag.js), loaded lazily and only when a real
// Measurement ID has been set below.
const GA_MEASUREMENT_ID: string = 'G-W86TX6VSJN'

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
  // Left at its default (auto page_view on config) instead of disabling it:
  // that first hit's delivery is handled by gtag.js's own internal load
  // sequencing, which is reliable. A manually-pushed page_view event fired
  // in the same synchronous tick — before gtag.js has even been fetched —
  // is not: it depends on gtag.js correctly flushing a pre-load dataLayer
  // backlog, which in practice doesn't always happen. HashRouter route
  // changes after this first load still need manual tracking (see
  // AnalyticsTracker), since they never trigger a real page load, but by
  // then gtag.js has had plenty of time to finish loading.
  window.gtag('config', GA_MEASUREMENT_ID)
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
