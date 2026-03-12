import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Search, Trash2, ExternalLink } from 'lucide-react';
import { motion } from 'motion/react';
import dayjs from 'dayjs';
import { useAuth } from '../context/AuthContext';
import { Report } from '../types';
import UploadResultButton from '../components/UploadResultButton';
import MergeReportsButton from '../components/MergeReportsButton';

const LIMIT = 20;

export default function ReportsPage() {
  const { authHeader } = useAuth();
  const navigate = useNavigate();
  const [reports, setReports] = useState<Report[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchReports = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('limit', String(LIMIT));
    params.set('offset', String(page * LIMIT));
    if (project) params.set('project', project);
    if (search) params.set('search', search);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    try {
      const [rRes, pRes] = await Promise.all([
        fetch(`/api/report/list?${params}`, { headers: authHeader }).then(async (r) => ({ ok: r.ok, data: await r.json() })),
        fetch('/api/report/projects', { headers: authHeader }).then(async (r) => ({ ok: r.ok, data: await r.json() }))
      ]);
      if (rRes.ok && rRes.data?.reports) setReports(rRes.data.reports);
      if (rRes.ok && rRes.data?.total != null) setTotal(rRes.data.total);
      if (pRes.ok && Array.isArray(pRes.data)) setProjects(pRes.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [authHeader, page, project, search, dateFrom, dateTo]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} report(s)?`)) return;
    await fetch('/api/report/delete', {
      method: 'DELETE',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportsIds: [...selectedIds] })
    });
    setSelectedIds(new Set());
    fetchReports();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === reports.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(reports.map((r) => r.id || r.reportID)));
  };

  const reportId = (r: Report) => r.id ?? (r as any).reportID ?? '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1.5 flex-1 min-w-[200px] max-w-md">
          <span className="text-xs text-white/40">Search</span>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={18} />
            <input
              type="text"
              placeholder="Search reports..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#141414] border border-white/5 rounded-xl pl-12 pr-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 transition-colors"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-white/40">Project</span>
          <select
            value={project}
            onChange={(e) => setProject(e.target.value)}
            className="bg-[#141414] border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 min-w-[140px]"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-white/40">From</span>
          <input
            type="datetime-local"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-[#141414] border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:opacity-70"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-white/40">To</span>
          <input
            type="datetime-local"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-[#141414] border border-white/5 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:opacity-70"
          />
        </label>
        <UploadResultButton onUpload={fetchReports} apiToken={authHeader.Authorization || ''} />
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-white/60 text-sm">{selectedIds.size} selected</span>
          <MergeReportsButton
            reports={reports}
            selectedReportIds={selectedIds}
            onMerge={() => {
              setSelectedIds(new Set());
              fetchReports();
              navigate('/reports');
            }}
            apiToken={authHeader.Authorization || ''}
          />
          <button
            onClick={handleDeleteSelected}
            className="bg-red-500/20 text-red-400 hover:bg-red-500/30 px-4 py-2 rounded-xl flex items-center gap-2 text-sm font-medium"
          >
            <Trash2 size={16} />
            Delete selected
          </button>
        </div>
      )}

      <div className="bg-[#141414] border border-white/5 rounded-2xl overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-white/5 text-white/40 text-xs uppercase tracking-wider">
              <th className="px-6 py-4 font-medium w-12">
                <input
                  type="checkbox"
                  checked={reports.length > 0 && selectedIds.size === reports.length}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 accent-emerald-500"
                />
              </th>
              <th className="px-6 py-4 font-medium">Project</th>
              <th className="px-6 py-4 font-medium">Created At</th>
              <th className="px-6 py-4 font-medium">Size</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {reports.map((report) => {
              const id = reportId(report);
              return (
                <tr key={id} className="hover:bg-white/5 transition-colors group">
                  <td className="px-6 py-4">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(id)}
                      onChange={() => toggleSelect(id)}
                      className="w-4 h-4 accent-emerald-500"
                    />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-500/10 rounded flex items-center justify-center">
                        <FileText size={16} className="text-blue-500" />
                      </div>
                      <span className="font-medium">{report.project}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-white/60 text-sm">
                    {dayjs(report.createdAt).format('MMM D, YYYY HH:mm')}
                  </td>
                  <td className="px-6 py-4 text-white/40 text-sm">
                    {typeof report.size === 'number'
                      ? (report.size / (1024 * 1024)).toFixed(2) + ' MB'
                      : report.size ?? '—'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => navigate(`/report/${id}`)}
                        className="p-2 hover:bg-white/10 rounded-lg text-white/40 hover:text-white transition-colors"
                      >
                        View
                      </button>
                      <a
                        href={report.reportUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 hover:bg-blue-500/20 rounded-lg text-white/40 hover:text-blue-400 transition-colors"
                      >
                        <ExternalLink size={18} />
                      </a>
                      <button
                        onClick={async () => {
                          if (confirm('Delete this report?')) {
                            await fetch('/api/report/delete', {
                              method: 'DELETE',
                              headers: { ...authHeader, 'Content-Type': 'application/json' },
                              body: JSON.stringify({ reportsIds: [id] })
                            });
                            fetchReports();
                          }
                        }}
                        className="p-2 hover:bg-red-500/20 rounded-lg text-white/40 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {reports.length === 0 && !loading && (
          <div className="py-20 text-center">
            <FileText size={48} className="mx-auto text-white/10 mb-4" />
            <p className="text-white/40">No reports found</p>
          </div>
        )}
        {loading && (
          <div className="py-12 text-center text-white/40">Loading…</div>
        )}
      </div>

      {total > LIMIT && (
        <div className="flex items-center justify-between">
          <p className="text-white/40 text-sm">
            Showing {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total}
          </p>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="px-4 py-2 rounded-xl bg-white/5 text-white disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              disabled={(page + 1) * LIMIT >= total}
              onClick={() => setPage((p) => p + 1)}
              className="px-4 py-2 rounded-xl bg-white/5 text-white disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
