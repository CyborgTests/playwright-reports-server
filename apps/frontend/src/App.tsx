import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Layout } from '@/components/Layout';
import { NavigationProgress } from '@/components/ui/navigation-progress';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/hooks/useAuth';
import { useConfig } from '@/hooks/useConfig';
import { withQueryParams } from '@/lib/network';
import { withBase } from '@/lib/url';
import { Providers } from '@/providers';

const HomePage = lazy(() => import('@/pages/HomePage'));
const ReportsPage = lazy(() => import('@/pages/ReportsPage'));
const ReportsComparePage = lazy(() => import('@/pages/ReportsComparePage'));
const ReportDetailPage = lazy(() => import('@/pages/ReportDetailPage'));
const TestDetailPage = lazy(() => import('@/pages/TestDetailPage'));
const ResultsPage = lazy(() => import('@/pages/ResultsPage'));
const FailureClustersPage = lazy(() => import('@/pages/FailureClustersPage'));
const LlmQueuePage = lazy(() => import('@/pages/LlmQueuePage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { data: config, isLoading: isConfigLoading } = useConfig();
  const session = useAuth();
  const location = useLocation();

  if (isConfigLoading || session.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (config?.authRequired && session.status === 'unauthenticated') {
    const callbackUrl = encodeURI(withBase(location.pathname + location.search));
    return <Navigate to={withQueryParams(withBase('/login'), { callbackUrl })} replace />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <Providers
      attribute="class"
      themes={['light-mode', 'dark-mode']}
      defaultTheme="dark-mode"
      enableSystem={false}
    >
      <NavigationProgress />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/*"
            element={
              <RequireAuth>
                <Layout>
                  <Suspense fallback={<RouteFallback />}>
                    <Routes>
                      <Route path="/" element={<HomePage />} />
                      <Route path="/reports" element={<ReportsPage />} />
                      <Route path="/reports/compare" element={<ReportsComparePage />} />
                      <Route path="/report/:id" element={<ReportDetailPage />} />
                      <Route path="/report/:id/:testId" element={<RedirectTestDetails />} />
                      <Route path="/test/:testId" element={<TestDetailPage />} />
                      <Route path="/results" element={<ResultsPage />} />
                      <Route path="/failures/clusters" element={<FailureClustersPage />} />
                      <Route path="/llm-queue" element={<LlmQueuePage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                    </Routes>
                  </Suspense>
                </Layout>
              </RequireAuth>
            }
          />
        </Routes>
      </Suspense>
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
