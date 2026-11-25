import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBirTinSegments,
  formatBirTinDisplay,
  extractPhZipCode,
  formatForm2307PeriodBoxes,
  getQuarterDateBounds,
  computeNetOfVatBaseCentavos,
  resolveAtcCode,
  buildForm2307Certificate,
} from './form2307Utils';

describe('BIR Form 2307 Pure Utilities', () => {
  it('formats 9-digit, 12-digit, and 14-digit PH TINs into official 3-3-3-5 boxes', () => {
    assert.deepEqual(formatBirTinSegments('123-456-789-000'), ['123', '456', '789', '00000']);
    assert.deepEqual(formatBirTinSegments('700-906-710-001'), ['700', '906', '710', '00001']);
    assert.deepEqual(formatBirTinSegments('123456789', '00012'), ['123', '456', '789', '00012']);
    assert.deepEqual(formatBirTinSegments('987-654-321-00005'), ['987', '654', '321', '00005']);
    assert.deepEqual(formatBirTinSegments(null), ['', '', '', '']);
    assert.equal(formatBirTinDisplay('700-906-710-000'), '700-906-710-00000');
  });

  it('extracts 4-digit Philippine ZIP codes from registered addresses', () => {
    assert.equal(extractPhZipCode('12F Ayala Tower One, Makati City 1226, Metro Manila'), '1226');
    assert.equal(extractPhZipCode('BGC, Taguig City, Philippines 1634'), '1634');
    assert.equal(extractPhZipCode('Cebu IT Park, Cebu City'), '');
  });

  it('computes exact quarter date bounds and BIR 20th-day statutory issuance deadlines', () => {
    const q1 = getQuarterDateBounds(2026, 'Q1');
    assert.equal(q1.periodFrom, '2026-01-01');
    assert.equal(q1.periodTo, '2026-03-31');
    assert.equal(q1.deadlineDate, '2026-04-20');
    assert.deepEqual(q1.monthLabels, ['January', 'February', 'March']);

    const q4 = getQuarterDateBounds(2026, 'Q4');
    assert.equal(q4.periodFrom, '2026-10-01');
    assert.equal(q4.periodTo, '2026-12-31');
    assert.equal(q4.deadlineDate, '2027-01-20');
    assert.deepEqual(q4.monthLabels, ['October', 'November', 'December']);

    assert.deepEqual(formatForm2307PeriodBoxes('2026-10-01'), { mm: '10', dd: '01', yyyy: '2026' });
  });

  it('computes net-of-VAT EWT income payment base accurately under BIR RR 2-98', () => {
    // ₱5,600.00 gross with explicit ₱600.00 VAT => ₱5,000.00 net base
    const explicit = computeNetOfVatBaseCentavos(560000, 60000, true);
    assert.equal(explicit.netOfVatCentavos, 500000);
    assert.equal(explicit.vatCentavos, 60000);

    // ₱11,200.00 gross VAT-registered without line split => ₱10,000.00 net base
    const implicit = computeNetOfVatBaseCentavos(1120000, null, true);
    assert.equal(implicit.netOfVatCentavos, 1000000);
    assert.equal(implicit.vatCentavos, 120000);

    // Non-VAT vendor => full gross is EWT base
    const nonVat = computeNetOfVatBaseCentavos(500000, null, false);
    assert.equal(nonVat.netOfVatCentavos, 500000);
    assert.equal(nonVat.vatCentavos, 0);
  });

  it('resolves BIR ATC codes from line codes, vendor withholding applicability, and effective DV rates', () => {
    const fromLine = resolveAtcCode({ lineTaxCodes: ['VAT12', 'WC100'], vendorTaxClassification: 'CORPORATION' });
    assert.equal(fromLine.code, 'WC100');
    assert.equal(fromLine.ratePercent, 5);

    const fromEffectiveRate = resolveAtcCode({
      vendorTaxClassification: 'INDIVIDUAL',
      effectiveRatePercent: 2.0,
    });
    assert.equal(fromEffectiveRate.code, 'WI157');
    assert.equal(fromEffectiveRate.ratePercent, 2);

    const businessTax = resolveAtcCode({ overrideAtc: 'WV010' });
    assert.equal(businessTax.section, 'BUSINESS_TAX');
    assert.equal(businessTax.ratePercent, 5);
  });

  it('builds a complete multi-ATC Form 2307 certificate with monthly breakdown, net-of-VAT base, and DV reconciliation', () => {
    const cert = buildForm2307Certificate({
      payor: {
        tin: '234-567-890-000',
        legalName: 'Deskguard Solutions Inc.',
        address: '8F High Street South, BGC, Taguig City 1634',
        rdoCode: '044',
      },
      payee: {
        id: 'vend-0500',
        code: 'VEND-0500',
        legalName: 'Archipelago Security Supplier 0500 Inc.',
        tin: '700-906-710-000',
        address: '123 Ortigas Ave, Pasig City 1605',
        taxClassification: 'CORPORATION',
        vatStatus: 'VAT',
        withholdingApplicability: 'WC157',
      },
      year: 2026,
      quarter: 'Q4',
      dateIssued: '2026-11-19',
      bills: [
        {
          id: 'bill-1',
          billNumber: 'BILL-2026-08000',
          billDate: '2026-10-25',
          totalAmountCentavos: 560000, // ₱5,600.00 gross (₱5,000 net + ₱600 VAT)
          status: 'PARTIAL',
          lines: [{ amountCentavos: 500000, taxCode: 'WC157', taxType: 'EWT', taxRatePercent: 2 }],
        },
        {
          id: 'bill-2',
          billNumber: 'BILL-2026-08050',
          billDate: '2026-11-10',
          totalAmountCentavos: 1120000, // ₱11,200.00 gross (₱10,000 net + ₱1,200 VAT)
          status: 'POSTED',
          lines: [{ amountCentavos: 1000000, taxCode: 'WC100', taxType: 'EWT', taxRatePercent: 5 }],
        },
      ],
      payments: [
        {
          id: 'pay-1',
          paymentNumber: 'DV-2026-13980',
          paymentDate: '2026-11-18',
          amountCentavos: 273772,
          withholdingTaxAmountCentavos: 10000, // ₱100.00 EWT recorded
          paymentMethod: 'BANK_TRANSFER',
          reference: 'CHK-8821',
        },
      ],
      signatory: {
        name: 'Maria Clara Santos',
        designation: 'Chief Finance Officer',
      },
    });

    assert.equal(cert.certificateControlNo, '2307-VEND-0500-2026-Q4');
    assert.equal(cert.periodFrom, '2026-10-01');
    assert.equal(cert.periodTo, '2026-12-31');
    assert.equal(cert.statutoryDeadline, '2027-01-20');
    assert.deepEqual(cert.payor.tinSegments, ['234', '567', '890', '00000']);
    assert.equal(cert.payor.zipCode, '1634');
    assert.deepEqual(cert.payee.tinSegments, ['700', '906', '710', '00000']);
    assert.equal(cert.payee.zipCode, '1605');
    assert.equal(cert.ewtSchedule.length, 2);

    const wc157 = cert.ewtSchedule.find((r) => r.atcCode === 'WC157')!;
    assert.equal(wc157.month1GrossPhp, 5000);
    assert.equal(wc157.month2GrossPhp, 0);
    assert.equal(wc157.totalTaxWithheldPhp, 100);

    const wc100 = cert.ewtSchedule.find((r) => r.atcCode === 'WC100')!;
    assert.equal(wc100.month2GrossPhp, 10000);
    assert.equal(wc100.totalTaxWithheldPhp, 500);

    assert.equal(cert.totals.grossPaymentPhp, 15000);
    assert.equal(cert.totals.taxWithheldPhp, 600);
    assert.equal(cert.totals.vatExcludedPhp, 1800);
    assert.equal(cert.sourceBills.length, 2);
    assert.equal(cert.sourcePayments.length, 1);
  });

  it('flags missing payee TIN and missing ATC warnings cleanly', () => {
    const cert = buildForm2307Certificate({
      payor: { tin: '111-222-333-000', legalName: 'Payor Corp' },
      payee: { id: 'v2', code: 'V-02', legalName: 'Unregistered Vendor', tin: null, vatStatus: 'NON_VAT' },
      year: 2026,
      quarter: 'Q1',
      bills: [
        {
          id: 'b1',
          billNumber: 'BILL-1',
          billDate: '2026-02-15',
          totalAmountCentavos: 200000,
          status: 'POSTED',
          lines: [{ amountCentavos: 200000 }],
        },
      ],
      payments: [],
      signatory: { name: 'Officer', designation: 'Owner' },
    });

    assert.equal(cert.atcStatus, 'MISSING_ATC');
    assert.ok(cert.warnings.some((w) => w.code === 'MISSING_PAYEE_TIN'));
    assert.ok(cert.warnings.some((w) => w.code === 'MISSING_ATC'));
  });
});
