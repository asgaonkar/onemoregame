import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { readJSON, writeJSON } from './storage'

type Theme = 'dark' | 'light'
export type BackgroundStyle = 'none' | 'dots' | 'lines'
export type BackgroundIntensity = 'subtle' | 'bold'

type ThemeContextValue = {
  theme: Theme
  toggleTheme: () => void
  bgStyle: BackgroundStyle
  setBgStyle: (style: BackgroundStyle) => void
  bgIntensity: BackgroundIntensity
  setBgIntensity: (intensity: BackgroundIntensity) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function getInitialTheme(): Theme {
  const stored = readJSON<Theme | null>('theme', null)
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark'
}

function getInitialBgStyle(): BackgroundStyle {
  const stored = readJSON<BackgroundStyle | null>('bgStyle', null)
  return stored === 'none' || stored === 'dots' || stored === 'lines' ? stored : 'dots'
}

function getInitialBgIntensity(): BackgroundIntensity {
  const stored = readJSON<BackgroundIntensity | null>('bgIntensity', null)
  return stored === 'subtle' || stored === 'bold' ? stored : 'bold'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [bgStyle, setBgStyle] = useState<BackgroundStyle>(getInitialBgStyle)
  const [bgIntensity, setBgIntensity] = useState<BackgroundIntensity>(getInitialBgIntensity)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    writeJSON('theme', theme)
  }, [theme])

  useEffect(() => {
    document.body.setAttribute('data-bg-style', bgStyle)
    writeJSON('bgStyle', bgStyle)
  }, [bgStyle])

  useEffect(() => {
    document.body.setAttribute('data-bg-intensity', bgIntensity)
    writeJSON('bgIntensity', bgIntensity)
  }, [bgIntensity])

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
      bgStyle,
      setBgStyle,
      bgIntensity,
      setBgIntensity,
    }),
    [theme, bgStyle, bgIntensity],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
