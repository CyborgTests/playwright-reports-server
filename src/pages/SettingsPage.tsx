import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { motion } from 'motion/react';
import { AppConfig, ServerInfo } from '../types';

export default function SettingsPage() {
  const { authHeader } = useAuth();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [reports, setReports] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const [cRes, iRes, rRes] = await Promise.all([
        fetch('/api/config').then((r) => r.json()),
        fetch('/api/info', { headers: authHeader }).then((r) => r.json()),
        fetch('/api/report/list?limit=1000', { headers: authHeader }).then((r) => r.json())
      ]);
      setConfig(cRes);
      setServerInfo(iRes);
      if (rRes.reports) setReports(rRes.reports);
    } catch (e) {
      console.error(e);
    }
  }, [authHeader]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl space-y-8"
    >
      <div className="bg-[#141414] border border-white/5 rounded-2xl p-8">
        <h3 className="text-xl font-semibold mb-6">White-label Configuration</h3>
        <form
          className="space-y-6"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const formData = new FormData(form);
            const headerLinksEl = form.querySelector('[name="headerLinks"]') as HTMLInputElement;
            if (headerLinksEl?.value) {
              try {
                JSON.parse(headerLinksEl.value);
                formData.set('headerLinks', headerLinksEl.value);
              } catch (_) {
                alert('Header links must be valid JSON');
                return;
              }
            }
            await fetch('/api/config', {
              method: 'PATCH',
              headers: authHeader,
              body: formData
            });
            fetchData();
            alert('Config updated successfully');
          }}
        >
          <div>
            <label className="block text-xs font-medium text-white/40 uppercase tracking-wider mb-2">
              Application Title
            </label>
            <input
              name="title"
              defaultValue={config?.title}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 transition-colors"
              placeholder="Playwright Reports Server"
            />
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-medium text-white/40 uppercase tracking-wider mb-2">Logo</label>
              <input
                type="file"
                name="logo"
                className="w-full text-sm text-white/40 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-500/10 file:text-emerald-500 hover:file:bg-emerald-500/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/40 uppercase tracking-wider mb-2">Favicon</label>
              <input
                type="file"
                name="favicon"
                className="w-full text-sm text-white/40 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-500/10 file:text-emerald-500 hover:file:bg-emerald-500/20"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-white/40 uppercase tracking-wider mb-2">
              Header links (JSON: name → URL)
            </label>
            <input
              name="headerLinks"
              defaultValue={config?.headerLinks ? JSON.stringify(config.headerLinks, null, 2) : '{}'}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
              placeholder='{"GitHub": "https://github.com/..."}'
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/40 uppercase tracking-wider mb-2">
              Reporter paths (JSON array or single path)
            </label>
            <input
              name="reporterPaths"
              defaultValue={
                config?.reporterPaths?.length
                  ? JSON.stringify(config.reporterPaths)
                  : ''
              }
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
              placeholder='["/path/to/reporter"]'
            />
          </div>
          <button
            type="submit"
            className="bg-emerald-500 hover:bg-emerald-600 text-black font-semibold px-8 py-3 rounded-xl transition-all"
          >
            Save Changes
          </button>
        </form>
      </div>

      <div className="bg-[#141414] border border-white/5 rounded-2xl p-8">
        <h3 className="text-xl font-semibold mb-6">Cron / Expiration</h3>
        <form
          className="space-y-6"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const formData = new FormData(form);
            await fetch('/api/config', {
              method: 'PATCH',
              headers: authHeader,
              body: formData
            });
            fetchData();
            alert('Cron config saved');
          }}
        >
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-medium text-white/40 uppercase tracking-wider mb-2">
                Result expire (days)
              </label>
              <input
                name="resultExpireDays"
                type="number"
                step="any"
                defaultValue={config?.cron?.resultExpireDays ?? ''}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                placeholder="e.g. 7"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/40 uppercase tracking-wider mb-2">
                Result cron schedule
              </label>
              <input
                name="resultExpireCronSchedule"
                defaultValue={config?.cron?.resultExpireCronSchedule ?? '33 3 * * *'}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                placeholder="33 3 * * *"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/40 uppercase tracking-wider mb-2">
                Report expire (days)
              </label>
              <input
                name="reportExpireDays"
                type="number"
                step="any"
                defaultValue={config?.cron?.reportExpireDays ?? ''}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                placeholder="e.g. 30"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/40 uppercase tracking-wider mb-2">
                Report cron schedule
              </label>
              <input
                name="reportExpireCronSchedule"
                defaultValue={config?.cron?.reportExpireCronSchedule ?? '44 4 * * *'}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                placeholder="44 4 * * *"
              />
            </div>
          </div>
          <button
            type="submit"
            className="bg-emerald-500 hover:bg-emerald-600 text-black font-semibold px-8 py-3 rounded-xl transition-all"
          >
            Save cron config
          </button>
        </form>
      </div>

      <div className="bg-[#141414] border border-white/5 rounded-2xl p-8">
        <h3 className="text-xl font-semibold mb-6">Environment / Server info</h3>
        <dl className="space-y-3 text-sm">
          {serverInfo && (
            <>
              <InfoRow label="Total storage" value={serverInfo.dataFolderSizeinMB + ' MB'} />
              <InfoRow label="Number of reports" value={String(serverInfo.numOfReports)} />
              <InfoRow label="Reports folder size" value={serverInfo.reportsFolderSizeinMB + ' MB'} />
            </>
          )}
          {config && (
            <>
              <InfoRow label="Auth required" value={config.authRequired ? 'Yes' : 'No'} />
              <InfoRow label="Server cache" value={config.serverCache ? 'Enabled' : 'Disabled'} />
              <InfoRow label="Data storage" value={config.dataStorage ?? '—'} />
              {config.s3Endpoint && <InfoRow label="S3 endpoint" value={config.s3Endpoint} />}
              {config.s3Bucket && <InfoRow label="S3 bucket" value={config.s3Bucket} />}
            </>
          )}
        </dl>
      </div>

      <div className="bg-[#141414] border border-white/5 rounded-2xl p-8">
        <h3 className="text-xl font-semibold mb-6 text-red-400">Danger Zone</h3>
        <p className="text-white/40 text-sm mb-6">These actions are irreversible. Please be careful.</p>
        <div className="flex gap-4">
          <button
            onClick={async () => {
              if (confirm('Delete ALL reports? This will also remove any underlying result data.')) {
                const ids = reports.map((r) => r.id ?? r.reportID);
                await fetch('/api/report/delete', {
                  method: 'DELETE',
                  headers: { ...authHeader, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ reportsIds: ids })
                });
                fetchData();
              }
            }}
            className="border border-red-500/20 hover:bg-red-500/10 text-red-400 px-6 py-3 rounded-xl transition-all text-sm font-medium"
          >
            Purge All Reports
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2 border-b border-white/5">
      <dt className="text-white/40">{label}</dt>
      <dd className="text-white/80">{value}</dd>
    </div>
  );
}
