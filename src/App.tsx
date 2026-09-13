import { HashRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './lib/theme'
import { Home } from './pages/Home'
import { CenterGame } from './pages/games/CenterGame'
import { BlinkGame } from './pages/games/BlinkGame'
import { NotFound } from './pages/NotFound'

export function App() {
  return (
    <ThemeProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/center" element={<CenterGame />} />
          <Route path="/blink" element={<BlinkGame />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </HashRouter>
    </ThemeProvider>
  )
}
