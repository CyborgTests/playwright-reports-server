import { useEffect } from 'react';
import { Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Layout } from '@/components/Layout';
import FailureClustersPage from '@/pages/FailureClustersPage';
import HomePage from '@/pages/HomePage';
import LlmQueuePage from '@/pages/LlmQueuePage';
import LoginPage from '@/pages/LoginPage';
import ReportDetailPage from '@/pages/ReportDetailPage';
import ReportsComparePage from '@/pages/ReportsComparePage';
import ReportsPage from '@/pages/ReportsPage';
import ResultsPage from '@/pages/ResultsPage';
import SettingsPage from '@/pages/SettingsPage';
import TestDetailPage from '@/pages/TestDetailPage';
import { Providers } from '@/providers';

function App() {
  return (
    <Providers attribute="class" defaultTheme="system">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <Layout>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/reports/compare" element={<ReportsComparePage />} />
                <Route path="/report/:id" element={<ReportDetailPage />} />
                <Route path="/report/:id/:testId" element={<RedirectTestDetails />} />
                <Route path="/test/:fileId/:testId" element={<TestDetailPage />} />
                <Route path="/results" element={<ResultsPage />} />
                <Route path="/failures/clusters" element={<FailureClustersPage />} />
                <Route path="/llm-queue" element={<LlmQueuePage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </Layout>
          }
        />
      </Routes>
      <Toaster closeButton richColors visibleToasts={3} />
    </Providers>
  );
}

function RedirectTestDetails() {
  const { id, testId } = useParams<{ id: string; testId: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    navigate(`/report/${id}`, {
      state: { highlightTestId: testId },
      replace: true,
    });
  }, [id, navigate, testId]);

  return null;
}

export default App;
