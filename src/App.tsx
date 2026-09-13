import { HashRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './lib/theme'
import { Home } from './pages/Home'
import { CenterGame } from './pages/games/CenterGame'
import { PerfectCircleGame } from './pages/games/PerfectCircleGame'
import { NotFound } from './pages/NotFound'

export function App() {
  return (
    <ThemeProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/center" element={<CenterGame />} />
          <Route path="/perfect-circle" element={<PerfectCircleGame />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </HashRouter>
    </ThemeProvider>
  )
}
