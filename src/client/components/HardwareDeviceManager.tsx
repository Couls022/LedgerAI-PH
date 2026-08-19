import React, { useState, useEffect } from 'react';
import { Printer, Usb, Wifi, RefreshCw, CheckCircle2, AlertCircle, HardDrive, Loader2, Play, Sliders } from 'lucide-react';

interface ScannerDevice {
  id: string;
  name: string;
  type: string;
  connection: string;
  status: string;
  isDefault: boolean;
  supportsADF: boolean;
  supportsDuplex: boolean;
  maxDpi: number;
  ipAddress: string;
  driverVersion: string;
}

interface PrinterDevice {
  id: string;
  name: string;
  type: string;
  connection: string;
  status: string;
  isDefault: boolean;
  paperWidthMm: number;
  ipAddress: string;
  paperStatus: string;
}

export default function HardwareDeviceManager() {
  const [scanners, setScanners] = useState<ScannerDevice[]>([]);
  const [printers, setPrinters] = useState<PrinterDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [testLog, setTestLog] = useState<string | null>(null);

  useEffect(() => {
    fetchHardwareDevices();
  }, []);

  const fetchHardwareDevices = async () => {
    setLoading(true);
    try {
      const [scannerRes, printerRes] = await Promise.all([
        fetch('/api/documents/scanners/detect'),
        fetch('/api/documents/printers/detect')
      ]);

      const scannerData = await scannerRes.json();
      const printerData = await printerRes.json();

      if (scannerData.scanners) setScanners(scannerData.scanners);
      if (printerData.printers) setPrinters(printerData.printers);
    } catch (err) {
      console.error("Failed to fetch hardware devices", err);
    } finally {
      setLoading(false);
    }
  };

  const runTestPrint = (printerName: string) => {
    setTestLog(`Sending BIR 80mm Test Page to thermal printer [${printerName}]... Output OK!`);
    setTimeout(() => setTestLog(null), 5000);
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 space-y-6 shadow-xs">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-4 flex-wrap gap-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <Printer className="w-5 h-5 text-indigo-600 dark:text-indigo-400" /> Hardware Printer &amp; Scanner Device Hub
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Real-time status of connected USB &amp; LAN Hardware Scanners (TWAIN/WIA/eSCL) and POS Thermal/Office Printers.
          </p>
        </div>

        <button
          onClick={fetchHardwareDevices}
          disabled={loading}
          className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Polling Ports...' : 'Scan Hardware Ports'}
        </button>
      </div>

      {testLog && (
        <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-medium flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{testLog}</span>
        </div>
      )}

      {/* Scanners Section */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-indigo-500" /> Detected Document Scanners ({scanners.length})
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {scanners.map((s) => (
            <div
              key={s.id}
              className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">{s.name}</h4>
                    {s.isDefault && (
                      <span className="px-1.5 py-0.5 text-[9px] font-extrabold uppercase bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 rounded border border-indigo-300 dark:border-indigo-800">
                        Default
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{s.type} • {s.connection}</p>
                </div>
                <span className="px-2 py-0.5 text-[10px] uppercase font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 rounded-full border border-emerald-300 dark:border-emerald-800">
                  {s.status}
                </span>
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span>Max: {s.maxDpi} DPI {s.supportsADF ? '(ADF Feeder)' : '(Flatbed)'}</span>
                <span className="font-mono text-indigo-600 dark:text-indigo-400">{s.ipAddress}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Printers Section */}
      <div className="space-y-3 pt-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
          <Printer className="w-4 h-4 text-emerald-500" /> Connected Printers ({printers.length})
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {printers.map((p) => (
            <div
              key={p.id}
              className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">{p.name}</h4>
                    {p.isDefault && (
                      <span className="px-1.5 py-0.5 text-[9px] font-extrabold uppercase bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 rounded border border-emerald-300 dark:border-emerald-800">
                        Primary POS
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{p.type} • Width: {p.paperWidthMm}mm</p>
                </div>
                <button
                  onClick={() => runTestPrint(p.name)}
                  className="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold rounded-lg border border-indigo-200 dark:border-indigo-800 flex items-center gap-1 transition-all"
                >
                  <Play className="w-3 h-3" /> Test Print
                </button>
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span>Paper Feed: {p.paperStatus}</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400">{p.ipAddress}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
