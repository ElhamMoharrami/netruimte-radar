import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.js';
import RadarPage from './pages/RadarPage.js';
import OpportunitiesPage from './pages/OpportunitiesPage.js';
import OpportunityDetailPage from './pages/OpportunityDetailPage.js';
import RunsPage from './pages/RunsPage.js';
import DemoPage from './pages/DemoPage.js';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/radar" replace />} />
          <Route path="radar" element={<RadarPage />} />
          <Route path="opportunities" element={<OpportunitiesPage />} />
          <Route path="opportunities/:id" element={<OpportunityDetailPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="demo" element={<DemoPage />} />
          <Route path="*" element={<Navigate to="/radar" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
