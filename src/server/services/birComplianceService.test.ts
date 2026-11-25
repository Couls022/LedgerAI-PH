import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BirComplianceService,
  BIR_RR_11_2018_ATC_RATES,
  resolveBirAtcRate,
  isCompanyVatRegistered,
  classifyVatTransaction,
} from './birComplianceService';

describe('BIR Compliance & Philippine Tax Rules (Pure Unit Verification)', () => {
  it('validates 9-digit, 12-digit, and 14-digit (BIR RR 7-2012 / EOPT) Philippine TINs', () => {
    assert.equal(BirComplianceService.validateTin('004-219-880'), true);
    assert.equal(BirComplianceService.validateTin('004-219-880-000'), true);
    assert.equal(BirComplianceService.validateTin('004-219-880-00000'), true);
    assert.equal(BirComplianceService.validateTin('00948271100000'), true);
    assert.equal(BirComplianceService.validateTin('000-000-000-00000'), false);
    assert.equal(BirComplianceService.validateTin('12345'), false);
    assert.equal(BirComplianceService.validateTin(null), false);
    assert.equal(BirComplianceService.validateTin(''), false);
  });

  it('enforces BIR RR 11-2018 official EWT ATC rates (WC158=1% goods, WC160=2% services, WC100=5% rent)', () => {
    assert.equal(BIR_RR_11_2018_ATC_RATES.WC158, 0.01);
    assert.equal(BIR_RR_11_2018_ATC_RATES.WI158, 0.01);
    assert.equal(BIR_RR_11_2018_ATC_RATES.WC160, 0.02);
    assert.equal(BIR_RR_11_2018_ATC_RATES.WI160, 0.02);
    assert.equal(BIR_RR_11_2018_ATC_RATES.WC100, 0.05);
    assert.equal(BIR_RR_11_2018_ATC_RATES.WC120, 0.02);
    assert.equal(resolveBirAtcRate('wc158'), 0.01);
    assert.equal(resolveBirAtcRate('WC160'), 0.02);
    assert.equal(resolveBirAtcRate('UNASSIGNED_ATC'), 0);
  });

  it('correctly distinguishes VAT-registered vs Non-VAT (NIRC Sec. 116 / 8% Option) companies', () => {
    assert.equal(isCompanyVatRegistered('VAT', 'CORPORATION'), true);
    assert.equal(isCompanyVatRegistered('VAT_REGISTERED', 'CORPORATION'), true);
    assert.equal(isCompanyVatRegistered('NON_VAT', 'SOLE_PROPRIETOR'), false);
    assert.equal(isCompanyVatRegistered('PERCENTAGE_TAX', 'SOLE_PROPRIETOR'), false);
    assert.equal(isCompanyVatRegistered('VAT_EXEMPT', 'CORPORATION'), false);
    assert.equal(isCompanyVatRegistered('VAT', 'NON_VAT_PERCENTAGE'), false);
  });

  it('prevents Non-VAT companies from illegally claiming 12% Input VAT or charging 12% Output VAT', () => {
    const nonVatPurchase = classifyVatTransaction({
      side: 'PURCHASE',
      grossAmount: 11200000, // P112,000.00
      companyIsVatRegistered: false,
      partnerVatStatus: 'VAT_REGISTERED',
    });
    assert.equal(nonVatPurchase.vat, 0);
    assert.equal(nonVatPurchase.taxable, 0);
    assert.equal(nonVatPurchase.exempt, 11200000);

    const nonVatSale = classifyVatTransaction({
      side: 'SALE',
      grossAmount: 10000000, // P100,000.00
      companyIsVatRegistered: false,
      partnerVatStatus: 'VAT_REGISTERED',
    });
    assert.equal(nonVatSale.vat, 0);
    assert.equal(nonVatSale.taxable, 0);
    assert.equal(nonVatSale.exempt, 10000000);
  });

  it('computes 12% Output VAT on VAT-registered seller sales even to Non-VAT buyers, and restricts Input VAT to VAT suppliers', () => {
    const vatSaleToNonVatBuyer = classifyVatTransaction({
      side: 'SALE',
      grossAmount: 11200000, // P112,000.00 gross
      companyIsVatRegistered: true,
      partnerVatStatus: 'NON_VAT',
    });
    assert.equal(vatSaleToNonVatBuyer.taxable, 10000000);
    assert.equal(vatSaleToNonVatBuyer.vat, 1200000);
    assert.equal(vatSaleToNonVatBuyer.exempt, 0);

    const vatPurchaseFromVatSupplier = classifyVatTransaction({
      side: 'PURCHASE',
      grossAmount: 11200000,
      companyIsVatRegistered: true,
      partnerVatStatus: 'VAT_REGISTERED',
    });
    assert.equal(vatPurchaseFromVatSupplier.taxable, 10000000);
    assert.equal(vatPurchaseFromVatSupplier.vat, 1200000);

    const vatPurchaseFromNonVatSupplier = classifyVatTransaction({
      side: 'PURCHASE',
      grossAmount: 5000000,
      companyIsVatRegistered: true,
      partnerVatStatus: 'NON_VAT',
    });
    assert.equal(vatPurchaseFromNonVatSupplier.taxable, 0);
    assert.equal(vatPurchaseFromNonVatSupplier.vat, 0);
    assert.equal(vatPurchaseFromNonVatSupplier.exempt, 5000000);
  });
});
