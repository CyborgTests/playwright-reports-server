import React, { useState } from 'react';
import { Upload } from 'lucide-react';

export default function UploadResultButton({ onUpload, apiToken }: { onUpload: () => void; apiToken: string }) {
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('project', 'manual-upload');
    formData.append('testRunName', file.name.replace('.zip', ''));
    formData.append('reporter', 'UI-User');
    try {
      await fetch('/api/report/upload', {
        method: 'POST',
        headers: apiToken ? { Authorization: apiToken } : {},
        body: formData
      });
      onUpload();
    } catch (error) {
      console.error('Upload failed', error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-white/40">Playwright blob ZIP file</span>
      <label
        className={`cursor-pointer bg-white/5 hover:bg-white/10 text-white font-semibold px-6 py-3 rounded-xl transition-all flex items-center gap-2 border border-white/5 ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <Upload size={20} className={uploading ? 'animate-bounce' : ''} />
        {uploading ? 'Uploading...' : 'Upload report'}
        <input type="file" className="hidden" accept=".zip" onChange={handleUpload} />
      </label>
    </div>
  );
}
