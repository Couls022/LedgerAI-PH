import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCcw, ArrowLeft, AlertCircle, Database, CheckCircle, Loader2, AlertTriangle, FileText, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function RestoreProfile() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [backupData, setBackupData] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<any>(null);
  const [scopeSummary, setScopeSummary] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [mode, setMode] = useState<'NEW' | 'REPLACE'>('NEW');
  const [status, setStatus] = useState<'IDLE' | 'VALIDATING' | 'READY' | 'RESTORING' | 'SUCCESS' | 'ERROR'>('IDLE');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [restoredCompanyId, setRestoredCompanyId] = useState<string | null>(null);
  const [destinationPath, setDestinationPath] = useState<string>('');
  const destinationInputRef = React.useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number>(0);
  const [validationStep, setValidationStep] = useState<string>('');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const handleFolderBrowse = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const path = files[0].webkitRelativePath;
      const folderName = path.split('/')[0];
      setDestinationPath(folderName ? `D:\\LedgerAI PH\\Companies\\${folderName}` : 'D:\\LedgerAI PH\\Companies');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      const fileNameLower = selected.name.toLowerCase();
      if (!fileNameLower.endsWith('.lai') && !fileNameLower.endsWith('.lgb')) {
        setStatus('ERROR');
        setErrorMsg('Invalid file format. This system exclusively supports proprietary LedgerAI PH Database (.lai) files.');
        return;
      }
      setFile(selected);
      setStatus('VALIDATING');
      setLogs([]);
      addLog('Starting database file upload...');
      addLog('Checking for .lai database header signature...');
      setProgress(15);
      setValidationStep('Reading binary bytes from LedgerAI database file...');
      setErrorMsg('');
      
      const reader = new FileReader();
      
      reader.onprogress = (event) => {
        if (event.lengthComputable) {
          const loadedPercent = Math.round((event.loaded / event.total) * 35);
          setProgress(15 + loadedPercent);
        }
      };

      reader.onload = async (event) => {
        try {
          addLog('File read complete.');
          
          // Basic header signature validation
          const arrayBuffer = event.target?.result as ArrayBuffer;
          const bytes = new Uint8Array(arrayBuffer);
          
          // Check for LAI (0x4C, 0x41, 0x49) or legacy LGB (0x4C, 0x47, 0x42) signature
          const isLaiHeader = bytes.length > 3 && bytes[0] === 0x4C && bytes[1] === 0x41 && bytes[2] === 0x49;
          const isLgbHeader = bytes.length > 3 && bytes[0] === 0x4C && bytes[1] === 0x47 && bytes[2] === 0x42;
          
          if (!isLaiHeader && !isLgbHeader) {
            addLog('Error: Invalid or missing .lai database header signature.');
            throw new Error('This file lacks a valid LedgerAI database header signature and cannot be restored.');
          }
          addLog('.lai database signature verified.');

          setProgress(55);
          setValidationStep('Parsing binary payload & preparing metadata envelope...');
          addLog('Parsing binary payload...');
          
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);

          setProgress(75);
          setValidationStep('Connecting to server for cryptographic signature validation...');
          addLog('Connecting to server...');

          const res = await fetch('/api/restore/validate', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ backupData: base64 })
          });
          
          setProgress(90);
          setValidationStep('Checking cryptographic signatures...');
          addLog('Checking signatures...');
          
          const data = await res.json();
          if (!res.ok) {
            addLog(`Error: ${data.message}`);
            throw new Error(data.message || 'Validation failed');
          }
          
          addLog('Signature valid.');
          addLog('Package structure verified.');
          addLog('Scope summary extracted.');
          
          setProgress(100);
          setValidationStep('Package integrity verified successfully!');
          
          // Small aesthetic delay so the user feels the 100% success state
          await new Promise((resolve) => setTimeout(resolve, 500));

          setBackupData(base64);
          setMetadata(data.metadata);
          setScopeSummary(data.scopeSummary);
          setStatus('READY');
        } catch (err: any) {
          setStatus('ERROR');
          addLog(`Failed: ${err.message}`);
          setErrorMsg(err.message || 'Failed to read or validate backup file');
        }
      };

      reader.onerror = () => {
        setStatus('ERROR');
        setErrorMsg('Failed to read the selected backup file from local storage.');
      };

      reader.readAsArrayBuffer(selected);
    }
  };

  const triggerRestore = () => {
    if (!backupData || !metadata) return;
    setShowConfirmDialog(true);
  };

  const handleRestore = async () => {
    setShowConfirmDialog(false);
    setStatus('RESTORING');
    setErrorMsg('');

    try {
      const res = await fetch('/api/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          mode,
          backupData,
          targetCompanyId: metadata.companyId,
          destinationPath
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Restore failed');
      }

      setRestoredCompanyId(data.companyId);
      setStatus('SUCCESS');
    } catch (err: any) {
      setStatus('ERROR');
      setErrorMsg(err.message || 'Restore failed');
    }
  };

  const steps = [
    { label: 'Selecting', description: 'Upload .lai file' },
    { label: 'Validating', description: 'Check integrity' },
    { label: 'Confirming', description: 'Verify details' },
    { label: 'Finalizing', description: 'Restore database' }
  ];

  let activeStep = 0;
  if (status === 'VALIDATING') {
    activeStep = 1;
  } else if (status === 'READY' || showConfirmDialog) {
    activeStep = 2;
  } else if (status === 'RESTORING' || status === 'SUCCESS') {
    activeStep = 3;
  }

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 transition-colors duration-200">
      <div className="w-full max-w-3xl mx-auto">
        <button 
          onClick={() => navigate('/launcher')}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-bold text-xs uppercase tracking-wider mb-8"
        >
          <ArrowLeft className="w-4 h-4" /> Launcher
        </button>

        <div className="mb-8">
          <h2 className="text-3xl font-black text-slate-900">Restore Company</h2>
          <p className="text-slate-600 mt-1">Restore your accounting data from a backup file.</p>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 mb-8">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
           <div className="bg-indigo-600 p-6 md:p-8">
             <div className="flex justify-between items-start mb-6">
               <div>
                 <h1 className="text-2xl font-bold text-white flex items-center gap-2 mb-1">
                   <RefreshCcw className="w-6 h-6" />
                   Restore Company Profile
                 </h1>
                 <p className="text-indigo-200 text-sm">Restore an entire company environment from a local backup file.</p>
               </div>
               <div className="bg-indigo-800/50 text-indigo-100 text-xs font-semibold px-3 py-1.5 rounded-full border border-indigo-500/30">
                 Step {activeStep + 1} of {steps.length}
               </div>
             </div>

             {/* Progress Stepper */}
             <div className="flex gap-2">
               {steps.map((step, idx) => (
                 <div key={idx} className="flex-1 relative">
                   <div className={`h-1 rounded-full w-full mb-1 ${activeStep > idx ? 'bg-emerald-400' : activeStep === idx ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'bg-indigo-800'}`}></div>
                   <span className={`text-[10px] md:text-xs font-semibold ${activeStep === idx ? 'text-white' : 'text-indigo-200'}`}>
                     {step.label}
                   </span>
                 </div>
               ))}
             </div>
           </div>
           
           {/* Activity Log */}
           {status === 'VALIDATING' && (
             <div className="px-8 pb-4 bg-white">
               <div className="bg-slate-900 rounded-lg p-3 font-mono text-[11px] text-emerald-400 h-32 overflow-y-auto shadow-inner">
                 {logs.map((log, i) => <div key={i}>{log}</div>)}
               </div>
             </div>
           )}
           
           <div className="p-8">
             {status === 'IDLE' || status === 'VALIDATING' || status === 'ERROR' ? (
               <div className="space-y-6">
                 {status === 'ERROR' && (
                   <div className="p-4 bg-red-50 text-red-700 rounded-lg border border-red-200 flex items-start gap-3">
                     <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                     <div>
                       <p className="font-semibold text-sm">Restore Failed</p>
                       <p className="text-sm">{errorMsg}</p>
                     </div>
                   </div>
                 )}

                 <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:bg-slate-50 transition-colors cursor-pointer relative">
                    <input 
                      type="file" 
                      accept=".lai,.lgb"
                      onChange={handleFileChange}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <Database className="w-10 h-10 text-indigo-600 mx-auto mb-3" />
                    <p className="text-slate-900 font-bold">Select LedgerAI PH Production Database File (.lai)</p>
                    <p className="text-slate-500 text-sm mt-1">Proprietary LedgerAI Database Package (.lai) format</p>
                 </div>
                 
                 {status === 'VALIDATING' && (
                   <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3 w-full">
                     <div className="flex items-center justify-between text-xs text-slate-500 font-bold uppercase tracking-wider">
                       <span className="flex items-center gap-1.5">
                         <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
                         {validationStep}
                       </span>
                       <span>{progress}%</span>
                     </div>
                     <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                       <div 
                         className="bg-amber-600 h-full rounded-full transition-all duration-300 ease-out"
                         style={{ width: `${progress}%` }}
                       />
                     </div>
                   </div>
                 )}
               </div>
             ) : status === 'SUCCESS' ? (
               <div className="text-center py-8">
                 <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
                 <h3 className="text-xl font-bold text-slate-900">Restore Successful</h3>
                 <p className="text-slate-500 mt-2">The company profile has been restored.</p>
                 
                 <div className="mt-8">
                   <button 
                     onClick={() => navigate(`/login/${restoredCompanyId}`)}
                     className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-colors"
                   >
                     Open Restored Profile
                   </button>
                 </div>
               </div>
             ) : (
                /* Confirmation view */
               <div className="space-y-6">
                 <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
                    <h4 className="font-bold text-slate-800 border-b border-slate-200 pb-2">Restore Company Profile</h4>
                    
                    <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                      <div>
                        <p className="text-slate-500 text-xs uppercase font-bold">Company</p>
                        <p className="font-semibold text-slate-900">{metadata.companyName}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-xs uppercase font-bold">Company ID</p>
                        <p className="font-mono text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded">{metadata.companyId}</p>
                      </div>
                    </div>
                 </div>

                 <div className="pt-2 flex items-center justify-end gap-3">
                   <button 
                     type="button"
                     onClick={() => setStatus('IDLE')}
                     className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors"
                   >
                     Cancel
                   </button>
                   <button 
                     onClick={triggerRestore}
                     className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                   >
                     Proceed with Restore
                   </button>
                 </div>
               </div>
             )}
           </div>
        </div>
        </div>
      </div>
    </div>
  );
}
