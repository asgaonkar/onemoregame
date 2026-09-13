import { HashRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './lib/theme'
import { Home } from './pages/Home'
import { CenterGame } from './pages/games/CenterGame'
import { CrowdGame } from './pages/games/CrowdGame'
import { NotFound } from './pages/NotFound'

export function App() {
  return (
    <ThemeProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/center" element={<CenterGame />} />
          <Route path="/crowd" element={<CrowdGame />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </HashRouter>
    </ThemeProvider>
  )
}
