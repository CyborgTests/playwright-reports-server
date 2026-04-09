import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FileText, ExternalLink, ArrowLeft } from 'lucide-react';
import { motion } from 'motion/react';
import dayjs from 'dayjs';
import { useAuth } from '../context/AuthContext';
import { Report, ReportStats } from '../types';

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { authHeader } = useAuth();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [testNameFilter, setTestNameFilter] = useState('');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/report/${id}`, { headers: authHeader })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setReport({ ...data, id: data.id ?? data.reportID ?? id });
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id, authHeader]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-white/40">
        Loading report…
      </div>
    );
  }
  if (!report) {
    return (
      <div className="space-y-4">
        <p className="text-white/40">Report not found.</p>
        <Link to="/reports" className="text-emerald-500 hover:underline flex items-center gap-2">
          <ArrowLeft size={18} /> Back to Reports
        </Link>
      </div>
    );
  }

  const stats: ReportStats | undefined = report.stats;
  const files = Array.isArray(report.files) ? report.files : [];
  const reportUrl = report.reportUrl ?? `/api/serve/${report.project}/${report.id ?? id}/index.html`;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
      <div className="flex items-center gap-4">
        <Link
          to="/reports"
          className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white transition-colors flex items-center gap-2"
        >
          <ArrowLeft size={20} /> Back
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{report.project ?? 'Report'}</h1>
          <p className="text-white/40 text-sm mt-1">
            {dayjs(report.createdAt).format('MMM D, YYYY HH:mm')} • {report.id ?? id}
          </p>
        </div>
        <a
          href={reportUrl}
          target="_blank"
          rel="noreferrer"
          className="bg-emerald-500 hover:bg-emerald-600 text-black font-semibold px-6 py-3 rounded-xl transition-all flex items-center gap-2"
        >
          <ExternalLink size={20} />
          Open report
        </a>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <StatBadge label="Total" value={stats.total} />
          <StatBadge label="Expected" value={stats.expected} className="text-emerald-400" />
          <StatBadge label="Unexpected" value={stats.unexpected} className="text-red-400" />
          <StatBadge label="Flaky" value={stats.flaky} className="text-amber-400" />
          <StatBadge label="Skipped" value={stats.skipped} className="text-white/50" />
        </div>
      )}

      {files.length > 0 && (
        <div className="bg-[#141414] border border-white/5 rounded-2xl p-6">
          <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
            <FileText size={20} className="text-white/40" />
            Files & tests
          </h3>
          <div className="flex flex-wrap gap-3 mb-4">
            <input
              type="text"
              placeholder="Filter by test name..."
              value={testNameFilter}
              onChange={(e) => setTestNameFilter(e.target.value)}
              className="bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-emerald-500/50"
            />
            <select
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value)}
              className="bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-white text-sm focus:outline-none focus:border-emerald-500/50"
            >
              <option value="">All outcomes</option>
              <option value="expected">Expected</option>
              <option value="unexpected">Unexpected</option>
              <option value="flaky">Flaky</option>
              <option value="skipped">Skipped</option>
            </select>
          </div>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {files.map((file: any, idx: number) => (
              <div key={idx} className="border border-white/5 rounded-xl p-3 text-sm">
                <p className="font-medium text-white/80">{file.fileName ?? file.name ?? 'File'}</p>
                {Array.isArray(file.tests) &&
                  file.tests
                    .filter((t: any) => {
                      if (testNameFilter && !String(t.name ?? t.title ?? '').toLowerCase().includes(testNameFilter.toLowerCase()))
                        return false;
                      if (outcomeFilter && (t.outcome ?? t.status) !== outcomeFilter) return false;
                      return true;
                    })
                    .map((t: any, i: number) => (
                      <div key={i} className="ml-4 mt-1 text-white/60">
                        • {t.name ?? t.title ?? 'Test'} — {t.outcome ?? t.status ?? '—'}
                      </div>
                    ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {files.length === 0 && (
        <p className="text-white/40 text-sm">No file/test breakdown available. Open the report for full details.</p>
      )}
    </motion.div>
  );
}

function StatBadge({
  label,
  value,
  className = ''
}: {
  label: string;
  value: number | undefined;
  className?: string;
}) {
  return (
    <div className="bg-[#141414] border border-white/5 rounded-xl p-4">
      <p className="text-white/40 text-xs uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${className}`}>{value ?? 0}</p>
    </div>
  );
}
