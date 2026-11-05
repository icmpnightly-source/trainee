import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AthletePage } from "./pages/AthletePage";
import { AthletesPage } from "./pages/AthletesPage";
import { NormativesPage } from "./pages/NormativesPage";
import { PlanPage } from "./pages/PlanPage";
import { PullupPage } from "./pages/PullupPage";
import { RunPage } from "./pages/RunPage";
import { ServerPage } from "./pages/ServerPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TrackPage } from "./pages/TrackPage";
import { getServerUrl, isNative } from "./platform";
import "./styles.css";

function App() {
  const location = useLocation();
  // The Android app needs to know its server first (the pull-up counter works without one).
  if (isNative && !getServerUrl() && !["/server", "/pullup"].includes(location.pathname)) return <Navigate to="/server" replace />;
  return (
    <>
      <header className="top">
        <NavLink to="/" className="brand">
          Normativ<span>AI</span>
        </NavLink>
        <nav>
          <NavLink to="/" end>
            Sportchilar
          </NavLink>
          <NavLink to="/normatives">Normativlar</NavLink>
          <NavLink to="/settings">Sozlamalar</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<AthletesPage />} />
          <Route path="/athletes/:id" element={<AthletePage />} />
          <Route path="/athletes/:id/pullup" element={<PullupPage />} />
          <Route path="/athletes/:id/run" element={<RunPage />} />
          <Route path="/athletes/:id/plan" element={<PlanPage />} />
          <Route path="/athletes/:id/results/:resultId/track" element={<TrackPage />} />
          <Route path="/pullup" element={<PullupPage />} />
          <Route path="/run" element={<RunPage />} />
          <Route path="/normatives" element={<NormativesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/server" element={<ServerPage />} />
          <Route path="*" element={<p className="muted">Sahifa topilmadi</p>} />
        </Routes>
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
