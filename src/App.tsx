import { HashRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './lib/theme'
import { AnalyticsTracker } from './components/AnalyticsTracker'
import { Home } from './pages/Home'
import { CenterGame } from './pages/games/CenterGame'
import { WaitGame } from './pages/games/WaitGame'
import { GuessDistanceGame } from './pages/games/GuessDistanceGame'
import { BlinkGame } from './pages/games/BlinkGame'
import { CountGame } from './pages/games/CountGame'
import { SwapGame } from './pages/games/SwapGame'
import { CrowdGame } from './pages/games/CrowdGame'
import { TraceGame } from './pages/games/TraceGame'
import { MirrorGame } from './pages/games/MirrorGame'
import { ReflexGame } from './pages/games/ReflexGame'
import { SequenceGame } from './pages/games/SequenceGame'
import { AimGame } from './pages/games/AimGame'
import { RiskGame } from './pages/games/RiskGame'
import { MatchGame } from './pages/games/MatchGame'
import { NotFound } from './pages/NotFound'

export function App() {
  return (
    <ThemeProvider>
      <HashRouter>
        <AnalyticsTracker />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/center" element={<CenterGame />} />
          <Route path="/wait" element={<WaitGame />} />
          <Route path="/guess-distance" element={<GuessDistanceGame />} />
          <Route path="/blink" element={<BlinkGame />} />
          <Route path="/count" element={<CountGame />} />
          <Route path="/swap" element={<SwapGame />} />
          <Route path="/crowd" element={<CrowdGame />} />
          <Route path="/trace" element={<TraceGame />} />
          <Route path="/mirror" element={<MirrorGame />} />
          <Route path="/reflex" element={<ReflexGame />} />
          <Route path="/sequence" element={<SequenceGame />} />
          <Route path="/aim" element={<AimGame />} />
          <Route path="/risk" element={<RiskGame />} />
          <Route path="/match" element={<MatchGame />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </HashRouter>
    </ThemeProvider>
  )
}
