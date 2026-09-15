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
import { getGame } from './data/games'
import type { ReactElement } from 'react'

// A game route only renders when its data entry is marked 'live' — visiting
// a locked game's URL directly (guessing it, an old link, editing
// localStorage, whatever) lands on the same 404 as any other unknown path,
// instead of the route working regardless of what the home page shows.
function liveRoute(id: string, element: ReactElement): ReactElement {
  return getGame(id)?.status === 'live' ? element : <NotFound />
}

export function App() {
  return (
    <ThemeProvider>
      <HashRouter>
        <AnalyticsTracker />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/center" element={liveRoute('center', <CenterGame />)} />
          <Route path="/wait" element={liveRoute('wait', <WaitGame />)} />
          <Route
            path="/guess-distance"
            element={liveRoute('guess-distance', <GuessDistanceGame />)}
          />
          <Route path="/blink" element={liveRoute('blink', <BlinkGame />)} />
          <Route path="/count" element={liveRoute('count', <CountGame />)} />
          <Route path="/swap" element={liveRoute('swap', <SwapGame />)} />
          <Route path="/crowd" element={liveRoute('crowd', <CrowdGame />)} />
          <Route path="/trace" element={liveRoute('trace', <TraceGame />)} />
          <Route path="/mirror" element={liveRoute('mirror', <MirrorGame />)} />
          <Route path="/reflex" element={liveRoute('reflex', <ReflexGame />)} />
          <Route path="/sequence" element={liveRoute('sequence', <SequenceGame />)} />
          <Route path="/aim" element={liveRoute('aim', <AimGame />)} />
          <Route path="/risk" element={liveRoute('risk', <RiskGame />)} />
          <Route path="/match" element={liveRoute('match', <MatchGame />)} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </HashRouter>
    </ThemeProvider>
  )
}
