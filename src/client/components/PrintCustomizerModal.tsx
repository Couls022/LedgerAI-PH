import React, { useState, useEffect } from 'react';
import { 
  Printer, X, Upload, Palette, Building2, Phone, Mail, Globe, 
  FileText, CheckCircle2, ShieldCheck, Sparkles, RefreshCw, Eye, Image
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface CompanyBranding {
  id: string | null;
  companyId: string;
  logoUrl: string;
  brandColor: string;
  secondaryColor: string;
  headerTitle: string;
  footerNote: string;
  companyAddress: string;
  contactPhone: string;
  contactEmail: string;
  website: string;
  tinNumber: string;
  showLogo: boolean;
  showWatermark: boolean;
  customTerms: string;
}

interface PrintCustomizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentType?: 'INVOICE' | 'RECEIPT' | 'REPORT';
  documentData?: any;
}

const COLOR_PRESETS = [
  { name: 'Indigo Navy', primary: '#1e1b4b', secondary: '#4f46e5' },
  { name: 'Midnight Slate', primary: '#0f172a', secondary: '#3b82f6' },
  { name: 'Emerald Trust', primary: '#064e3b', secondary: '#10b981' },
  { name: 'Burgundy Executive', primary: '#450a0a', secondary: '#ef4444' },
  { name: 'Teal Enterprise', primary: '#042f2e', secondary: '#14b8a6' },
  { name: 'Corporate Cyan', primary: '#0c4a6e', secondary: '#06b6d4' },
];

export default function PrintCustomizerModal({
  isOpen,
  onClose,
  documentType = 'INVOICE',
  documentData
}: PrintCustomizerModalProps) {
  const { activeCompany } = useAuth();

  const [activeDocType, setActiveDocType] = useState<'INVOICE' | 'RECEIPT' | 'REPORT'>(documentType);
  const [activeTab, setActiveTab] = useState<'config' | 'preview'>('preview');
  
  const [branding, setBranding] = useState<CompanyBranding>({
    id: null,
    companyId: activeCompany?.id || '',
    logoUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=160&auto=format&fit=crop&q=80",
    brandColor: "#1e1b4b",
    secondaryColor: "#4f46e5",
    headerTitle: "OFFICIAL BILLING STATEMENT & BIR TAX INVOICE",
    footerNote: "Thank you for your business! Official BIR registered transaction document.",
    companyAddress: "Suite 1802, Ayala Tower One, Ayala Avenue, Makati City, Metro Manila, Philippines 1226",
    contactPhone: "+63 (2) 8888-9000",
    contactEmail: `billing@${activeCompany?.legalName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'company'}.ph`,
    website: `www.${activeCompany?.legalName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'company'}.ph`,
    tinNumber: activeCompany?.tin || "000-123-456-00000",
    showLogo: true,
    showWatermark: true,
    customTerms: "1. Payment is strictly due within 30 days of invoice date.\n2. Overdue balances subject to 1.5% monthly finance charge.\n3. Make all checks payable to the company's full legal registered name."
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchBranding();
    }
  }, [isOpen]);

  const fetchBranding = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/branding');
      if (res.ok) {
        const data = await res.json();
        setBranding({
          ...data,
          logoUrl: data.logoUrl || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=160&auto=format&fit=crop&q=80",
          brandColor: data.brandColor || "#1e1b4b",
          secondaryColor: data.secondaryColor || "#4f46e5",
          headerTitle: data.headerTitle || "OFFICIAL BILLING STATEMENT & BIR TAX INVOICE",
          footerNote: data.footerNote || "Thank you for your business!",
          companyAddress: data.companyAddress || "Suite 1802, Ayala Tower One, Ayala Avenue, Makati City, Metro Manila",
          contactPhone: data.contactPhone || "+63 (2) 8888-9000",
          contactEmail: data.contactEmail || "billing@company.ph",
          website: data.website || "www.company.ph",
          tinNumber: data.tinNumber || "000-123-456-00000",
          showLogo: data.showLogo !== undefined ? data.showLogo : true,
          showWatermark: data.showWatermark !== undefined ? data.showWatermark : true,
          customTerms: data.customTerms || "Payment terms: Net 30 days."
        });
      }
    } catch (err) {
      console.error("Fetch branding error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveBranding = async () => {
    try {
      setSaving(true);
      const res = await fetch('/api/branding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(branding)
      });

      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
      }
    } catch (err) {
      console.error("Save branding error:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleTriggerPrint = () => {
    window.print();
  };

  if (!isOpen) return null;

  const vatStatus = activeCompany?.vatStatus || 'VAT';
  const isVat = vatStatus === 'VAT';
  const isNonVat = vatStatus === 'NON_VAT';

  // Sample or actual document values for live preview
  const rawData = documentData || {
    invoiceNumber: "INV-2026-0089",
    date: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    customerName: "San Miguel Corporate Logistics Corp.",
    customerAddress: "San Miguel Head Office Complex, 40 San Miguel Ave, Mandaluyong City, Metro Manila",
    customerTin: "101-987-654-0000",
    items: [
      { description: "Enterprise Cloud ERP Software License & Hosting (Annual)", amount: 150000.00 },
      { description: "BIR Electronic Invoicing System Integration & CAS Setup", amount: 45000.00 },
      { description: "Quarterly Compliance Audit & Onboarding Services", amount: 25000.00 }
    ],
    subtotal: 220000.00,
    withholdingTax: 4400.00,
  };

  const computedSubtotal = rawData.subtotal || rawData.items?.reduce((sum: number, i: any) => sum + (i.amount || 0), 0) || 220000.00;
  const computedVat = isVat ? Math.round(computedSubtotal * 0.12 * 100) / 100 : 0;
  const computedWht = rawData.withholdingTax || Math.round(computedSubtotal * 0.02 * 100) / 100;
  const computedTotal = computedSubtotal + computedVat - computedWht;

  const sampleInvoice = {
    ...rawData,
    subtotal: computedSubtotal,
    vatAmount: computedVat,
    withholdingTax: computedWht,
    totalAmount: computedTotal
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-2 sm:p-5 overflow-y-auto print:p-0 print:bg-white print:static print:inset-auto">
      
      {/* Container - Hidden on print except print target */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-6xl w-full border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[95vh] print:max-h-none print:shadow-none print:border-none print:w-full">
        
        {/* Header - Screen only */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0 print:hidden">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl border border-indigo-500/30">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base flex items-center gap-2">
                Custom Printable Layout & Branding Studio
              </h3>
              <p className="text-xs text-slate-400">
                Configure brand logos, accent colors, headers, footers & contact details for professional client documents
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleTriggerPrint}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center gap-2"
            >
              <Printer className="w-4 h-4" /> Print / Save PDF
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Controls Bar - Screen only */}
        <div className="px-6 py-3 bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3 shrink-0 print:hidden">
          
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                activeTab === 'preview'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5" /> Interactive Print Sheet
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('config')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                activeTab === 'config'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200'
              }`}
            >
              <Palette className="w-3.5 h-3.5" /> Customize Brand & Layout
            </button>
          </div>

          {/* Document Type Selector */}
          <div className="flex items-center gap-1 bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
            {(['INVOICE', 'RECEIPT', 'REPORT'] as const).map(dt => (
              <button
                key={dt}
                onClick={() => setActiveDocType(dt)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeDocType === dt
                    ? 'bg-slate-900 text-white dark:bg-indigo-600'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                {dt === 'INVOICE' ? 'Sales Invoice' : dt === 'RECEIPT' ? 'Official Receipt' : 'Trial Balance Report'}
              </button>
            ))}
          </div>

        </div>

        {/* Modal Main Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 print:p-0 print:overflow-visible">

          {/* TAB 1: Brand & Layout Configuration Form */}
          {activeTab === 'config' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 print:hidden">
              
              <div className="lg:col-span-8 space-y-6">
                
                {/* Brand Logo & Title Header */}
                <div className="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4">
                  <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Image className="w-4 h-4 text-indigo-500" /> Logo & Document Header
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="block text-slate-500 font-bold mb-1">Company Logo Image (URL or Upload)</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={branding.logoUrl}
                          onChange={(e) => setBranding({ ...branding, logoUrl: e.target.value })}
                          className="flex-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono font-medium text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
                          placeholder="https://..."
                        />
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          id="logo-upload"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onload = (event) => {
                                setBranding({ ...branding, logoUrl: event.target?.result as string });
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                        />
                        <label
                          htmlFor="logo-upload"
                          className="px-3 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl cursor-pointer flex items-center font-bold transition-colors"
                          title="Upload Image"
                        >
                          <Image className="w-4 h-4" />
                        </label>
                      </div>
                    </div>

                    <div>
                      <label className="block text-slate-500 font-bold mb-1">Header Title Banner Text</label>
                      <input
                        type="text"
                        value={branding.headerTitle}
                        onChange={(e) => setBranding({ ...branding, headerTitle: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-bold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Color Palette Swatches */}
                <div className="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4">
                  <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Palette className="w-4 h-4 text-indigo-500" /> Brand Color Theme
                  </h4>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {COLOR_PRESETS.map(p => (
                      <button
                        key={p.name}
                        type="button"
                        onClick={() => setBranding({ ...branding, brandColor: p.primary, secondaryColor: p.secondary })}
                        className={`p-3 rounded-xl border text-left transition-all flex items-center gap-3 ${
                          branding.brandColor === p.primary
                            ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/40 ring-2 ring-indigo-500'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300'
                        }`}
                      >
                        <div className="w-6 h-6 rounded-lg shrink-0 shadow-xs border border-white/20" style={{ backgroundColor: p.primary }} />
                        <div className="truncate">
                          <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">{p.name}</p>
                          <p className="text-[10px] font-mono text-slate-400">{p.primary}</p>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Custom Accent Color Hex</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={branding.brandColor}
                        onChange={(e) => setBranding({ ...branding, brandColor: e.target.value })}
                        className="w-10 h-10 rounded-xl cursor-pointer border-none bg-transparent"
                      />
                      <input
                        type="text"
                        value={branding.brandColor}
                        onChange={(e) => setBranding({ ...branding, brandColor: e.target.value })}
                        className="w-32 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono font-bold text-xs"
                      />
                    </div>
                  </div>
                </div>

                {/* Company Contact Details & BIR TIN */}
                <div className="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4">
                  <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-indigo-500" /> Company Address & BIR Registration Info
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-slate-500 font-bold mb-1">BIR Tax Identification No. (TIN)</label>
                      <input
                        type="text"
                        value={branding.tinNumber}
                        onChange={(e) => setBranding({ ...branding, tinNumber: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-500 font-bold mb-1">Phone Contact</label>
                      <input
                        type="text"
                        value={branding.contactPhone}
                        onChange={(e) => setBranding({ ...branding, contactPhone: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-500 font-bold mb-1">Billing Email</label>
                      <input
                        type="text"
                        value={branding.contactEmail}
                        onChange={(e) => setBranding({ ...branding, contactEmail: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-slate-500 font-bold mb-1">Company Website</label>
                      <input
                        type="text"
                        value={branding.website}
                        onChange={(e) => setBranding({ ...branding, website: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-medium"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-slate-500 font-bold mb-1">Company Registered Address</label>
                      <textarea
                        rows={2}
                        value={branding.companyAddress}
                        onChange={(e) => setBranding({ ...branding, companyAddress: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-medium text-xs"
                      />
                    </div>
                  </div>
                </div>

                {/* Footer Payment Terms */}
                <div className="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3 text-xs">
                  <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    Footer Payment Terms & BIR Disclaimer
                  </h4>

                  <div>
                    <label className="block text-slate-500 font-bold mb-1">Custom Payment Terms & Disclaimer</label>
                    <textarea
                      rows={3}
                      value={branding.customTerms}
                      onChange={(e) => setBranding({ ...branding, customTerms: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-xs"
                    />
                  </div>
                </div>

              </div>

              {/* Sidebar Toggles & Save Action */}
              <div className="lg:col-span-4 space-y-4">
                <div className="p-5 bg-indigo-50/50 dark:bg-indigo-950/30 rounded-2xl border border-indigo-100 dark:border-indigo-900/50 space-y-4 text-xs">
                  <h4 className="font-bold text-sm text-indigo-950 dark:text-indigo-200 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-indigo-600" /> Print Elements Toggles
                  </h4>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={branding.showLogo}
                      onChange={(e) => setBranding({ ...branding, showLogo: e.target.checked })}
                      className="w-4 h-4 text-indigo-600 rounded-md focus:ring-indigo-500"
                    />
                    <span className="font-bold text-slate-800 dark:text-slate-200">Include Brand Logo Header</span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={branding.showWatermark}
                      onChange={(e) => setBranding({ ...branding, showWatermark: e.target.checked })}
                      className="w-4 h-4 text-indigo-600 rounded-md focus:ring-indigo-500"
                    />
                    <span className="font-bold text-slate-800 dark:text-slate-200">Include BIR Official Stamp & Watermark</span>
                  </label>
                </div>

                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={handleSaveBranding}
                    disabled={saving}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
                  >
                    {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    <span>Save Brand Profile</span>
                  </button>

                  {saveSuccess && (
                    <div className="p-3 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 text-xs font-bold rounded-xl text-center border border-emerald-200">
                      Branding preferences saved successfully!
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setActiveTab('preview')}
                    className="w-full py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl hover:bg-slate-200 transition-colors"
                  >
                    Switch to Live Preview
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* TAB 2: Live Printable Document Sheet */}
          {(activeTab === 'preview' || true) && (
            <div className={activeTab === 'preview' ? 'block' : 'hidden print:block'}>
              
              {/* Paper Sheet Representation (A4 Styled) */}
              <div 
                className="bg-white text-slate-900 rounded-2xl shadow-xl max-w-4xl mx-auto border border-slate-200 overflow-hidden print:shadow-none print:border-none print:m-0 print:max-w-none print:rounded-none p-8 sm:p-12 space-y-8 relative font-sans"
              >
                
                {/* Background Watermark */}
                {branding.showWatermark && (
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden opacity-[0.03] select-none">
                    <span className="text-9xl font-black rotate-[-30deg] uppercase tracking-widest text-slate-900">
                      BIR REGISTERED
                    </span>
                  </div>
                )}

                {/* Branded Header Banner */}
                <div 
                  className="p-6 rounded-2xl text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 shadow-md"
                  style={{ backgroundColor: branding.brandColor }}
                >
                  <div className="flex items-center gap-4">
                    {branding.showLogo && branding.logoUrl && (
                      <img 
                        src={branding.logoUrl} 
                        alt="Company Logo" 
                        className="w-14 h-14 object-cover rounded-xl border-2 border-white/20 bg-white shadow-sm shrink-0"
                      />
                    )}
                    <div>
                      <h1 className="text-xl font-extrabold tracking-tight uppercase">
                        {activeCompany?.legalName || 'Acme Philippine Services Corp.'}
                      </h1>
                      <p className="text-xs opacity-90 font-mono mt-0.5">
                        BIR TIN: {branding.tinNumber}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-xs font-black tracking-wider uppercase px-3 py-1 bg-white/10 rounded-lg backdrop-blur-xs border border-white/20">
                      {branding.headerTitle}
                    </span>
                    <p className="text-[11px] opacity-80 mt-1 font-mono">
                      {activeDocType === 'INVOICE' ? 'TAX INVOICE' : activeDocType === 'RECEIPT' ? 'OFFICIAL RECEIPT' : 'FINANCIAL STATEMENT'}
                    </p>
                  </div>
                </div>

                {/* Company & Client Addresses Bar */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-xs border-b border-slate-200 pb-6">
                  <div className="space-y-1">
                    <p className="font-extrabold uppercase text-slate-400 text-[10px] tracking-wider">ISSUED BY (PROVIDER)</p>
                    <p className="font-bold text-slate-900 text-sm">{activeCompany?.legalName}</p>
                    <p className="text-slate-600 whitespace-pre-line">{branding.companyAddress}</p>
                    <p className="text-slate-600 font-mono">Tel: {branding.contactPhone} | Email: {branding.contactEmail}</p>
                    <p className="text-slate-600 font-mono">{branding.website}</p>
                  </div>

                  <div className="space-y-1 sm:text-right">
                    <p className="font-extrabold uppercase text-slate-400 text-[10px] tracking-wider">BILLED TO (CLIENT)</p>
                    <p className="font-bold text-slate-900 text-sm">{sampleInvoice.customerName}</p>
                    <p className="text-slate-600">{sampleInvoice.customerAddress}</p>
                    <p className="text-slate-600 font-mono">TIN: {sampleInvoice.customerTin}</p>
                    <div className="pt-2 font-mono text-[11px] text-slate-700">
                      <span className="font-bold">Doc #:</span> {sampleInvoice.invoiceNumber} | <span className="font-bold">Date:</span> {sampleInvoice.date}
                    </div>
                  </div>
                </div>

                {/* Main Content Table */}
                {activeDocType === 'INVOICE' && (
                  <div className="space-y-4">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b-2 border-slate-900 text-slate-900 font-black uppercase tracking-wider text-[11px]">
                          <th className="py-3 px-2">Item Description</th>
                          <th className="py-3 px-2 text-right">Amount (PHP)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sampleInvoice.items.map((item: any, idx: number) => (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="py-3.5 px-2 font-medium text-slate-800">{item.description}</td>
                            <td className="py-3.5 px-2 text-right font-mono font-bold text-slate-900">
                              ₱{item.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Financial Summary Calculation */}
                    <div className="flex justify-end pt-4 border-t border-slate-200">
                      <div className="w-72 space-y-2 text-xs font-mono">
                        <div className="flex justify-between text-slate-600">
                          <span>Subtotal ({isVat ? 'Net of VAT' : 'Gross Sales'}):</span>
                          <span>₱{sampleInvoice.subtotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between text-slate-600">
                          <span>{isVat ? '12% Value Added Tax (VAT):' : 'Output VAT (Non-VAT 3% Form 2551Q):'}</span>
                          <span>₱{sampleInvoice.vatAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between text-slate-600 border-b border-slate-200 pb-2">
                          <span>Less 2% Creditable Withholding (CWT):</span>
                          <span>(₱{sampleInvoice.withholdingTax.toLocaleString('en-PH', { minimumFractionDigits: 2 })})</span>
                        </div>
                        <div className="flex justify-between text-sm font-black text-slate-900 pt-1">
                          <span>Total Amount Payable:</span>
                          <span style={{ color: branding.brandColor }}>
                            ₱{sampleInvoice.totalAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* BIR EOPT Act Statutory Legend */}
                    <div className="mt-4 p-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-[10px] text-slate-600 font-mono text-center">
                      {isVat 
                        ? "THIS SALES INVOICE IS VALID FOR CLAIMING INPUT VAT CREDITS PURSUANT TO BIR EOPT ACT (RA 11976)."
                        : "THIS NON-VAT SALES INVOICE IS ISSUED PURSUANT TO BIR EOPT ACT (RA 11976). NOT VALID FOR CLAIMING INPUT VAT CREDITS."}
                    </div>
                  </div>
                )}

                {activeDocType === 'RECEIPT' && (
                  <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 space-y-4 text-xs">
                    <div className="flex justify-between items-center border-b border-slate-200 pb-3">
                      <div>
                        <p className="font-bold text-sm text-slate-900">OFFICIAL RECEIPT ACKNOWLEDGMENT</p>
                        <p className="text-slate-500 font-mono">OR Number: OR-2026-9812</p>
                      </div>
                      <span className="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full font-bold font-mono text-[11px]">
                        PAYMENT RECEIVED
                      </span>
                    </div>

                    <p className="text-slate-700 leading-relaxed font-medium">
                      Received from <strong className="text-slate-900">{sampleInvoice.customerName}</strong> the sum of{' '}
                      <strong className="text-slate-900 font-mono">
                        Two Hundred Forty-Two Thousand Philippine Pesos (₱242,000.00)
                      </strong>{' '}
                      in full settlement of billing invoice #{sampleInvoice.invoiceNumber}.
                    </p>
                  </div>
                )}

                {activeDocType === 'REPORT' && (
                  <div className="space-y-4 text-xs">
                    <h3 className="font-bold text-sm text-slate-900 border-b border-slate-200 pb-2">
                      Trial Balance Ledger Summary (BIR Annex B)
                    </h3>
                    <div className="grid grid-cols-2 gap-4 font-mono">
                      <div className="p-3 bg-slate-50 rounded-xl">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Total Ledger Debits</p>
                        <p className="text-base font-extrabold text-slate-900">₱1,285,400.00</p>
                      </div>
                      <div className="p-3 bg-slate-50 rounded-xl">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Total Ledger Credits</p>
                        <p className="text-base font-extrabold text-slate-900">₱1,285,400.00</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Signatures & BIR Registration Footnote */}
                <div className="pt-8 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-8 text-xs">
                  <div className="space-y-2">
                    <p className="font-bold text-slate-800">Authorized Signature & Seal:</p>
                    <div className="h-16 border-b-2 border-slate-300 border-dashed flex items-end pb-1 text-slate-400 italic">
                      Signatory: {activeCompany?.legalName} Financial Controller
                    </div>
                  </div>

                  <div className="space-y-1 text-slate-500 text-[11px] sm:text-right font-mono">
                    <p className="font-bold text-slate-800">BIR Registration & Permit Info:</p>
                    <p>BIR Authority to Print (ATP) No. 038-2026-90182</p>
                    <p>Date Issued: Jan 15, 2026 | Valid Until: Dec 31, 2031</p>
                    <p>CAS Permit # 2026-0812-CAS-0091</p>
                  </div>
                </div>

                {/* Custom Footer Terms */}
                <div 
                  className="p-4 rounded-xl text-[11px] font-medium text-slate-700 space-y-1"
                  style={{ backgroundColor: `${branding.brandColor}10`, borderLeft: `4px solid ${branding.brandColor}` }}
                >
                  <p className="font-bold text-slate-900">Payment Terms & Instructions:</p>
                  <p className="whitespace-pre-line font-mono text-[10px] text-slate-600">{branding.customTerms}</p>
                  <p className="pt-1 text-slate-500 italic text-[10px]">{branding.footerNote}</p>
                </div>

              </div>

            </div>
          )}

        </div>

      </div>

    </div>
  );
}
