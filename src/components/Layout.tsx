import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { FileText, Settings, BarChart3, ExternalLink, XCircle, BookOpen } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AppConfig } from '../types';

export function Layout() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then(setConfig)
      .catch(console.error);
  }, []);

  const pageName = location.pathname.split('/').filter(Boolean)[0] || 'reports';

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex font-sans">
      <aside className="w-64 bg-[#111] border-r border-white/5 flex flex-col z-50">
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center flex-shrink-0">
            <FileText className="w-6 h-6 text-black" />
          </div>
          <span className="font-bold text-lg tracking-tight">
            {config?.title || 'Reports'}
          </span>
        </div>
        <nav className="flex-1 px-3 space-y-1 mt-4">
          <NavLink
            to="/reports"
            className={({ isActive }) =>
              `w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${isActive ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/20' : 'text-white/40 hover:text-white hover:bg-white/5'}`
            }
          >
            <FileText size={20} />
            <span className="font-medium">Reports</span>
          </NavLink>
          <NavLink
            to="/trends"
            className={({ isActive }) =>
              `w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${isActive ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/20' : 'text-white/40 hover:text-white hover:bg-white/5'}`
            }
          >
            <BarChart3 size={20} />
            <span className="font-medium">Trends</span>
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${isActive ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/20' : 'text-white/40 hover:text-white hover:bg-white/5'}`
            }
          >
            <Settings size={20} />
            <span className="font-medium">Settings</span>
          </NavLink>
          <a
            href="/api/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-white/40 hover:text-white hover:bg-white/5"
          >
            <BookOpen size={20} />
            <span className="font-medium">API Docs</span>
          </a>
        </nav>
        <div className="p-4 border-t border-white/5">
          <button
            onClick={() => { logout(); navigate('/login'); }}
            className="w-full flex items-center gap-3 px-3 py-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          >
            <XCircle size={20} />
            <span>Logout</span>
          </button>
        </div>
      </aside>
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-[#111]/50 backdrop-blur-md border-b border-white/5 flex items-center justify-between px-8 z-40">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-medium capitalize">{pageName}</h2>
          </div>
          <div className="flex items-center gap-4">
            {config?.headerLinks && Object.entries(config.headerLinks).map(([name, url]) => (
              <a
                key={name}
                href={url as string}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-white/40 hover:text-emerald-400 transition-colors flex items-center gap-1"
              >
                {name} <ExternalLink size={12} />
              </a>
            ))}
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
