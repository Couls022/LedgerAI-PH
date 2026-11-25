import React from 'react';
import {
  formatForm2307PeriodBoxes,
  type Form2307Certificate,
  type Form2307ScheduleRow,
} from '../../../shared/form2307Utils';

interface BirForm2307OfficialSheetProps {
  certificate: Form2307Certificate;
  signatoryOverride?: {
    name?: string;
    designation?: string;
    tin?: string;
  };
  payorZipOverride?: string;
  payeeZipOverride?: string;
  payeeForeignAddressOverride?: string;
}

const formatAmountCell = (amount: number) => {
  if (!amount || Math.abs(amount) < 0.005) return '0.00';
  return new Intl.NumberFormat('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

const DigitBoxes: React.FC<{ value: string; length: number; className?: string }> = ({
  value,
  length,
  className = '',
}) => {
  const chars = value.slice(0, length).padEnd(length, ' ').split('');
  return (
    <span className={`inline-flex items-center ${className}`}>
      {chars.map((ch, idx) => (
        <span
          key={idx}
          className="inline-flex items-center justify-center w-5 h-6 border border-slate-900 bg-white text-slate-950 font-mono text-[11px] font-bold leading-none -ml-px first:ml-0"
        >
          {ch.trim()}
        </span>
      ))}
    </span>
  );
};

const TinBoxes: React.FC<{ segments: [string, string, string, string] }> = ({ segments }) => {
  const [s1, s2, s3, s4] = segments;
  return (
    <div className="inline-flex items-center gap-1 flex-wrap">
      <DigitBoxes value={s1 || ''} length={3} />
      <span className="font-mono font-bold text-slate-900 text-xs">-</span>
      <DigitBoxes value={s2 || ''} length={3} />
      <span className="font-mono font-bold text-slate-900 text-xs">-</span>
      <DigitBoxes value={s3 || ''} length={3} />
      <span className="font-mono font-bold text-slate-900 text-xs">-</span>
      <DigitBoxes value={s4 || ''} length={5} />
    </div>
  );
};

const DateBoxes: React.FC<{ isoDate: string }> = ({ isoDate }) => {
  const { mm, dd, yyyy } = formatForm2307PeriodBoxes(isoDate);
  return (
    <div className="inline-flex items-center gap-1">
      <div className="flex flex-col items-center">
        <DigitBoxes value={mm} length={2} />
        <span className="text-[8px] font-semibold uppercase text-slate-600 mt-0.5">MM</span>
      </div>
      <span className="font-mono font-bold text-slate-800 text-xs -mt-2">/</span>
      <div className="flex flex-col items-center">
        <DigitBoxes value={dd} length={2} />
        <span className="text-[8px] font-semibold uppercase text-slate-600 mt-0.5">DD</span>
      </div>
      <span className="font-mono font-bold text-slate-800 text-xs -mt-2">/</span>
      <div className="flex flex-col items-center">
        <DigitBoxes value={yyyy} length={4} />
        <span className="text-[8px] font-semibold uppercase text-slate-600 mt-0.5">YYYY</span>
      </div>
    </div>
  );
};

export const BirForm2307OfficialSheet: React.FC<BirForm2307OfficialSheetProps> = ({
  certificate,
  signatoryOverride,
  payorZipOverride,
  payeeZipOverride,
  payeeForeignAddressOverride,
}) => {
  const ewtRows: Form2307ScheduleRow[] =
    certificate.ewtSchedule && certificate.ewtSchedule.length > 0
      ? certificate.ewtSchedule
      : certificate.schedule.filter((r) => r.section !== 'BUSINESS_TAX');

  const businessTaxRows: Form2307ScheduleRow[] =
    certificate.businessTaxSchedule && certificate.businessTaxSchedule.length > 0
      ? certificate.businessTaxSchedule
      : certificate.schedule.filter((r) => r.section === 'BUSINESS_TAX');

  const minEwtDisplayRows = Math.max(4, ewtRows.length);
  const blankEwtCount = Math.max(0, minEwtDisplayRows - ewtRows.length);

  const minBizDisplayRows = Math.max(2, businessTaxRows.length);
  const blankBizCount = Math.max(0, minBizDisplayRows - businessTaxRows.length);

  const ewtSubM1 = ewtRows.reduce((s, r) => s + r.month1GrossPhp, 0);
  const ewtSubM2 = ewtRows.reduce((s, r) => s + r.month2GrossPhp, 0);
  const ewtSubM3 = ewtRows.reduce((s, r) => s + r.month3GrossPhp, 0);
  const ewtSubTotal = ewtRows.reduce((s, r) => s + r.totalGrossPhp, 0);
  const ewtSubTax = ewtRows.reduce((s, r) => s + r.totalTaxWithheldPhp, 0);

  const bizSubM1 = businessTaxRows.reduce((s, r) => s + r.month1GrossPhp, 0);
  const bizSubM2 = businessTaxRows.reduce((s, r) => s + r.month2GrossPhp, 0);
  const bizSubM3 = businessTaxRows.reduce((s, r) => s + r.month3GrossPhp, 0);
  const bizSubTotal = businessTaxRows.reduce((s, r) => s + r.totalGrossPhp, 0);
  const bizSubTax = businessTaxRows.reduce((s, r) => s + r.totalTaxWithheldPhp, 0);

  const effectiveSignatoryName = signatoryOverride?.name?.trim() || certificate.signatory.name || 'Authorized Representative';
  const effectiveSignatoryTitle = signatoryOverride?.designation?.trim() || certificate.signatory.designation || 'Authorized Officer';
  const effectiveSignatoryTin = signatoryOverride?.tin?.trim() || certificate.signatory.tin || certificate.payor.tin || '';

  const effectivePayorZip = (payorZipOverride ?? certificate.payor.zipCode ?? '').replace(/\D/g, '').slice(0, 4);
  const effectivePayeeZip = (payeeZipOverride ?? certificate.payee.zipCode ?? '').replace(/\D/g, '').slice(0, 4);
  const effectiveForeignAddr = payeeForeignAddressOverride ?? certificate.payee.foreignAddress ?? '';

  const [m1Label, m2Label, m3Label] = certificate.monthLabels || ['1st Month', '2nd Month', '3rd Month'];

  return (
    <article
      className="bir-2307-sheet bg-white text-slate-950 border-2 border-slate-950 w-full max-w-[820px] mx-auto select-text"
      aria-label={`BIR Form 2307 Certificate ${certificate.certificateControlNo}`}
    >
      {/* TOP BAR: BIR FORM NUMBER & OFFICIAL HEADER */}
      <div className="grid grid-cols-12 border-b-2 border-slate-950">
        <div className="col-span-3 p-2.5 border-r border-slate-950 flex flex-col justify-between bg-slate-50">
          <div className="text-[9px] font-bold uppercase tracking-tight leading-tight text-slate-800">
            Republic of the Philippines
            <br />
            Department of Finance
            <br />
            Bureau of Internal Revenue
          </div>
          <div className="mt-1.5 pt-1 border-t border-slate-400">
            <div className="text-[10px] font-black uppercase tracking-wide text-slate-950">BIR Form No.</div>
            <div className="text-2xl font-black font-mono leading-none tracking-tight text-slate-950">2307</div>
            <div className="text-[8.5px] font-semibold text-slate-700 mt-0.5">January 2018 (ENCS)</div>
          </div>
        </div>

        <div className="col-span-6 p-2.5 border-r border-slate-950 flex flex-col items-center justify-center text-center">
          <h2 className="text-base font-black uppercase tracking-tight leading-snug text-slate-950">
            Certificate of Creditable Tax
            <br />
            Withheld at Source
          </h2>
          <p className="text-[9px] text-slate-700 mt-1 leading-tight">
            Fill in all applicable spaces. Mark all appropriate boxes with an &ldquo;X&rdquo;.
          </p>
        </div>

        <div className="col-span-3 p-2.5 flex flex-col justify-between text-[9px] bg-slate-50">
          <div>
            <div className="font-bold uppercase text-slate-600">Control No.</div>
            <div className="font-mono font-bold text-[10.5px] text-slate-950 break-all mt-0.5">
              {certificate.certificateControlNo}
            </div>
          </div>
          <div className="pt-1.5 mt-1.5 border-t border-slate-300 space-y-0.5">
            <div className="flex justify-between">
              <span className="text-slate-600 font-semibold">Period:</span>
              <span className="font-mono font-bold text-slate-950">
                {certificate.quarter} {certificate.year}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 font-semibold">Status:</span>
              <span className="font-mono font-bold text-slate-950">
                {certificate.issuanceStatus}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* PERIOD COVERED ROW (ITEMS 1 & 2) */}
      <div className="grid grid-cols-12 border-b-2 border-slate-950 bg-slate-100/80">
        <div className="col-span-6 px-3 py-2 border-r border-slate-950 flex items-center justify-between gap-2">
          <div className="text-[10px] font-bold text-slate-900 leading-tight">
            <span className="font-mono mr-1">1</span> For the Period
            <div className="text-[9px] font-semibold uppercase text-slate-700">From (MM/DD/YYYY)</div>
          </div>
          <DateBoxes isoDate={certificate.periodFrom} />
        </div>
        <div className="col-span-6 px-3 py-2 flex items-center justify-between gap-2">
          <div className="text-[10px] font-bold text-slate-900 leading-tight">
            <span className="font-mono mr-1">2</span> To
            <div className="text-[9px] font-semibold uppercase text-slate-700">(MM/DD/YYYY)</div>
          </div>
          <DateBoxes isoDate={certificate.periodTo} />
        </div>
      </div>

      {/* PART I — PAYEE INFORMATION */}
      <div className="bg-slate-900 text-white px-3 py-1 text-[10px] font-bold uppercase tracking-wider flex items-center justify-between">
        <span>Part I — Payee Information</span>
        <span className="font-mono text-[9px] font-normal text-slate-300">
          Vendor Code: {certificate.payee.vendorCode}
        </span>
      </div>

      <div className="border-b-2 border-slate-950 divide-y divide-slate-900">
        {/* Item 3: Payee TIN */}
        <div className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 bg-white">
          <div className="text-[10px] font-bold text-slate-900">
            <span className="font-mono mr-1">3</span> Taxpayer Identification Number (TIN)
          </div>
          <TinBoxes segments={certificate.payee.tinSegments} />
        </div>

        {/* Item 4: Payee Name */}
        <div className="px-3 py-2 bg-white">
          <div className="text-[9.5px] font-bold text-slate-800 uppercase">
            <span className="font-mono mr-1">4</span> Payee&rsquo;s Name (Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual)
          </div>
          <div className="mt-1 px-2 py-1 border border-slate-800 bg-slate-50 font-mono text-xs font-bold uppercase text-slate-950 min-h-[26px]">
            {certificate.payee.legalName}
          </div>
        </div>

        {/* Item 5 & 5A: Registered Address & ZIP Code */}
        <div className="grid grid-cols-12 bg-white">
          <div className="col-span-9 px-3 py-2 border-r border-slate-900">
            <div className="text-[9.5px] font-bold text-slate-800 uppercase">
              <span className="font-mono mr-1">5</span> Registered Address
            </div>
            <div className="mt-1 px-2 py-1 border border-slate-800 bg-slate-50 text-[11px] font-medium text-slate-950 min-h-[26px]">
              {certificate.payee.address || '—'}
            </div>
          </div>
          <div className="col-span-3 px-3 py-2 flex flex-col justify-between">
            <div className="text-[9.5px] font-bold text-slate-800 uppercase">
              <span className="font-mono mr-1">5A</span> ZIP Code
            </div>
            <div className="mt-1">
              <DigitBoxes value={effectivePayeeZip} length={4} />
            </div>
          </div>
        </div>

        {/* Item 6: Foreign Address */}
        <div className="px-3 py-1.5 bg-white">
          <div className="text-[9px] font-bold text-slate-700 uppercase">
            <span className="font-mono mr-1">6</span> Foreign Address, if applicable
          </div>
          <div className="mt-0.5 px-2 py-0.5 border border-slate-400 text-[10.5px] text-slate-800 min-h-[20px]">
            {effectiveForeignAddr || ''}
          </div>
        </div>
      </div>

      {/* PART II — PAYOR INFORMATION */}
      <div className="bg-slate-900 text-white px-3 py-1 text-[10px] font-bold uppercase tracking-wider flex items-center justify-between">
        <span>Part II — Payor Information (Withholding Agent)</span>
        {certificate.payor.rdoCode && (
          <span className="font-mono text-[9px] font-normal text-slate-300">
            RDO Code: {certificate.payor.rdoCode}
          </span>
        )}
      </div>

      <div className="border-b-2 border-slate-950 divide-y divide-slate-900">
        {/* Item 7: Payor TIN */}
        <div className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 bg-white">
          <div className="text-[10px] font-bold text-slate-900">
            <span className="font-mono mr-1">7</span> Taxpayer Identification Number (TIN)
          </div>
          <TinBoxes segments={certificate.payor.tinSegments} />
        </div>

        {/* Item 8: Payor Name */}
        <div className="px-3 py-2 bg-white">
          <div className="text-[9.5px] font-bold text-slate-800 uppercase">
            <span className="font-mono mr-1">8</span> Payor&rsquo;s Name (Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual)
          </div>
          <div className="mt-1 px-2 py-1 border border-slate-800 bg-slate-50 font-mono text-xs font-bold uppercase text-slate-950 min-h-[26px]">
            {certificate.payor.legalName || 'Registered Withholding Agent'}
          </div>
        </div>

        {/* Item 9 & 9A: Registered Address & ZIP Code */}
        <div className="grid grid-cols-12 bg-white">
          <div className="col-span-9 px-3 py-2 border-r border-slate-900">
            <div className="text-[9.5px] font-bold text-slate-800 uppercase">
              <span className="font-mono mr-1">9</span> Registered Address
            </div>
            <div className="mt-1 px-2 py-1 border border-slate-800 bg-slate-50 text-[11px] font-medium text-slate-950 min-h-[26px]">
              {certificate.payor.address || '—'}
            </div>
          </div>
          <div className="col-span-3 px-3 py-2 flex flex-col justify-between">
            <div className="text-[9.5px] font-bold text-slate-800 uppercase">
              <span className="font-mono mr-1">9A</span> ZIP Code
            </div>
            <div className="mt-1">
              <DigitBoxes value={effectivePayorZip} length={4} />
            </div>
          </div>
        </div>
      </div>

      {/* PART III — DETAILS OF MONTHLY INCOME PAYMENTS AND TAXES WITHHELD */}
      <div className="bg-slate-900 text-white px-3 py-1 text-[10px] font-bold uppercase tracking-wider flex items-center justify-between">
        <span>Part III — Details of Monthly Income Payments and Taxes Withheld</span>
        <span className="text-[9px] font-normal text-slate-300">Amounts in Philippine Peso (₱ · Net of 12% VAT)</span>
      </div>

      <div className="border-b-2 border-slate-950 overflow-x-auto">
        <table className="w-full border-collapse text-[10px] text-slate-950">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-950 text-center font-bold uppercase leading-tight">
              <th rowSpan={2} className="border-r border-slate-900 px-2 py-1.5 text-left w-[31%]">
                Income Payments Subject to Expanded Withholding Tax
              </th>
              <th rowSpan={2} className="border-r border-slate-900 px-1.5 py-1.5 w-[9%]">
                ATC
              </th>
              <th colSpan={4} className="border-r border-slate-900 border-b border-slate-900 px-2 py-1">
                Amount of Income Payments (₱)
              </th>
              <th rowSpan={2} className="px-2 py-1.5 w-[14%]">
                Tax Withheld for the Quarter (₱)
              </th>
            </tr>
            <tr className="bg-slate-100 border-b border-slate-950 text-center font-bold text-[9px] leading-tight">
              <th className="border-r border-slate-900 px-1.5 py-1 w-[11.5%]">
                1st Month
                <div className="font-normal text-[8px] text-slate-600">{m1Label}</div>
              </th>
              <th className="border-r border-slate-900 px-1.5 py-1 w-[11.5%]">
                2nd Month
                <div className="font-normal text-[8px] text-slate-600">{m2Label}</div>
              </th>
              <th className="border-r border-slate-900 px-1.5 py-1 w-[11.5%]">
                3rd Month
                <div className="font-normal text-[8px] text-slate-600">{m3Label}</div>
              </th>
              <th className="border-r border-slate-900 px-1.5 py-1 w-[11.5%]">Total</th>
            </tr>
          </thead>

          <tbody>
            {/* Section A: EWT rows */}
            {ewtRows.map((row, idx) => (
              <tr key={`ewt-${idx}`} className="border-b border-slate-400">
                <td className="border-r border-slate-900 px-2 py-1.5 text-[9.5px] leading-snug">
                  {row.natureOfPayment}
                  {row.taxRatePercent > 0 && (
                    <span className="ml-1 font-mono text-[8.5px] text-slate-600">
                      ({row.taxRatePercent}%)
                    </span>
                  )}
                </td>
                <td className="border-r border-slate-900 px-1.5 py-1.5 text-center font-mono font-bold text-[10px]">
                  {row.atcCode === 'UNASSIGNED_ATC' ? '—' : row.atcCode}
                </td>
                <td className="border-r border-slate-900 px-1.5 py-1.5 text-right font-mono tabular-nums">
                  {formatAmountCell(row.month1GrossPhp)}
                </td>
                <td className="border-r border-slate-900 px-1.5 py-1.5 text-right font-mono tabular-nums">
                  {formatAmountCell(row.month2GrossPhp)}
                </td>
                <td className="border-r border-slate-900 px-1.5 py-1.5 text-right font-mono tabular-nums">
                  {formatAmountCell(row.month3GrossPhp)}
                </td>
                <td className="border-r border-slate-900 px-1.5 py-1.5 text-right font-mono font-semibold tabular-nums">
                  {formatAmountCell(row.totalGrossPhp)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono font-bold tabular-nums">
                  {formatAmountCell(row.totalTaxWithheldPhp)}
                </td>
              </tr>
            ))}

            {Array.from({ length: blankEwtCount }).map((_, idx) => (
              <tr key={`ewt-blank-${idx}`} className="border-b border-slate-300 h-6">
                <td className="border-r border-slate-900 px-2 py-1">&nbsp;</td>
                <td className="border-r border-slate-900 px-1.5 py-1">&nbsp;</td>
                <td className="border-r border-slate-900 px-1.5 py-1">&nbsp;</td>
                <td className="border-r border-slate-900 px-1.5 py-1">&nbsp;</td>
                <td className="border-r border-slate-900 px-1.5 py-1">&nbsp;</td>
                <td className="border-r border-slate-900 px-1.5 py-1">&nbsp;</td>
                <td className="px-2 py-1">&nbsp;</td>
              </tr>
            ))}

            {/* Section A Total */}
            <tr className="bg-slate-100 border-b-2 border-slate-950 font-bold">
              <td colSpan={2} className="border-r border-slate-900 px-2 py-1.5 uppercase text-[9.5px]">
                Total (Expanded Withholding Tax)
              </td>
              <td className="border-r border-slate-900 px-1.5 py-1.5 text-right font-mono tabular-nums">
                {formatAmountCell(ewtSubM1)}
              </td>
              <td className="border-r border-slate-900 px-1.5 py-1.5 text-right font-mono tabular-nums">
                {formatAmountCell(ewtSubM2)}
              </td>
              <td className="border-r border-slate-900 px-1.5 py-1.5 text-right font-mono tabular-nums">
                {formatAmountCell(ewtSubM3)}
              </td>
              <td className="border-r border-slate-900 px-1.5 py-1.5 text-right font-mono tabular-nums">
                {formatAmountCell(ewtSubTotal)}
              </td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                {formatAmountCell(ewtSubTax)}
              </td>
            </tr>

            {/* Section B Header: Business Tax Withholding */}
            <tr className="bg-slate-200/80 border-b border-slate-900 font-bold uppercase text-[9px]">
              <td colSpan={7} className="px-2 py-1 text-slate-900">
                Money Payments Subject to Withholding of Business Tax (Government &amp; Private)
              </td>
            </tr>

            {businessTaxRows.map((row, idx) => (
              <tr key={`biz-${idx}`} className="border-b border-slate-400">
                <td className="border-r border-slate-900 px-2 py-1.5 text-[9.5px] leading-snug">
                  {row.natureOfPayment} ({row.taxRatePercent}%)
                </td>
                <td className="border-r border-slate-900 px-1.5 py-1.5 text-center font-mono font-bold">
                  {row.atcCode}
                </td>
                <td className="border-r border-slate-900 px-1.5 py-1.5 text-right font-mono tabular-nums">
                  {formatAmountCell(row.month1GrossPhp)}
                </td>
                <td className="border-r border-slate-900 px-1.5 py-1.5 text-right font-mono tabular-nums">
                  {formatAmountCell(row.month2GrossPhp)}
                </td>
                <td className="border-r border-slate-900 px-1.5 py-1.5 text-right font-mono tabular-nums">
                  {formatAmountCell(row.month3GrossPhp)}
                </td>
                <td className="border-r border-slate-900 px-1.5 py-1.5 text-right font-mono font-semibold tabular-nums">
                  {formatAmountCell(row.totalGrossPhp)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono font-bold tabular-nums">
                  {formatAmountCell(row.totalTaxWithheldPhp)}
                </td>
              </tr>
            ))}

            {Array.from({ length: blankBizCount }).map((_, idx) => (
              <tr key={`biz-blank-${idx}`} className="border-b border-slate-300 h-5">
                <td className="border-r border-slate-900 px-2 py-1">&nbsp;</td>
                <td className="border-r border-slate-900 px-1.5 py-1">&nbsp;</td>
                <td className="border-r border-slate-900 px-1.5 py-1">&nbsp;</td>
                <td className="border-r border-slate-900 px-1.5 py-1">&nbsp;</td>
                <td className="border-r border-slate-900 px-1.5 py-1">&nbsp;</td>
                <td className="border-r border-slate-900 px-1.5 py-1">&nbsp;</td>
                <td className="px-2 py-1">&nbsp;</td>
              </tr>
            ))}

            {/* GRAND TOTAL */}
            <tr className="bg-slate-100 border-t border-slate-950 font-black text-[10.5px]">
              <td colSpan={2} className="border-r border-slate-900 px-2 py-2 uppercase">
                Grand Total
              </td>
              <td className="border-r border-slate-900 px-1.5 py-2 text-right font-mono tabular-nums">
                {formatAmountCell(ewtSubM1 + bizSubM1)}
              </td>
              <td className="border-r border-slate-900 px-1.5 py-2 text-right font-mono tabular-nums">
                {formatAmountCell(ewtSubM2 + bizSubM2)}
              </td>
              <td className="border-r border-slate-900 px-1.5 py-2 text-right font-mono tabular-nums">
                {formatAmountCell(ewtSubM3 + bizSubM3)}
              </td>
              <td className="border-r border-slate-900 px-1.5 py-2 text-right font-mono tabular-nums">
                ₱{formatAmountCell(ewtSubTotal + bizSubTotal)}
              </td>
              <td className="px-2 py-2 text-right font-mono tabular-nums bg-slate-200">
                ₱{formatAmountCell(ewtSubTax + bizSubTax)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* PART IV — PERJURY DECLARATION & SIGNATORY BLOCKS */}
      <div className="p-3 bg-white space-y-3">
        <p className="text-[9px] leading-relaxed text-slate-800 text-justify">
          We declare under the penalties of perjury that this certificate has been made in good faith, verified by us, and to the best of our knowledge and belief, is true and correct, pursuant to the provisions of the National Internal Revenue Code, as amended, and the regulations issued under authority thereof. Further, we give our consent to the processing of our information as contemplated under the Data Privacy Act of 2012 (R.A. No. 10173) for legitimate and lawful purposes.
        </p>

        <div className="grid grid-cols-12 gap-4 pt-2">
          {/* Payor Authorized Signatory */}
          <div className="col-span-7 border border-slate-800 p-2.5">
            <div className="text-[8.5px] font-bold uppercase text-slate-600 mb-5">
              Payor / Payor&rsquo;s Authorized Representative / Accredited Tax Agent
            </div>
            <div className="border-b border-slate-900 pb-0.5 text-center font-bold text-xs uppercase text-slate-950">
              {effectiveSignatoryName}
            </div>
            <div className="text-[8.5px] text-center text-slate-600 mt-0.5">
              Signature over Printed Name of Payor / Authorized Representative
            </div>

            <div className="grid grid-cols-2 gap-2 mt-2.5 pt-2 border-t border-slate-300 text-[9px]">
              <div>
                <span className="font-bold text-slate-600 uppercase block text-[8px]">Title / Designation</span>
                <span className="font-semibold text-slate-950">{effectiveSignatoryTitle}</span>
              </div>
              <div>
                <span className="font-bold text-slate-600 uppercase block text-[8px]">TIN / Date Issued</span>
                <span className="font-mono font-semibold text-slate-950">
                  {effectiveSignatoryTin || 'N/A'} · {certificate.dateIssued}
                </span>
              </div>
            </div>
          </div>

          {/* Payee Conforme Block */}
          <div className="col-span-5 border border-slate-800 p-2.5 flex flex-col justify-between">
            <div className="text-[8.5px] font-bold uppercase text-slate-600 mb-5">
              Conforme (Payee / Authorized Representative)
            </div>
            <div>
              <div className="border-b border-slate-900 pb-0.5 text-center font-semibold text-[10px] uppercase text-slate-900 min-h-[18px]">
                &nbsp;
              </div>
              <div className="text-[8.5px] text-center text-slate-600 mt-0.5">
                Signature over Printed Name of Payee
              </div>
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-300 flex justify-between text-[8.5px] text-slate-700">
              <span>Date Received: _______________</span>
            </div>
          </div>
        </div>

        {/* LEDGER AUDIT METADATA FOOTER */}
        <div className="pt-2 border-t border-slate-300 flex flex-wrap items-center justify-between gap-2 text-[8.5px] text-slate-600 font-mono">
          <span>
            LEDGER SOURCE: {certificate.apRecordsCount.billsCount} Posted Bill(s) · {certificate.apRecordsCount.paymentsCount} Disbursement Voucher(s) · VAT Excluded: ₱{formatAmountCell(certificate.totals.vatExcludedPhp)}
          </span>
          <span>
            BIR RR 2-98 Issuance Deadline: {certificate.statutoryDeadline}
          </span>
        </div>
      </div>
    </article>
  );
};

export default BirForm2307OfficialSheet;
