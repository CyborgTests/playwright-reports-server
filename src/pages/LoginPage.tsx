import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const [apiToken, setApiToken] = useState(localStorage.getItem('api_token') || '');
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/reports';

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    login(apiToken);
    navigate(callbackUrl, { replace: true });
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4 font-sans">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-[#141414] border border-white/10 rounded-2xl p-8 shadow-2xl"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center mb-4 border border-emerald-500/20">
            <FileText className="w-8 h-8 text-emerald-500" />
          </div>
          <h1 className="text-2xl font-semibold text-white">Playwright Reports</h1>
          <p className="text-white/40 text-sm mt-1 text-center">Enter your API token to access the dashboard</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-white/40 uppercase tracking-wider mb-2">API Token</label>
            <input
              type="password"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 transition-colors"
              placeholder="••••••••••••••••"
              required
            />
          </div>
          <button
            type="submit"
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-black font-semibold py-3 rounded-xl transition-all active:scale-[0.98]"
          >
            Sign In
          </button>
        </form>
      </motion.div>
    </div>
  );
}
