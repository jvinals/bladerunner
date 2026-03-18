import { Routes, Route } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import HomePage from './pages/Home';
import RunsPage from './pages/Runs';
import RunDetailPage from './pages/RunDetail';
import SettingsPage from './pages/Settings';
import NotFoundPage from './pages/NotFound';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="runs/:id" element={<RunDetailPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
