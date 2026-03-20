import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Show, RedirectToSignIn, useAuth } from '@clerk/react';
import { AppShell } from './components/layout/AppShell';
import { setTokenProvider } from './lib/api';
import HomePage from './pages/Home';
import RunsPage from './pages/Runs';
import RunDetailPage from './pages/RunDetail';
import SettingsPage from './pages/Settings';
import ProjectsPage from './pages/Projects';
import DetachedPreview from './pages/DetachedPreview';
import DetachedPlayback from './pages/DetachedPlayback';
import NotFoundPage from './pages/NotFound';

function AuthTokenSync() {
  const { getToken } = useAuth();
  useEffect(() => {
    setTokenProvider(getToken);
  }, [getToken]);
  return null;
}

export default function App() {
  return (
    <>
      <Show when="signed-in">
        <AuthTokenSync />
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="runs" element={<RunsPage />} />
            <Route path="runs/:id" element={<RunDetailPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
          <Route path="preview/:runId" element={<DetachedPreview />} />
          <Route path="playback/:playbackSessionId" element={<DetachedPlayback />} />
        </Routes>
      </Show>
      <Show when="signed-out">
        <RedirectToSignIn />
      </Show>
    </>
  );
}
