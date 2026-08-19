import React, { useEffect, useState } from 'react';
import { FolderLock, Upload, Trash2, CheckCircle2, FileText, X } from 'lucide-react';

export default function DocumentVaultView() {
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [fileName, setFileName] = useState('Audited_Financial_Statements_2025.pdf');
  const [fileCategory, setFileCategory] = useState('TAX');
  const [fileTags, setFileTags] = useState('balance-sheet, audit, signed');
  const [extractedText, setExtractedText] = useState('Balance Sheet total assets PHP 120,500,000...');

  const fetchDocs = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/audit-advanced/vault');
      const data = await res.json();
      if (res.ok) {
        setDocs(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocs();
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/audit-advanced/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, fileCategory, fileTags, extractedText })
      });
      if (res.ok) {
        setIsModalOpen(false);
        fetchDocs();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Move document to soft-delete bin?')) return;
    try {
      const res = await fetch(`/api/audit-advanced/vault/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchDocs();
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        <div>
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <FolderLock className="w-5 h-5 text-emerald-600" /> Secure Document & Evidence Vault
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">SHA-256 integrity verification, OCR extracted text storage, category tagging, and retention policy enforcement.</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm"
        >
          <Upload className="w-4 h-4" /> Upload Document / Evidence
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="p-4 border-b font-bold text-xs text-slate-400 uppercase">Company Evidence Vault ({docs.length})</div>
        {loading ? (
          <div className="p-12 text-center text-xs text-slate-400">Loading vault documents...</div>
        ) : docs.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400">No documents uploaded yet.</div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {docs.map(doc => (
              <div key={doc.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 rounded">
                      {doc.fileCategory}
                    </span>
                    <h5 className="font-bold text-xs text-slate-900 dark:text-slate-100">{doc.fileName}</h5>
                  </div>
                  <p className="text-[11px] font-mono text-slate-400 truncate max-w-md">SHA-256 Hash: {doc.fileHash}</p>
                  <p className="text-xs text-slate-600 dark:text-slate-300">OCR Text: {doc.extractedText}</p>
                </div>

                <button
                  onClick={() => handleDelete(doc.id)}
                  className="p-2 text-slate-400 hover:text-red-600 rounded-lg"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border w-full max-w-md overflow-hidden">
            <div className="p-4 border-b flex justify-between items-center bg-slate-50 dark:bg-slate-900">
              <h4 className="font-bold text-xs">Upload Document</h4>
              <button onClick={() => setIsModalOpen(false)}><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleUpload} className="p-6 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">File Name</label>
                <input type="text" required value={fileName} onChange={e => setFileName(e.target.value)} className="w-full px-3 py-2 text-xs border rounded-lg" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Category</label>
                <select value={fileCategory} onChange={e => setFileCategory(e.target.value)} className="w-full px-3 py-2 text-xs border rounded-lg">
                  <option value="GENERAL">General</option>
                  <option value="TAX">Tax & Financial</option>
                  <option value="BANK_STMT">Bank Statement</option>
                  <option value="WORKPAPER">Working Paper Evidence</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Extracted Text / OCR Content</label>
                <textarea rows={3} value={extractedText} onChange={e => setExtractedText(e.target.value)} className="w-full px-3 py-2 text-xs border rounded-lg" />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-xs text-slate-500">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold">Upload & Hash</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
