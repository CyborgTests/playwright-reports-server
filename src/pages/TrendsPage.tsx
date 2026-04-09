import React, { useState, useEffect, useCallback } from 'react';
import { BarChart3 } from 'lucide-react';
import { motion } from 'motion/react';
import dayjs from 'dayjs';
import { useAuth } from '../context/AuthContext';
import { Report, ReportStats } from '../types';

type StatsLike = Partial<ReportStats> & { passed?: number; failed?: number };

export default function TrendsPage() {
  const { authHeader } = useAuth();
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState('');
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/report/projects', { headers: authHeader });
      const data = await res.json();
      if (res.ok && Array.isArray(data)) setProjects(data);
    } catch (e) {
      console.error(e);
    }
  }, [authHeader]);

  const fetchTrend = useCallback(async () => {
    if (!project) {
      setReports([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/report/list?project=${encodeURIComponent(project)}&limit=20`, { headers: authHeader }).then((r) => r.json());
      if (res?.reports) setReports(res.reports);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [authHeader, project]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    fetchTrend();
  }, [fetchTrend]);

  useEffect(() => {
    if (projects.length > 0 && !project) setProject(projects[0]);
  }, [projects]);

  const getReportTotal = (r: Report) => {
    const s: StatsLike = r.stats ?? {};
    const total = s.total ?? (s.expected ?? s.passed ?? 0) + (s.unexpected ?? s.failed ?? 0) + (s.flaky ?? 0) + (s.skipped ?? 0);
    return total ?? 0;
  };
  const maxTotal = Math.max(...reports.map(getReportTotal), 1);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex items-center gap-4">
        <BarChart3 size={24} className="text-white/40" />
        <h2 className="text-xl font-semibold">Report trends</h2>
      </div>
      <div>
        <label className="block text-xs font-medium text-white/40 uppercase tracking-wider mb-2">
          Project
        </label>
        <select
          value={project}
          onChange={(e) => setProject(e.target.value)}
          className="bg-[#141414] border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 min-w-[200px]"
        >
          <option value="">Select project</option>
          {projects.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      {!project && projects.length > 0 && (
        <p className="text-white/40">Select a project to see report history and trends.</p>
      )}
      {projects.length === 0 && !loading && (
        <p className="text-white/40">No projects yet. Upload a report from the Reports page to get started.</p>
      )}

      {project && loading && <p className="text-white/40">Loading…</p>}

      {project && !loading && reports.length === 0 && (
        <p className="text-white/40">No reports for this project yet.</p>
      )}

      {project && !loading && reports.length > 0 && (
        <div className="bg-[#141414] border border-white/5 rounded-2xl p-6">
          <h3 className="text-lg font-medium mb-2">Latest reports (last 20)</h3>
          <p className="text-sm text-white/40 mb-6">Vertical: number of tests. Horizontal: reports (newest on the right).</p>

          <div className="flex items-stretch gap-1.5 h-56 mb-2">
            {[...reports].reverse().map((r, i) => {
              const raw = r.stats ?? {};
              const expected = raw.expected ?? raw.passed ?? 0;
              const unexpected = raw.unexpected ?? raw.failed ?? 0;
              const flaky = raw.flaky ?? 0;
              const skipped = raw.skipped ?? 0;
              const total = raw.total ?? ((expected + unexpected + flaky + skipped) || 0);
              const stats = { total, expected, unexpected, flaky, skipped };
              const pct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
              const barHeightPct = Math.max(pct, 4);
              const label = dayjs(r.createdAt).format('MMM D, HH:mm');
              return (
                <div
                  key={r.id ?? (r as any).reportID ?? i}
                  className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0 min-h-0 group"
                  title={`${label} — ${total} total · ${expected} passed · ${unexpected} failed · ${flaky} flaky · ${skipped} skipped`}
                >
                  <div
                    className="w-full rounded-t flex flex-col-reverse transition-opacity hover:opacity-90 overflow-hidden bg-white/5 flex-shrink-0"
                    style={{
                      height: `${barHeightPct}%`,
                      minHeight: '12px',
                    }}
                  >
                    {expected > 0 && (
                      <div
                        className="w-full bg-emerald-500 flex-shrink-0"
                        style={{ height: `${total ? (expected / total) * 100 : 0}%`, minHeight: total ? undefined : 0 }}
                      />
                    )}
                    {unexpected > 0 && (
                      <div
                        className="w-full bg-red-500 flex-shrink-0"
                        style={{ height: `${total ? (unexpected / total) * 100 : 0}%`, minHeight: total ? undefined : 0 }}
                      />
                    )}
                    {flaky > 0 && (
                      <div
                        className="w-full bg-amber-400 flex-shrink-0"
                        style={{ height: `${total ? (flaky / total) * 100 : 0}%`, minHeight: total ? undefined : 0 }}
                      />
                    )}
                    {skipped > 0 && (
                      <div
                        className="w-full bg-white/30 flex-shrink-0"
                        style={{ height: `${total ? (skipped / total) * 100 : 0}%`, minHeight: total ? undefined : 0 }}
                      />
                    )}
                    {total === 0 && (
                      <div className="w-full bg-white/10 flex-shrink-0" style={{ height: '100%' }} />
                    )}
                  </div>
                  <span className="text-[10px] text-white/30 truncate w-full text-center rotate-0 group-hover:text-white/60" title={label}>
                    {dayjs(r.createdAt).format('MM/D HH:mm')}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-6 pt-4 border-t border-white/5">
            <span className="text-xs text-white/40 uppercase tracking-wider">Legend</span>
            <span className="flex items-center gap-1.5 text-sm text-white/70">
              <span className="w-3 h-3 rounded-sm bg-emerald-500" /> Passed
            </span>
            <span className="flex items-center gap-1.5 text-sm text-white/70">
              <span className="w-3 h-3 rounded-sm bg-red-500" /> Failed
            </span>
            <span className="flex items-center gap-1.5 text-sm text-white/70">
              <span className="w-3 h-3 rounded-sm bg-amber-400" /> Flaky
            </span>
            <span className="flex items-center gap-1.5 text-sm text-white/70">
              <span className="w-3 h-3 rounded-sm bg-white/30" /> Skipped
            </span>
          </div>

          <ul className="mt-6 space-y-2 border-t border-white/5 pt-4">
            {reports.map((r) => {
              const id = r.id ?? (r as any).reportID;
              const s = r.stats;
              return (
                <li
                  key={id}
                  className="flex items-center justify-between text-sm py-2 border-b border-white/5 last:border-0"
                >
                  <span className="text-white/80">{dayjs(r.createdAt).format('MMM D, YYYY HH:mm')}</span>
                  <span className="text-white/40">
                    {s ? (
                      <span className="text-white/50">
                        {s.total} total · <span className="text-emerald-400">{s.expected} passed</span>
                        {s.unexpected > 0 && <span className="text-red-400"> · {s.unexpected} failed</span>}
                        {s.flaky > 0 && <span className="text-amber-400"> · {s.flaky} flaky</span>}
                        {s.skipped > 0 && <span className="text-white/40"> · {s.skipped} skipped</span>}
                      </span>
                    ) : (
                      typeof r.size === 'number'
                        ? (r.size / (1024 * 1024)).toFixed(2) + ' MB'
                        : (r.size ?? '—')
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </motion.div>
  );
}
