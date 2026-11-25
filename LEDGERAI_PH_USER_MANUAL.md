# LEDGERAI PH — OPISYAL NA MANWAL NG PANGANGASIWA AT PAGGAMIT (COMPREHENSIVE USER MANUAL)

**Bersyon:** 1.0.0-rc.2  
**Wika:** Filipino / Tagalog (na may Official Philippine Accounting Terminology)  
**Saklaw:** Kumpletong Gabay sa **16 Primary ERP Modules**, **36 Canonical Submodules**, **9 Enterprise Roles** (kabilang ang **Company Owner Unrestricted Access**), **Ledger Agent AI Assistant**, **Zero-Data Clean Start**, Philippine Tax & Statutory Compliance, Disaster Recovery, at LAN Multi-User Operations.

---

## TALAHANAYAN NG MGA NILALAMAN

1. [Pambungad at Pilosopiya ng Sistema (System Overview)](#1-pambungad-at-pilosopiya-ng-sistema)
2. [Pagsisimula at Initial Setup (Getting Started)](#2-pagsisimula-at-initial-setup)
3. [Nabigasyon at Paggamit ng ERP Sidebar](#3-nabigasyon-at-paggamit-ng-erp-sidebar)
4. [Detalyadong Gabay sa 16 na ERP Modules](#4-detalyadong-gabay-sa-16-na-erp-modules)
   - [Module 1: Dashboard (Executive & Financial Dashboard)](#module-1-dashboard)
   - [Module 2: Sales & Receivables (Customer Billing & Collections)](#module-2-sales--receivables)
   - [Module 3: Procurement & Payables (3-Way Match & Supplier Bills)](#module-3-procurement--payables)
   - [Module 4: Inventory & Warehouse (Stock Valuation & COGS)](#module-4-inventory--warehouse)
   - [Module 5: Cash & Banking (Cash Transactions & Bank Reconciliation)](#module-5-cash--banking)
   - [Module 6: Accounting & General Ledger (COA, Journals & Periods)](#module-6-accounting--general-ledger)
   - [Module 7: Fixed Assets (Capitalization & Depreciation Register)](#module-7-fixed-assets)
   - [Module 8: Payroll & Human Resources (Compensation & Statutory Deductions)](#module-8-payroll--human-resources)
   - [Module 9: Tax & BIR Compliance (12% VAT, Withholding, 2307 & eFiling)](#module-9-tax--bir-compliance)
   - [Module 10: Budget & Financial Planning (Cost Centers & Variance)](#module-10-budget--financial-planning)
   - [Module 11: Documents & OCR (Vault & Digital Extraction)](#module-11-documents--ocr)
   - [Module 12: Reports & Analytics (Financial Statements & Aging)](#module-12-reports--analytics)
   - [Module 13: Approvals & Workflow (Multi-Level Approvals & SoD)](#module-13-approvals--workflow)
   - [Module 14: Activity Center (Enterprise Activity Stream)](#module-14-activity-center)
   - [Module 15: Audit & Governance (Immutable Trails & Forensic Integrity)](#module-15-audit--governance)
   - [Module 16: Master Data & Administration (RBAC, Vault, LAN & Settings)](#module-16-master-data--administration)
5. [Mga Karaniwang End-to-End Business Cycles](#5-mga-karaniwang-end-to-end-business-cycles)
   - [Siklo A: Benta Hanggang Koleksyon (Sales-to-Cash)](#siklo-a-benta-hanggang-koleksyon)
   - [Siklo B: Pagbili Hanggang Bayad (Procure-to-Pay)](#siklo-b-pagbili-hanggang-bayad)
   - [Siklo C: Pasahod Hanggang General Ledger (Payroll-to-GL)](#siklo-c-pasahod-hanggang-general-ledger)
   - [Siklo D: Pagsasara ng Buwan at Taon (Month-End & Year-End Closing)](#siklo-d-pagsasara-ng-buwan-at-taon)
6. [Seguridad, RBAC, Company Owner Authority at Segregation of Duties (SoD)](#6-seguridad-rbac-company-owner-authority-at-segregation-of-duties-sod)
7. [Disaster Recovery, Backup, Restore at LAN Operations](#7-disaster-recovery-backup-restore-at-lan-operations)
8. [BIR Registration Readiness & Acknowledgment Certificate (RMC 5-2021 & RMC 65-2025)](#8-bir-registration-readiness-rmc-no-5-2021--rmc-no-65-2025)
9. [Ledger Agent AI Assistant at Zero-Data Clean Start Governance](#9-ledger-agent-ai-assistant-at-zero-data-clean-start-governance)

---

## 1. PAMBUNGAD AT PILOSOPIYA NG SISTEMA

Ang **LedgerAI PH** ay isang enterprise-grade, offline-first Philippine ERP, Accounting, Tax at Governance software na idinisenyo partikular para sa mga negosyo at korporasyon sa Pilipinas.

### Mga Pangunahing Katangian ng Sistema:
1. **Single Source of Financial Truth:**  
   Lahat ng transaksyon mula sa Benta (Sales), Pagbili (Purchasing), Imbentaryo (Inventory), Pasahod (Payroll), at Pagbabangko (Banking) ay awtomatikong dumadaloy sa iisang General Ledger. Walang hiwalay o magkakaibang numero sa pagitan ng Dashboard, Trial Balance, Financial Statements, at BIR Tax Reports.
2. **Mahigpit na Double-Entry Balancing (Debit = Credit):**  
   Hindi kailanman papayag ang sistema na mag-post ng hindi balanseng journal entry. Bawat piso sa Debit ay may katumbas na piso sa Credit.
3. **Immutable Posted Transactions (Bawal Baguhin o Burahin ang Naka-post Na):**  
   Alinsunod sa mga pamantayan ng BIR at Philippine Standards on Auditing (PSA), ang mga transaksyong ganap nang nai-post ay hindi na maaaring i-edit o i-delete nang direkta. Kung may pagkakamali, kailangang dumaan sa awtorisadong **Reversal Entry** na may malinaw na audit trail.
4. **Offline-First at Ganap na Naka-encrypt (`.lai` Database Vault):**  
   Gumagana ang sistema kahit walang koneksyon sa internet. Ang bawat kompanya ay nakalagay sa isang protektadong database file na may file extension na `.lai`, na naka-encrypt gamit ang **AES-256-GCM** encryption at PBKDF2 key derivation.
5. **Maker-Checker at Segregation of Duties (SoD):**  
   Ang sinumang gumawa (Creator/Maker) ng isang transaksyon (tulad ng Journal Entry, Purchase Bill, o Check Disbursement) ay pinagbabawalan ng sistema na mag-apruba (Checker/Approver) sa sarili niyang gawa.

---

## 2. PAGSISIMULA AT INITIAL SETUP

### Hakbang 1: Pagbubukas ng App at Zero-Data Clean Start (Launcher)
1. Buksan ang LedgerAI PH desktop app o i-access ang web URL (`/#/launcher`).
2. Sa bagong instalasyon (**Zero-Data Clean Start**), **walang** paunang nakalistang company database, sample records, o test balances — makikita ang malinis na empty state hanggang lumikha ng opisyal na kompanya.
3. Kung may umiiral nang kompanya, i-click ang pangalan nito upang mag-login (o gamitin ang `/#/profile/open` > **Browse & Open**).
4. Kung kailangang lumikha ng bagong profile ng kompanya, i-click ang **"Create New Company"**.

### Hakbang 2: Paglikha ng Bagong Kompanya (Company Profile Wizard)
1. Ilagay ang mga kinakailangang impormasyon:
   - **Company Name:** (Halimbawa: *Mayon Trading Corporation*)
   - **TIN (Taxpayer Identification Number):** 9 o 12-digit BIR TIN (Halimbawa: *123-456-789-000*)
   - **RDO Code:** Ang RDO kung saan nakarehistro ang negosyo (Halimbawa: *RDO 044 - Taguig / Pateros*)
   - **Registered Address:** Opisyal na address ayon sa BIR Certificate of Registration (Form 2303).
   - **Tax Regime:** Piliin kung **VAT Registered (12%)**, **Non-VAT Registered (Percentage Tax)**, o **8% Flat Income Tax**.
   - **Fiscal Year Start:** Karaniwan ay Enero 1 (Calendar Year) o partikular na buwan para sa Fiscal Year.
2. I-click ang **"Initialize Company Workspace"**.
   - Awtomatikong lilikha ang LedgerAI ng bagong encrypted `.lai` database.
   - Awtomatikong ia-apply ang opisyal na Philippine Revised Chart of Accounts (COA) baseline.
   - Lilikha ng Company Owner / Administrator credentials.

### Hakbang 3: Pagtatakda ng Opening Balances (Beginning Balances)
Bago mag-encode ng pang-araw-araw na transaksyon:
1. Pumunta sa **Accounting & General Ledger** > **General Journal & Ledger** (`#/accounting/journals`).
2. Piliin ang **"New Journal Entry"** at lagyan ng sanggunian na `OB-2026-001` (Opening Balance).
3. I-encode ang ending balance ng nakaraang taon para sa bawat account (Cash in Bank, Accounts Receivable, Inventory, Accounts Payable, Retained Earnings, atbp.).
4. Siguraduhing pantay ang Kabuuang Debit at Kabuuang Credit.
5. I-submit para sa approval at i-post upang maging opisyal na simula ng libro.

---

## 3. NABIGASYON AT PAGGAMIT NG ERP SIDEBAR

Ang ERP navigation bar sa kaliwa ay idinisenyo upang maging mabilis, malinis, at hindi nakakaabala sa trabaho:

- **Expanded Mode (Buong Sukat):**
  - Makikita ang buong logo ng LedgerAI, ang pangalan ng sistema, ang Search Bar, at ang 16 na ERP modules na may kumpletong mga labels.
  - Sa idle state, ang chevron collapse button ay nakatago upang malinis ang hitsura.
  - **Paano Paliitin (Collapse):**
    - Itutok ang mouse (hover) sa itaas ng sidebar header. Awtomatikong lalabas ang makinis na **Chevron Arrow (`<`)** sa kanang itaas ng header.
    - I-click ang chevron arrow O i-click ang mismong **LedgerAI Logo**.
- **Collapsed Mode (Icon Rail):**
  - Lilitaw lamang ang logo ng LedgerAI sa itaas at ang mga nakasentrong icon ng bawat module.
  - **Paano Palakihin Ulit (Expand):**
    - I-click lamang ang **LedgerAI Logo** sa itaas ng sidebar. Agad na magbubukas muli ang buong sidebar nang walang anumang pagkaantala o pagbabago sa aktibong pahina.
- **Mabilisang Paghahanap (Quick Search):**
  - Sa expanded mode, i-type ang pangalan ng module o sub-module (hal. *"sales"*, *"2307"*, *"payroll"*, *"vat"*) sa search input box upang mabilis na tumalon sa kinakailangang pahina.
- **Keyboard Navigation:**
  - Pindutin ang `Tab` key upang piliin ang Logo Button (may visible focus indicator). Pindutin ang `Enter` o `Space` upang i-toggle ang pagbubukas o pagsasara ng sidebar.

---

## 4. DETALYADONG GABAY SA 16 NA ERP MODULES

### Module 1: Dashboard (Executive & Financial Dashboard)
*Ruta: `/#/`*
- **Kahalagahan:** Nagbibigay ng real-time na financial picture ng buong negosyo sa iisang tinginan.
- **Mga Bahagi:**
  - **Cash Position:** Kabuuang pondo sa lahat ng bank accounts at petty cash.
  - **Accounts Receivable Aging:** Buod ng mga pautang sa kostumer (Current, Overdue).
  - **Accounts Payable Aging:** Buod ng mga dapat bayaran sa mga supplier.
  - **Monthly Revenue vs Expenses Chart:** Paghahambing ng benta at gastos para sa kasalukuyang buwan.
  - **Pending Approvals Alert:** Bilang ng mga transaksyong naghihintay ng iyong pagsusuri o pag-apruba.
  - **Statutory Deadlines Widget:** Paalala sa nalalapit na BIR monthly at quarterly deadlines (hal. 2550Q, 1601-C, 0619-E).

---

### Module 2: Sales & Receivables (Customer Billing & AR)
*Ruta: `/#/accounting/sales-invoicing`*
- **Kahalagahan:** Pamamahala sa benta ng produkto at serbisyo, paniningil, at Output VAT.
- **Mga Hakbang sa Paggawa ng Sales Invoice:**
  1. I-click ang **"Create Sales Invoice"**.
  2. Piliin ang **Customer** mula sa rehistro (lalabas ang TIN at Address).
  3. Ilagay ang **Invoice Date**, **Due Date**, at **Payment Terms** (hal. Net 30).
  4. Magdagdag ng Line Items:
     - Piliin ang Item o Serbisyo.
     - Ilagay ang Dami (Quantity) at Presyo (Unit Price).
     - Piliin ang Tax Code: **VATable (12%)**, **Zero-Rated (0%)**, o **Exempt**.
  5. Awtomatikong kukuwentahin ng sistema ang:
     - Gross Sales
     - Less: Discounts (kung mayroon)
     - 12% Output VAT (awtomatikong hinihiwalay)
     - Total Amount Due
  6. I-save bilang Draft o i-click ang **"Submit for Approval"**.
- **Pag-record ng Bayad at Pag-isyu ng Official Receipt (OR):**
  1. Buksan ang aprubadong Sales Invoice.
  2. I-click ang **"Record Collection / Payment"**.
  3. Ilagay ang halaga ng natanggap na bayad, Payment Method (Cash, Check, Bank Transfer), at OR/CR Number.
  4. Kung binawasan ng kostumer ng 1% o 2% Withholding Tax (Creditable Withholding Tax sa ilalim ng BIR Form 2307), i-check ang **"Apply CWT Deduction"** at i-encode ang Form 2307 details.
  5. Awtomatikong gagawa ang LedgerAI ng journal entry:
     - `Debit: Cash in Bank / Undeposited Funds`
     - `Debit: Creditable Withholding Tax (Asset 1150)`
     - `Credit: Accounts Receivable (Asset 1120)`

---

### Module 3: Procurement & Payables (3-Way Match & Supplier Bills)
*Ruta: `/#/accounting/procurement` at `/#/accounting/purchase-bills`*
- **Kahalagahan:** Pagkontrol sa mga gastusin, pag-order sa supplier, at pagtitiyak na tama ang sinisingil bago magbayad.
- **3-Way Matching Workflow:**
  1. **Purchase Order (PO):** Paggawa ng opisyal na order sa vendor na naglalaman ng mga item, napagkasunduang presyo, at terms.
  2. **Goods Receipt Note (GRN):** Pagre-record ng warehouse kapag dumating na ang pisikal na produkto. Sinusuri kung kumpleto o may kulang.
  3. **Purchase Bill Verification:** Kapag dumating ang Sales Invoice o Billing ng supplier, ikinukumpara ito ng sistema sa PO at GRN. Kung may discrepancy sa dami o presyo, magpapakita ng babala at hindi papayagang ma-post nang walang authorized override.
- **Pag-encode ng Purchase Bill:**
  1. Piliin ang Supplier at ilagay ang Supplier Invoice Number.
  2. Ilagay ang items o expense accounts.
  3. Piliin ang angkop na Input VAT treatment (12% Goods, 12% Services, o Capital Goods).
  4. Piliin ang nararapat na **ATC (Alphanumeric Tax Code)** para sa Expanded Withholding Tax (hal. `WC158` para sa renta, `WC010` para sa propesyonal, `WC160` para sa goods).
  5. Awtomatikong ibabawas ng LedgerAI ang withholding tax at lilikha ng:
     - `Debit: Expense o Inventory Account`
     - `Debit: Input VAT (Asset 1160)`
     - `Credit: Withholding Tax Payable (Liability 2120)`
     - `Credit: Accounts Payable (Liability 2010)`
- **Pag-isyu ng BIR Form 2307:**
  - Sa isang click, maaaring i-download o i-print ang opisyal na BIR Form 2307 para ibigay sa supplier bago ang ika-20 araw matapos ang bawat quarter o kasabay ng bayad.

---

### Module 4: Inventory & Warehouse (Stock Valuation & COGS)
*Ruta: `/#/accounting/inventory`*
- **Kahalagahan:** Pagsubaybay sa dami at halaga ng paninda o hilaw na materyales (raw materials).
- **Valuation Methods:** Sinusuportahan ang **FIFO (First-In, First-Out)** at **Moving Weighted Average**.
- **Pangunahing Gamit:**
  - **Stock Movement Log:** Talaan ng lahat ng pagpasok (Goods In) at paglabas (Goods Out).
  - **Automatic COGS (Cost of Goods Sold):** Sa tuwing mag-post ng Sales Invoice para sa imbentaryo, awtomatikong binabawas ng sistema ang stock at nagpo-post sa General Ledger ng:
    - `Debit: Cost of Goods Sold (Account 5010)`
    - `Credit: Merchandise Inventory (Account 1130)`
  - **Inventory Adjustment:** Pagtatama ng bilang kung may natagpuang sira (spoilage), nawawala, o sobrang bilang matapos ang physical count.

---

### Module 5: Cash & Banking (Cash Transactions & Bank Reconciliation)
*Ruta: `/#/accounting/cash-transactions` at `/#/accounting/bank-reconciliation`*
- **Kahalagahan:** Pamamahala sa pondo ng kumpanya at pag-reconcile sa opisyal na bank statement.
- **Petty Cash Management:**
  - Pagtatakda ng Petty Cash Fund (Imprest Fund System).
  - Pag-encode ng Petty Cash Vouchers (PCV) para sa maliliit na bayarin.
  - Replenishment summary na awtomatikong nagko-compile ng resibo at naglalabas ng tseke para mapunan ang pondo.
- **Check Register:**
  - Pagsubaybay sa mga inilabas na tseke (Check No., Payee, Petsa, Halaga).
  - Pagmamarka sa mga tseke bilang *Issued*, *Cleared*, o *Cancelled*.
- **Bank Reconciliation Workspace:**
  1. Piliin ang Bank Account at ang cutoff month (hal. *November 2026*).
  2. I-upload ang bank statement (CSV o PDF) o i-encode ang Ending Balance ng bangko.
  3. I-match ang mga sumusunod:
     - **Deposits in Transit:** Mga na-deposit na sa libro pero hindi pa nag-reflect sa bangko.
     - **Outstanding Checks:** Mga tseke na naibigay na sa supplier pero hindi pa na-encash sa bangko.
     - **Bank Charges & Interest Earned:** Mga bawas o dagdag ng bangko na kailangan pang i-adjust sa libro.
  4. Kapag zero na ang **Unreconciled Difference**, i-lock ang reconciliation para sa buwang iyon.

---

### Module 6: Accounting & General Ledger (5 Canonical Submodules)
*Mga Ruta:*
1. **Chart of Accounts:** `/#/accounting/accounts`
2. **General Journal & Ledger:** `/#/accounting/journals`
3. **Trial Balance Ledger:** `/#/reports/trial-balance`
4. **Accounting Periods & Lock:** `/#/accounting/periods`
5. **Foreign Exchange Revaluation:** `/#/accounting/forex`
- **Kahalagahan:** Ang puso ng buong kumpanya. Lahat ng cash/bank accounts (tulad ng `1010 Cash in Bank` at `2026 BDO Business Checking`) ay nakalink nang eksakto sa `bank_accounts.gl_account_id` at sa Centralized Account Discovery (`filterEligibleCashBankAccounts`).
- **Chart of Accounts (COA):**
  - `1000 - Assets` (Debit) | `2000 - Liabilities` (Credit) | `3000 - Equity` (Credit) | `4000 - Revenue` (Credit) | `5000 - COGS` (Debit) | `6000–8000 - Operating Expenses` (Debit).
- **General Journal Entries:** `Total Debit === Total Credit`, hindi maaaring mag-post sa header o inactive account, at bawat naka-post na entry ay immutable (reversal lamang ang puwede).
- **Period Close & Lock:** Soft Close (Bookkeepers blocked, Accountants/Owners allowed for closing entries) at Hard Close (ganap na naka-lock; audit-logged authorized re-open lamang).
- **Forex Revaluation:** Buwanang BSP exchange rate revaluation para sa foreign currency monetary accounts.

---

### Module 7: Fixed Assets (Capitalization & Depreciation Register)
*Ruta: `/#/accounting/fixed-assets`*
- **Kahalagahan:** Pag-monitor sa mga kagamitan, gusali, sasakyan, at computers ng negosyo.
- **Mga Katangian:**
  - **Asset Capitalization:** Pagtatala ng Acquisition Cost, Salvage Value (Scrap Value), at Useful Life (sa buwan o taon).
  - **Automated Straight-Line Depreciation:** Bawat katapusan ng buwan, isang click lang ang kailangan upang kalkulahin at i-post ang:
    - `Debit: Depreciation Expense (Account 6300)`
    - `Credit: Accumulated Depreciation (Account 1600-contra asset)`
  - **Asset Disposal / Sale:** Pagtatala kapag ibinenta o itinapon ang gamit, at awtomatikong pagkukuwenta kung may Gain o Loss on Disposal.

---

### Module 8: Payroll & Human Resources (Compensation & Statutory Deductions)
*Ruta: `/#/accounting/payroll`*
- **Kahalagahan:** Maayos na pasahod at eksaktong pagkalkula ng mga kontribusyon sa gobyerno ayon sa pinakahuling batas ng Pilipinas.
- **Mga Sinusuportahang Statutory Formula:**
  1. **SSS (Social Security System):**
     - Regular Social Security contribution ayon sa pinakabagong contribution schedule.
     - WISP (Workers' Investment and Savings Program) para sa mandatory provident fund.
     - EC (Employees' Compensation) program na sagot ng kumpanya.
  2. **PhilHealth:**
     - 5% premium rate na pantay na pinaghahatian ng empleyado (2.5%) at kumpanya (2.5%), na may minimum floor at maximum income ceiling.
  3. **Pag-IBIG (HDMF):**
     - 2% contribution ng empleyado at kumpanya, na may maximum statutory monthly cap.
  4. **Withholding Tax on Compensation (BIR Form 1601-C):**
     - Batay sa pinakahuling Revised Withholding Tax Tables sa ilalim ng TRAIN Law.
     - Awtomatikong ibinabawas muna ang mandatory SSS, PhilHealth, at Pag-IBIG bago kuwentahin ang buwis sa kita.
- **Pag-post ng Payroll sa General Ledger:**
  - Matapos aprubahan ang Payroll Run, awtomatikong gagawin ang journal:
    - `Debit: Salaries and Wages Expense`
    - `Debit: SSS & EC Expense (Employer Share)`
    - `Debit: PhilHealth Expense (Employer Share)`
    - `Debit: Pag-IBIG Expense (Employer Share)`
    - `Credit: Withholding Tax Payable - Compensation (Liability 2110)`
    - `Credit: SSS Premium Payable (Liability 2130)`
    - `Credit: PhilHealth Premium Payable (Liability 2140)`
    - `Credit: Pag-IBIG Premium Payable (Liability 2150)`
    - `Credit: Net Payroll Payable / Cash in Bank (Account 2030 / 1010)`

---

### Module 9: Tax & BIR Compliance (4 Canonical Submodules)
*Mga Ruta:*
1. **BIR Statutory Returns & eFiling Preparation:** `/#/tax/bir-compliance`
2. **VAT & Withholding Schedules:** `/#/tax/vat-schedules`
3. **Alphalist & SAWT/SLSP Data Entry:** `/#/tax/ledger-data-entry`
4. **BIR Form & GL Account Mapping:** `/#/tax/forms`
- **Kahalagahan:** Ganap na pagsunod sa mga panuntunan ng Bureau of Internal Revenue (BIR) at **RA 11976 (EOPT Act)** batay sa rehistradong tax regime ng kompanya (`VAT_REGISTERED`, `NON_VAT`, o `8_PERCENT_FLAT`).
- **Mga Sinusuportahang BIR Returns:**
  - **BIR Form 2550Q (Mandatory Quarterly — RMC 5-2023) & Optional 2550M (RMC 52-2023):** Value-Added Tax Declaration (Output VAT minus Input VAT mula sa `VAT12` items lamang — hindi kasama ang `VAT0` at `VATEX`). Para sa Non-VAT at 8% Flat companies, laging `₱0.00` ang Output/Input VAT.
  - **BIR Form 2551Q:** Quarterly Percentage Tax Return para sa `NON_VAT` taxpayers (`3%` standard / `1%` CREATE Act transition).
  - **BIR Form 1601-C:** Monthly Remittance Return of Income Taxes Withheld on Compensation.
  - **BIR Form 0619-E / 1601-EQ & 0619-F / 1601-FQ:** Expanded & Final Withholding Taxes (`2307` / `2306`) gamit ang eksaktong ATC rates.
  - **BIR Form 1701Q / 1701A / 1702Q / 1702-RT:** Income Tax Returns para sa Individuals at Corporations.
- **SLSP, SAWT & QAP Alphalists:** Awtomatikong pinagsasama-sama para sa e-Submission preparation. *(Paalala: Ang live eFPS/eBIRForms submission at taxpayer RDO Acknowledgment Certificate under RMC 5-2021 / RMC 65-2025 ay ginagawa ng taxpayer labas ng app).*

---

### Module 10: Budget & Financial Planning
*Ruta: `/#/budget`*
- **Kahalagahan:** Pagpaplano ng taunang pondo at pagpigil sa labis na paggastos.
- **Mga Katangian:**
  - Pagtatakda ng buwanang limitasyon sa bawat Department o Cost Center.
  - **Variance Analysis Report:** Real-time na paghahambing ng Budget vs Actual Expense.
  - **Early Warning System:** Nagbibigay ng alerto kapag umabot na sa 80% o lumampas sa 100% ng inilaang badyet ang isang departamento.

---

### Module 11: Documents & OCR
*Ruta: `/#/documents`*
- **Kahalagahan:** Paperless office at digital archive ng lahat ng resibo at kontrata.
- **Tesseract OCR (Optical Character Recognition):**
  1. I-drag at i-drop ang litrato o PDF ng resibo/invoice.
  2. Babasahin ng sistema ang dokumento at awtomatikong kukunin ang:
     - Supplier Name
     - TIN
     - Petsa
     - Invoice Number
     - Halaga (Total Amount)
  3. Maaaring i-link agad ang na-scan na dokumento sa kaukulang Purchase Bill o Journal Entry.
  4. Lahat ng files ay naka-encrypt sa ilalim ng `LAISDOC1` storage standard upang hindi manakaw o mabuksan sa labas ng app.

---

### Module 12: Reports & Analytics
*Ruta: `/#/reports`*
- **Kahalagahan:** Pagbuo ng mga opisyal na ulat sa pananalapi para sa Management, Bangko, at External Auditors.
- **Mga Pangunahing Ulat:**
  1. **Statement of Financial Position (Balance Sheet):**
     - Nagpapatunay na `Assets = Liabilities + Equity`.
  2. **Statement of Comprehensive Income (Income Statement / P&L):**
     - Nagpapakita ng Gross Profit, Operating Expenses, at Net Income.
  3. **Statement of Cash Flows:**
     - Operating Activities, Investing Activities, at Financing Activities.
  4. **Trial Balance Ledger:**
     - Nagpapakita ng Debit at Credit balances ng lahat ng accounts sa Chart of Accounts.
  5. **Accounts Receivable Aging & Accounts Payable Aging:**
     - Detalyadong listahan kung sinong kostumer ang may utang at kailan ito dapat singilin, at kung anong supplier bill ang dapat bayaran.
- **Export Capabilities:** Maaaring i-export sa PDF, CSV/Excel, o i-print nang direkta.

---

### Module 13: Approvals & Workflow
*Ruta: `/#/activity-center?workspace=approvals`*
- **Kahalagahan:** Pagkontrol sa awtoridad at pagpapatupad ng Maker-Checker governance.
- **Mga Katangian:**
  - **Approval Inbox:** Dito nakikita ng Approver ang lahat ng transaksyong nakabinbin (Pending Journals, Bills, Checks, Payroll).
  - **Side-by-Side Review:** Makikita ang buong detalye ng transaksyon bago pindutin ang **Approve** o **Reject**.
  - **Delegation of Authority:** Kung magbabakasyon ang Approver, maaaring pansamantalang italaga ang karapatan sa ibang opisyal na may strict time limit.
  - **SLA Tracking:** Sinusubaybayan kung gaano katagal bago maaprubahan ang isang dokumento upang maiwasan ang mga naantalang bayarin.

---

### Module 14: Activity Center
*Ruta: `/#/activity-center?workspace=stream`*
- **Kahalagahan:** Transparency at real-time telemetry ng bawat aktibidad sa buong kumpanya.
- **Mga Katangian:**
  - Live feed ng mga ginagawang invoice, binabayarang tseke, at na-post na journals.
  - Nagpapakita kung sino ang gumawa, anong oras ginawa, at anong workstation ang ginamit.

---

### Module 15: Audit & Governance (5 Canonical Submodules)
*Mga Ruta:*
1. **Immutable Audit Trail Logs:** `/#/audit/logs`
2. **Audit Engagements & Planning:** `/#/audit/engagements`
3. **PSA Working Papers & Lead Sheets:** `/#/audit/workpapers`
4. **Forensic & Fraud Anomaly Detection:** `/#/audit/fraud`
5. **Cryptographic Ledger Integrity:** `/#/audit/integrity`
- **Kahalagahan:** Espesyal na workspace para sa Internal/External CPAs at Auditors alinsunod sa Philippine Standards on Auditing (PSA), may HMAC-SHA256 audit chain at forensic tests.

---

### Module 16: Master Data & Administration (8 Canonical Submodules)
*Mga Ruta:*
1. **Customer Master Registry:** `/#/master-data/customers`
2. **Vendor & Supplier Registry:** `/#/master-data/vendors`
3. **Organizational Dimensions & Cost Centers:** `/#/master-data/cost-centers`
4. **Statutory Tax Codes & ATC Rates:** `/#/master-data/tax-codes`
5. **Enterprise RBAC & Access Matrix:** `/#/master-data/rbac`
6. **Database Vault & Disaster Recovery:** `/#/master-data/backup-vault`
7. **Multi-Workstation LAN & Concurrency:** `/#/master-data/lan-network`
8. **Enterprise Profile & System Settings:** `/#/settings`
- **Kabuuang Saklaw:** Kasama ng 15 pang modules, kumakatawan ito sa eksaktong **16 Primary Modules at 36 Canonical Submodules** ng LedgerAI PH `v1.0.0-rc.2`.

---

## 5. MGA KARANIWANG END-TO-END BUSINESS CYCLES

Upang mas mabilis na maunawaan kung paano nagtutulungan ang mga module, narito ang mga hakbang sa apat na pangunahing siklo ng negosyo:

### Siklo A: Benta Hanggang Koleksyon (Sales-to-Cash)
1. **Paggawa ng Invoice:** Pumasok sa Module 2 > Sales Invoice. Piliin ang Customer at produkto. Awtomatikong kukuwentahin ang 12% Output VAT.
2. **Pag-apruba:** I-submit sa Module 13. Aaprubahan ng Supervisor/Approver.
3. **Paghahatid at Pagbawas ng Stock:** Sa pag-post ng invoice, awtomatikong babawasan ng Module 4 ang imbentaryo at itatala ang COGS.
4. **Paniningil:** Kapag nagbayad ang kostumer, buksan ang Module 2 at i-click ang *Record Collection*. Ilagay ang Official Receipt (OR) number at kung may kaltas na 2307 CWT.
5. **Pagdeposito sa Bangko:** Sa Module 5 > Cash Management, itala ang pagdeposito ng tseke o pera sa kaukulang bank account.

### Siklo B: Pagbili Hanggang Bayad (Procure-to-Pay)
1. **Purchase Order (PO):** Gumawa ng PO sa Module 3 para sa kailangang materyales o kagamitan.
2. **Pagtanggap (GRN):** Pagdating ng gamit, itala ang resibo sa Module 3 / Module 4 upang madagdagan ang inventory.
3. **Pagrehistro ng Bill:** Pagdating ng Sales Invoice ng supplier, i-encode ang Purchase Bill. Awtomatikong ikakaltas ng system ang 12% Input VAT at ang naaangkop na EWT (hal. 1% sa goods o 2% sa services).
4. **Pag-apruba at Pag-isyu ng 2307:** Aaprubahan sa Module 13. I-download ang Form 2307 para maipadala sa supplier.
5. **Pagbabayad (Disbursement):** Sa Module 5, maglabas ng Tseke (Check Disbursement Voucher) para mabayaran ang natitirang Accounts Payable.

### Siklo C: Pasahod Hanggang General Ledger (Payroll-to-GL)
1. **Paghahanda ng Payroll:** Sa Module 8, piliin ang cutoff period (hal. *Nov 1-15, 2026*).
2. **Pagkalkula:** I-click ang *Compute Payroll*. Awtomatikong kukunin ang attendance, at kukuwentahin ang SSS, PhilHealth, Pag-IBIG, at Withholding Tax on Compensation.
3. **Review at Approval:** Susuriin ng HR/Accountant at aaprubahan sa Module 13.
4. **GL Auto-Posting:** Awtomatikong magpo-post sa General Ledger ang Payroll Journal Entries nang walang manual encoding.
5. **Disbursement:** Sa araw ng sahod, i-release ang pondo sa bangko o payroll account ng mga kawani.

### Siklo D: Pagsasara ng Buwan at Taon (Month-End & Year-End Closing)
1. **Pagtatala ng Accruals:** I-encode ang mga hindi pa nababayarang kuryente, tubig, at renta sa Module 6.
2. **Fixed Asset Depreciation:** Sa Module 7, patakbuhin ang buwanang depreciation run.
3. **Bank Reconciliation:** Sa Module 5, tiyakin na tugma ang Bank Statement balance sa Cash in Bank account balance.
4. **Pagsusuri ng Buwis:** Sa Module 9, patakbuhin ang VAT at Withholding tax schedules bago mag-generate ng BIR returns (hal. 2550Q at 1601-EQ).
5. **Trial Balance Verification:** Sa Module 6, suriin na walang Unbalanced accounts at zero ang net difference.
6. **Soft Close at Hard Close:** Sa Module 6 > Accounting Periods, i-lock ang buwan upang matiyak na protektado ang integridad ng mga opisyal na ulat.

---

## 6. SEGURIDAD, RBAC, COMPANY OWNER AUTHORITY AT SEGREGATION OF DUTIES (SOD)

Upang maiwasan ang panlilinlang (fraud) at pagkakamali, ipinapatupad ng LedgerAI ang 9-role RBAC architecture na may **Unrestricted Company Owner Authority** (`DEF-OWNER-RBAC-001`):

### Mga Umiiral na 9 Canonical Role Templates:
- **Company Owner (Unrestricted Authority):** Ganap at walang hangganang access sa lahat ng **16 modules / 36 submodules**, `COMPANY_WIDE` scope, at unlimited (`-1`) approval limit (`['*', ...ALL_PERMISSIONS]`). Hindi maaaring limitahan ng employee checkboxes o `DENY` overrides (`400 OWNER_UNRESTRICTED_POLICY`), habang nananatili ang session auth, cross-company isolation, `RECOVERY_READ_ONLY` quarantine lock, immutable HMAC audit logging, at Maker-Checker self-approval guard.
- **Company Administrator:** Pamamahala sa mga gumagamit, RBAC matrix ng mga empleyado, LAN cluster, settings, at database vault.
- **Accountant:** Paggawa at pag-post ng journal entries, financial statements, COA, bank recon, tax schedules, at period closing.
- **Bookkeeper:** Pag-encode ng draft Sales Invoices, Purchase Bills, at Collections. Hindi maaaring mag-post o mag-approve.
- **Approver / Reviewer:** Pagsusuri at pag-apruba o pag-reject ng mga transaksyon batay sa spending limits at SoD.
- **Auditor:** Read-only access sa lahat ng libro, journals, forensic anomaly detection, at HMAC audit logs.
- **Tax & AP Specialist:** Nakatuon sa Procure-to-Pay (`purchases:*`), Vendor Registry (`vendors:*`), EWT/2307, at BIR Compliance (`tax:*`) nang walang access sa Payroll o hindi kaugnay na admin settings.
- **Read-only User:** Read-only viewing sa Dashboard, Reports, at mga pinahihintulutang talaan.

### Mga Panuntunan sa Segregation of Duties:
1. **Self-Approval Prohibition:** Kahit **Company Owner** o **Approver**, hindi maaaring mag-apruba ng sariling isinumiteng transaksyon (`submitter !== approver`).
2. **Non-Destructive Shortcuts vs Physical Database Preservation:** Sa `/#/profile/open`, ang **"Delete All Data Register Shortcuts (Not Database)"** ay naglilinis lamang ng launcher shortcut history (`shortcut_history.json = []`) nang hindi binubura ang mga `.lai` company databases sa disk.

---

## 7. DISASTER RECOVERY, BACKUP, RESTORE AT LAN OPERATIONS

### Paano Mag-Backup ng Datos:
1. Pumunta sa **Master Data & Administration** > **Database Vault & Disaster Recovery** (`/#/master-data/backup-vault`).
2. I-click ang **"Create Encrypted Backup Now"**.
3. Awtomatikong lilikha ang LedgerAI ng isang `.lai` encrypted backup file.
4. I-download o i-save ang backup file sa isang ligtas na storage (external hard drive, flash drive, o secure network folder).
5. **Automated Backups:** Maaari ring i-set ang automated scheduled backups (hal. tuwing 5:00 PM araw-araw) na tatakbo sa background nang walang abala sa mga gumagamit.

### Paano Mag-Restore ng Datos (Kung Nasira o Pinalitan ang Kompyuter):
1. I-install ang LedgerAI PH sa bagong kompyuter.
2. Sa Launcher screen, i-click ang **"Restore from Backup (.lai)"**.
3. Piliin ang iyong `.lai` backup file.
4. May dalawang opsyon:
   - **Restore as New / Clone:** Magbubukas ng panibagong workspace nang hindi ginagalaw ang mga umiiral nang kumpanya.
   - **Replace Existing Company:** Papalitan ang kasalukuyang workspace ng datos mula sa backup (nangangailangan ng Admin master password).
5. Pagkatapos ng restore, awtomatikong susuriin ng LedgerAI ang cryptographic integrity ng buong ledger bago buksan ang aplikasyon.

### Paggamit sa Loob ng Opisina Gamit ang Local Area Network (LAN):
Hindi kailangang mag-upload ng datos sa pampublikong cloud kung nais ng kumpanya na manatiling offline ang kanilang financial data:
1. Italaga ang isang matatag na desktop PC bilang **Local LAN Server**.
2. Sa Server PC, buksan ang **Master Data** > **Multi-Workstation LAN & Concurrency**.
3. I-on ang **"Host Local LAN Server"**. Makikita ang Local IP Address (hal. `192.168.1.100:3000`).
4. Sa ibang kompyuter sa parehong opisina (Client Workstations), buksan ang browser at i-type ang IP address ng server.
5. **Optimistic Concurrency Control:** Kung sabay na nag-e-edit ang dalawang empleyado sa iisang invoice, poprotektahan ng sistema ang datos upang maiwasan ang overwriting o magkasalungat na numero.

---

## 8. BIR REGISTRATION READINESS (RMC NO. 5-2021 & RMC NO. 65-2025)

Alinsunod sa mga pinakahuling sirkular ng Bureau of Internal Revenue (BIR):
- Sa ilalim ng **BIR Revenue Memorandum Circular (RMC) No. 5-2021**, ang mga kumpanyang gumagamit ng Computerized Accounting Systems (CAS) o Computerized Books of Accounts (CBA) ay sumasailalim sa pagpaparehistro at pagkuha ng **Acknowledgment Certificate (AC)** sa kanilang kaukulang Revenue District Office (RDO).
- Nilinaw din sa **RMC No. 65-2025** ang mga alituntunin sa paggamit ng computerized books bago gamitin sa opisyal na operasyon.

### Mga Inihandang Dokumento sa LedgerAI Para sa BIR Registration:
Buksan ang `BIR_REGISTRATION_READINESS.md` para sa kumpletong RDO submission checklist (Application Form 1900, System Description ng 16 Modules/36 Submodules, Sample Books of Accounts — General Journal, General Ledger, Sales Journal, Purchase Journal, Cash Receipts/Disbursements Books, Inventory Book — at 10-year HMAC Audit Trail evidence).

---

## 9. LEDGER AGENT AI ASSISTANT AT ZERO-DATA CLEAN START GOVERNANCE

### Paano Gamitin ang Ledger Agent (Floating AI Assistant):
1. I-click ang **Ledger Agent** button sa ibabang kanan ng ERP workspace upang buksan ang AI Drawer.
2. **Dalawang Mode ng Katalinuhan:**
   - **ERP Guide & How-To Mode:** Sumasagot sa Filipino, English, o Taglish tungkol sa lahat ng **16 primary modules** at **36 submodules** gamit ang verified `CANONICAL_KNOWLEDGE_BASE` na may one-click **Navigate** links direkta sa tamang screen.
   - **Live Financial & Tax Analysis Mode:** Nagtatanong sa aktibong SQLite database ng kumpanya (hal. Cash balances, AR/AP, Inventory, Journal entries, Trial Balance, BIR VAT/Percentage Tax/EWT na nakaangkop sa aktwal na `vat_status` ng kumpanya) habang mahigpit na nagpapatupad ng RBAC domain checks.
3. **Human-in-the-Loop Action Confirmation (`POST /api/ai/confirm-action`):** Bawat iminungkahing draft action ng AI ay kailangan ng personal na pagkumpirma ng nakalog-in na may-ari ng aksyon, permission verification, at immutable audit seal bago maitala sa libro.

## 10. KUMPLETONG 12-PART ROLE & OPERATIONAL MANUAL SUITE (PHASE 9 & PHASE 4/5/8/11)

Upang magamit nang maayos ng isang tunay na negosyo sa Pilipinas ang **LedgerAI PH (`v1.0.0-rc.2`)**, narito ang opisyal na **12 Operational Manuals** para sa bawat tungkulin at proseso sa kumpanya:

### 10.1 Manual 1 — Company Owner Manual
- **Awtoridad at Saklaw:** Ang aktibong **Company Owner** ay may ganap at walang-kondisyong access (`['*', ...ALL_PERMISSIONS]`, `COMPANY_WIDE` scope, `-1` approval limit) sa lahat ng **16 ERP modules** at **36 submodules**. Hindi maaaring bawasan ang kanyang access sa pamamagitan ng employee checkboxes o `DENY` overrides (`400 OWNER_UNRESTRICTED_POLICY`).
- **Mga Pangunahing Tungkulin (20-Step First-Company Initialization Sequence):**
  1. Buksan ang `/#/launcher` at piliin ang **Create Company** (`/profile/create`).
  2. Ilagay ang **Legal Registered Business Name** at **Registered Address** ayon sa BIR Form 2303.
  3. Ilagay ang opisyal na **TIN** at **Branch Code** (`00000` para sa Head Office) at **RDO Code**.
  4. Piliin ang **Taxpayer Entity Classification** (hal. *Domestic Corporation*, *Sole Proprietorship*, *OPC*).
  5. Piliin ang **VAT o Non-VAT Treatment** (*12% Regular VAT - Form 2550Q*, *Non-VAT 3%/1% Percentage Tax - Form 2551Q*, o *8% Flat Income Tax Option*).
  6. Kumpirmahin ang naaangkop na tax elections (hal. optional monthly `2550M` election sa ilalim ng RMC 52-2023).
  7. Itakda ang **Fiscal Year** at simulan ang **Accounting Periods** (`/accounting/periods`).
  8. Suriin ang na-seed na **Chart of Accounts (COA)** (`/accounting/coa`).
  9. Kumpirmahin ang **Account Mappings** para sa Cash, AR, AP, Inventory, VAT, EWT, COGS, at Retained Earnings.
  10. I-configure ang **Financial Reporting Settings** (`/settings`).
  11. Irehistro ang mga aktwal na **Cash at Bank Accounts** (`/accounting/cash`) na naka-link sa tamang COA `gl_account_id` (hal. `1010`, `2026`).
  12. Itakda ang **Inventory & Costing Policies** (FIFO / Weighted Average) sa `/inventory`.
  13. Itakda ang **Fixed Asset & Depreciation Policies** sa `/accounting/fixed-assets`.
  14. I-configure ang **Payroll & Statutory Settings** (SSS, PhilHealth, Pag-IBIG, TRAIN WHT) sa `/accounting/payroll`.
  15. Lumikha ng mga **Users at Magtalaga ng Roles** sa `/master-data/users` at `/master-data/rbac`.
  16. Kumpirmahin ang **Company Owner Unrestricted Access** sa `/master-data/rbac`.
  17. I-configure ang **Maker-Checker Approval Authority** at spending thresholds (`/approvals`).
  18. I-verify ang **AES-256-GCM Encryption (`LAISENC2`)** at **Automated Backup Settings** (`/master-data/backup-vault`).
  19. Suriin ang **Initialization Summary** at Opening Trial Balance (`₱0.00` kung zero-balance start, o balanse kung may cutover).
  20. Kumpirmahin ang **Company Activation** at unang encrypted `.laibak` baseline backup.

### 10.2 Manual 2 — Company Administrator Manual
- **Saklaw:** User onboarding (`/master-data/users`), Employee Role & Custom Permission Matrix (`/master-data/rbac`), Multi-Workstation LAN Cluster (`/master-data/lan`), Database Vault (`/master-data/backup-vault`), at AI Provider Settings (`/settings`).
- **Mahahalagang Paalala:** Ang Administrator ay maaaring mag-grant o mag-deny ng custom permissions para sa mga empleyado (hal. *Bookkeeper*, *Accountant*), ngunit hindi maaaring galawin o limitahan ang **Company Owner**.

### 10.3 Manual 3 — Accountant Manual
- **Saklaw:** Chart of Accounts (`/accounting/coa`), Opening Balance Cutover (`POST /api/master-data/opening-balances/batch`), General Journal (`/accounting/journals`), Bank Reconciliation (`/accounting/bank-reconciliation`), Fixed Asset Depreciation (`/accounting/fixed-assets`), BIR Tax Returns (`/tax/bir-compliance`), Trial Balance (`/reports/trial-balance`), at Period Closing (`/accounting/periods`).
- **Controlled Opening Balance Process (Phase 5):**
  - Tanging **Balance Sheet** accounts lamang ang maaaring tumanggap ng opening balance (bawal ang Revenue/Expense).
  - Bawat opening balance cutover ay dapat may `effectiveDate`, `batchReference`, `sourceSystem`, at `supportingScheduleRef`.
  - Kailangang **Debit = Credit (`0` discrepancy)**; mahigpit na ipinagbabawal ang silent plug entries (`400 UNBALANCED_OPENING_BALANCE_BATCH`) at duplicate imports (`409`).

### 10.4 Manual 4 — Finance Manager Manual
- **Saklaw:** Executive & Finance Dashboards (`/#/`), Cash Position & Treasury (`/accounting/cash`, `/reports/cashbook`), AR/AP Aging (`/reports/ar-aging`, `/reports/ap-aging`), Budget vs Actual Variance (`/budget`), at Financial Statements (`/reports`).
- **Source-of-Truth Verification:** Bawat KPI card sa Dashboard ay may direktang **Drill-down** link at formula tooltip na nakatali sa posted General Ledger at subledgers.

### 10.5 Manual 5 — Approver / Reviewer Manual
- **Saklaw:** Approval Inbox (`/approvals`) at 360° Entity Journey Drawer.
- **Segregation of Duties (SoD):** Ang sinumang gumawa o nag-submit ng transaksyon (`initiatedBy`) ay hindi maaaring mag-apruba sa sarili niyang gawa (`403 SOD_VIOLATION`). Kailangang suriin ng Approver ang naka-attach na supporting document at tax breakdown bago i-click ang **Approve** o **Reject**.

### 10.6 Manual 6 — Employee / Bookkeeper / Tax & AP Specialist Manual
- **Bookkeeper:** Pag-encode ng Draft Sales Invoices, Official Receipts / Collections, Purchase Orders, Receiving Reports, Supplier Bills, at Document Uploads (`/documents`) para sa pagsusuri ng Accountant at Approver.
- **Tax & AP Specialist:** Pamamahala sa Supplier Bills, VendorTIN verification, ATC selection (`WI010`, `WC010`, `WI158`, atbp.), BIR Form 2307 generation, at Quarterly EWT/VAT schedules nang walang access sa Payroll compensation records.

### 10.7 Manual 7 — Module-by-Module Operating Manual (16 Modules / 36 Submodules)
- Sumangguni sa **Seksyon 4 (Modules 1–16)** sa itaas at sa inline `CANONICAL_KNOWLEDGE_BASE` para sa step-by-step instructions, prerequisites, at expected GL impact ng lahat ng 36 submodules.

### 10.8 Manual 8 — Reports & Dashboard Source-of-Truth Guide
- **Financial Statements (`/reports`):** Balance Sheet, Income Statement (P&L), Cash Flow Statement, at Trial Balance ay kinukwenta nang real-time mula sa `POSTED` General Ledger lines sa integer centavos (`0` rounding drift).
- **Empty & Exception States:** Kapag walang nakatalang transaksyon sa napiling panahon, ipinapakita ng sistema ang malinaw na paliwanag (*"No posted revenue recorded"*, *"No posted cash or bank journal lines recorded yet"*) sa halip na mag-imbento ng numero.

### 10.9 Manual 9 — Ledger Agent AI Assistant Usage Guide
- Buksan ang **Ledger Agent** sa kanang ibaba ng screen.
- Magtanong sa **English, Filipino, o Taglish** (hal. *"How do I run bank reconciliation?"*, *"Magkano VAT ko?"*, *"Show top open supplier bills by balance due"*).
- Gumagamit ang Ledger Agent ng **Domain RBAC Guard** (tinatanggihan ang mga tanong sa Payroll o Tax kung walang kaukulang permission ang user) at **Deterministic Offline Failover** kapag walang internet.

### 10.10 Manual 10 — Backup, Restore & Disaster Recovery Guide
- **Manual & Scheduled Backups:** Gumamit ng `/master-data/backup-vault` upang lumikha ng AES-256-GCM encrypted `.laibak` archives na may SHA-256 manifest verification.
- **Quarantine Protection (`RECOVERY_READ_ONLY`):** Kung ma-detect ng `PRAGMA integrity_check` o HMAC audit verifier ang anumang tampering o disk corruption, awtomatikong inilalagay ang kumpanya sa read-only quarantine hanggang ma-restore mula sa verified backup.

### 10.11 Manual 11 — Security, Access Control & Cryptographic Governance Guide
- **Database Isolation:** Bawat kumpanya ay may sariling SQLite container (`database.lai` / `.db_active.sqlite`).
- **Field-Level Encryption:** Naka-encrypt ang bank account numbers (`LAIBANK1:`), AI API keys (`LAIAIKEY1:`), at document vault files (`ENCRYPTED_AES256_GCM`).
- **Immutable Audit Trail:** Pinoprotektahan ng SQLite triggers (`trg_audit_logs_immutable_update`, `trg_audit_logs_immutable_delete`) at chained HMAC-SHA256 seals (`sealAuditRowSync`).

### 10.12 Manual 12 — Month-End, Quarter-End & Year-End Closing Guide
1. Kumpletuhin ang lahat ng draft invoices, bills, collections, at disbursements.
2. Patakbuhin at i-finalize ang **Bank Reconciliation** (`/accounting/bank-reconciliation`) para sa lahat ng bank accounts (`Variance = ₱0.00`).
3. Patakbuhin ang buwanang **Fixed Asset Depreciation** at **Payroll Posting**.
4. I-verify ang **Subledger-to-GL Reconciliation** (AR, AP, Inventory, Cash/Bank) at **Trial Balance** (`Total Debit == Total Credit`).
5. I-generate at i-review ang **BIR Returns** (`2550Q` / `2551Q`, `1601-EQ`, `1601-C`, `2307` SAWT/QAP).
6. Sa `/accounting/periods`, isara ang accounting period (**SOFT_CLOSED** para sa review; **LOCKED / HARD_CLOSED** matapos ang pinal na pag-uulat at year-end closing entry papuntang `Retained Earnings`).

---

## PANGWAKAS NA PAALALA

Ang LedgerAI PH (`v1.0.0-rc.2`) ay binuo upang mapadali ang pamamahala sa pananalapi ng negosyo nang may buong kapanatagan ng loob sa aspeto ng tax compliance, accounting accuracy, RBAC governance, at proteksyon ng datos. Para sa mga katanungan o teknikal na tulong, sumangguni sa Ledger Agent AI Assistant o sa inyong itinalagang Company Owner / System Administrator.

