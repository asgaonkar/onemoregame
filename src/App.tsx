import { HashRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './lib/theme'
import { Home } from './pages/Home'
import { CenterGame } from './pages/games/CenterGame'
import { WaitGame } from './pages/games/WaitGame'
import { GuessDistanceGame } from './pages/games/GuessDistanceGame'
import { BlinkGame } from './pages/games/BlinkGame'
import { CountGame } from './pages/games/CountGame'
import { NotFound } from './pages/NotFound'

export function App() {
  return (
    <ThemeProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/center" element={<CenterGame />} />
          <Route path="/wait" element={<WaitGame />} />
          <Route path="/guess-distance" element={<GuessDistanceGame />} />
          <Route path="/blink" element={<BlinkGame />} />
          <Route path="/count" element={<CountGame />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </HashRouter>
    </ThemeProvider>
  )
}
