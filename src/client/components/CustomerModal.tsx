import React, { useState } from 'react';
import { UserPlus, X, Building2, FileText, Phone, Mail, MapPin, Tag, ShieldCheck } from 'lucide-react';

interface CustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCustomerCreated: (customer: any) => void;
  initialData?: any;
}

export default function CustomerModal({
  isOpen,
  onClose,
  onCustomerCreated,
  initialData
}: CustomerModalProps) {
  const isEditing = Boolean(initialData?.id);

  const [formData, setFormData] = useState({
    code: initialData?.code || `CUST-${Math.floor(1000 + Math.random() * 9000)}`,
    legalName: initialData?.legalName || '',
    tradeName: initialData?.tradeName || '',
    tin: initialData?.tin || '',
    address: initialData?.address || '',
    contactPerson: initialData?.contactPerson || '',
    contactDetails: initialData?.contactDetails || '',
    paymentTerms: initialData?.paymentTerms || 'NET_30',
    creditLimit: initialData?.creditLimit || 0,
    taxClassification: initialData?.taxClassification || 'CORPORATION',
    vatStatus: initialData?.vatStatus || 'VATable',
    notes: initialData?.notes || ''
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.legalName.trim()) {
      setError('Legal / Registered Customer Name is required.');
      return;
    }
    if (!formData.code.trim()) {
      setError('Customer Code is required.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const url = isEditing
        ? `/api/master-data/customers/${initialData.id}`
        : '/api/master-data/customers';
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Failed to save customer');
      }

      onCustomerCreated(data);
      onClose();
    } catch (err: any) {
      setError(err.message || 'An error occurred while saving customer details.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-700/80 flex items-center justify-between bg-gradient-to-r from-indigo-50/50 to-white dark:from-slate-800 dark:to-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600 text-white rounded-xl shadow-md shadow-indigo-600/20">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
                {isEditing ? 'Edit Customer Details' : 'Create New Customer'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Register BIR Tax compliance info, payment terms, and AR billing data.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/50 rounded-xl text-xs font-semibold text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Code & Registered Name */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Customer Code <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                placeholder="e.g. CUST-1001"
                className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Registered Business / Legal Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.legalName}
                onChange={(e) => setFormData({ ...formData, legalName: e.target.value })}
                placeholder="e.g. San Miguel Corporation / Juan Dela Cruz"
                className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>

          {/* Trade Name & BIR TIN */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Trade Name (DBA)
              </label>
              <input
                type="text"
                value={formData.tradeName}
                onChange={(e) => setFormData({ ...formData, tradeName: e.target.value })}
                placeholder="e.g. SMC Food Division"
                className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                <span>BIR Tax ID Number (TIN)</span>
                <span className="text-[10px] text-slate-400 font-normal">9-12 digits</span>
              </label>
              <input
                type="text"
                value={formData.tin}
                onChange={(e) => setFormData({ ...formData, tin: e.target.value })}
                placeholder="000-123-456-000"
                className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>

          {/* VAT Status & Tax Classification */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                VAT Status
              </label>
              <select
                value={formData.vatStatus}
                onChange={(e) => setFormData({ ...formData, vatStatus: e.target.value })}
                className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option value="VATable">12% VATable</option>
                <option value="Zero-Rated">Zero-Rated (0% Export)</option>
                <option value="Exempt">VAT Exempt</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Entity Tax Classification
              </label>
              <select
                value={formData.taxClassification}
                onChange={(e) => {
                  const val = e.target.value;
                  let autoVat = 'VATable';
                  if (val === 'INDIVIDUAL' || val === 'GOVERNMENT') autoVat = 'Exempt';
                  else if (val === 'NON_RESIDENT') autoVat = 'Zero-Rated';
                  setFormData({ ...formData, taxClassification: val, vatStatus: autoVat });
                }}
                className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option value="CORPORATION">Corporation / Partnership</option>
                <option value="INDIVIDUAL">Sole Proprietorship / Individual</option>
                <option value="GOVERNMENT">Government Agency (NGAs / LGUs)</option>
                <option value="NON_RESIDENT">Non-Resident Foreign Entity</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Payment Terms
              </label>
              <select
                value={formData.paymentTerms}
                onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
                className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option value="COD">Cash on Delivery (COD)</option>
                <option value="NET_15">Net 15 Days</option>
                <option value="NET_30">Net 30 Days</option>
                <option value="NET_60">Net 60 Days</option>
              </select>
            </div>
          </div>

          {/* Contact Person & Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Contact Person
              </label>
              <input
                type="text"
                value={formData.contactPerson}
                onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                placeholder="e.g. Ms. Maria Santos (Purchasing)"
                className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Email / Phone Contact
              </label>
              <input
                type="text"
                value={formData.contactDetails}
                onChange={(e) => setFormData({ ...formData, contactDetails: e.target.value })}
                placeholder="billing@customer.ph / 0917-123-4567"
                className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>

          {/* Official Address */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Registered Billing & Tax Address
            </label>
            <textarea
              rows={2}
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder="Full registered address as stated on BIR Form 2303 Certificate of Registration..."
              className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
            />
          </div>

          {/* Credit Limit & Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Credit Limit (PHP)
              </label>
              <input
                type="number"
                min="0"
                step="1000"
                value={formData.creditLimit}
                onChange={(e) => setFormData({ ...formData, creditLimit: parseFloat(e.target.value) || 0 })}
                placeholder="0 (Unlimited)"
                className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Internal Billing Notes / Reminders
              </label>
              <input
                type="text"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Special billing instructions or BIR 2307 requirements..."
                className="w-full text-xs p-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-700/80">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md shadow-indigo-600/20 transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              {loading ? (
                <span>Saving Customer...</span>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" />
                  <span>{isEditing ? 'Update Customer' : 'Save & Select Customer'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
