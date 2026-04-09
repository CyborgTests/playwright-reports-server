import React, { useState } from 'react';
import { Merge, X, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import dayjs from 'dayjs';
import { Report } from '../types';

export default function MergeReportsButton({
  reports,
  selectedReportIds,
  onMerge,
  apiToken
}: {
  reports: Report[];
  selectedReportIds: Set<string>;
  onMerge: () => void;
  apiToken: string;
}) {
  const [merging, setMerging] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [project, setProject] = useState('merged');

  const selectedReports = reports.filter((r) => selectedReportIds.has(r.id ?? (r as any).reportID ?? ''));
  const resultIds = selectedReports.flatMap((r) => r.resultIds ?? []);

  const handleMerge = async () => {
    if (resultIds.length === 0) return alert('Selected reports have no source results to merge');
    setMerging(true);
    try {
      const res = await fetch('/api/report/generate', {
        method: 'POST',
        headers: { ...(apiToken ? { Authorization: apiToken } : {}), 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: project.trim() || 'merged', resultsIds: resultIds })
      });
      if (!res.ok) throw new Error(await res.text());
      onMerge();
      setShowModal(false);
    } catch (error: unknown) {
      alert('Merge failed: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setMerging(false);
    }
  };

  const canMerge = selectedReportIds.size >= 2;
  if (!canMerge) return null;

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="bg-emerald-500 hover:bg-emerald-600 text-black font-semibold px-6 py-3 rounded-xl transition-all flex items-center gap-2"
      >
        <Merge size={20} />
        Merge selected ({selectedReportIds.size})
      </button>
      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#141414] border border-white/10 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl"
          >
            <div className="p-6 border-b border-white/5 flex items-center justify-between">
              <h3 className="text-xl font-semibold">Merge reports into one</h3>
              <button onClick={() => setShowModal(false)} className="text-white/40 hover:text-white">
                <X size={24} />
              </button>
            </div>
            <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-medium text-white/40 uppercase tracking-wider mb-2">
                  New report project name
                </label>
                <input
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 transition-colors"
                  placeholder="e.g. merged, regression"
                />
              </div>
              <div>
                <p className="text-xs font-medium text-white/40 uppercase tracking-wider mb-2">
                  Merging {selectedReportIds.size} report(s) ({resultIds.length} run(s) total)
                </p>
                <div className="space-y-2 mt-2">
                  {selectedReports.map((r) => {
                    const id = r.id ?? (r as any).reportID ?? '';
                    return (
                      <div
                        key={id}
                        className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5"
                      >
                        <span className="font-medium">{r.project}</span>
                        <span className="text-white/40 text-sm">
                          {dayjs(r.createdAt).format('MMM D, HH:mm')} • {(r.resultIds ?? []).length} run(s)
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="p-6 border-t border-white/5 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="px-6 py-3 text-white/60 hover:text-white font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleMerge}
                disabled={merging || resultIds.length === 0}
                className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold px-8 py-3 rounded-xl transition-all flex items-center gap-2"
              >
                {merging ? <RefreshCw className="animate-spin" size={20} /> : <Merge size={20} />}
                {merging ? 'Merging...' : 'Merge'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </>
  );
}
