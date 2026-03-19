import { Routes, Route } from 'react-router-dom';
import { Show, RedirectToSignIn } from '@clerk/react';
import { AppShell } from './components/layout/AppShell';
import HomePage from './pages/Home';
import RunsPage from './pages/Runs';
import RunDetailPage from './pages/RunDetail';
import SettingsPage from './pages/Settings';
import DetachedPreview from './pages/DetachedPreview';
import NotFoundPage from './pages/NotFound';

export default function App() {
  return (
    <>
      <Show when="signed-in">
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="runs" element={<RunsPage />} />
            <Route path="runs/:id" element={<RunDetailPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
          <Route path="preview/:runId" element={<DetachedPreview />} />
        </Routes>
      </Show>
      <Show when="signed-out">
        <RedirectToSignIn />
      </Show>
    </>
  );
}
