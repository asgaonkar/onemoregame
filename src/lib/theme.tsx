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

type ThemeContextValue = {
  theme: Theme
  toggleTheme: () => void
  bgStyle: BackgroundStyle
  setBgStyle: (style: BackgroundStyle) => void
  bgOpacity: number
  setBgOpacity: (opacity: number) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

// The pattern's fully-opaque (slider at 100%) color per theme, tuned per
// style since a line reads much bolder than an isolated dot at the same
// alpha — these are the old fixed "bold" values, now the slider's ceiling.
const GRID_RGB: Record<Theme, string> = {
  dark: '255, 255, 255',
  light: '0, 0, 0',
}
const DOT_MAX_ALPHA: Record<Theme, number> = { dark: 0.16, light: 0.12 }
const LINE_MAX_ALPHA: Record<Theme, number> = { dark: 0.11, light: 0.08 }

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

function getInitialBgOpacity(): number {
  const stored = readJSON<number | null>('bgOpacity', null)
  return typeof stored === 'number' && stored >= 0 && stored <= 1 ? stored : 0.25
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [bgStyle, setBgStyle] = useState<BackgroundStyle>(getInitialBgStyle)
  const [bgOpacity, setBgOpacity] = useState<number>(getInitialBgOpacity)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    writeJSON('theme', theme)
  }, [theme])

  useEffect(() => {
    document.body.setAttribute('data-bg-style', bgStyle)
    writeJSON('bgStyle', bgStyle)
  }, [bgStyle])

  useEffect(() => {
    const maxAlpha = bgStyle === 'lines' ? LINE_MAX_ALPHA[theme] : DOT_MAX_ALPHA[theme]
    document.body.style.setProperty(
      '--grid-color',
      `rgba(${GRID_RGB[theme]}, ${maxAlpha * bgOpacity})`,
    )
    writeJSON('bgOpacity', bgOpacity)
  }, [theme, bgStyle, bgOpacity])

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
      bgStyle,
      setBgStyle,
      bgOpacity,
      setBgOpacity,
    }),
    [theme, bgStyle, bgOpacity],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
