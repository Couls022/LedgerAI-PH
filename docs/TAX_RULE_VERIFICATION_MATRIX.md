# LEDGERAI PH — PHILIPPINE TAX RULE VERIFICATION MATRIX

Audit against NIRC 1997, TRAIN Act (RA 10963), CREATE Act (RA 11534), and relevant BIR Revenue Regulations.

| TAX RULE / TOPIC | STATUTORY BASIS | RATE / CALCULATION | DATE-AWARENESS / SCOPE | AUDIT STATUS |
| :--- | :--- | :--- | :--- | :--- |
| **Value Added Tax (VAT)** | NIRC Sec. 106/108 | 12% on Gross Selling Price / Receipts | Standard 12%, 0% Zero-Rated, Exempt lines | **LOCKED — VERIFIED** |
| **Percentage Tax** | NIRC Sec. 116, CREATE Sec. 13 | 3% Standard (1% temporary relief July 2020 - June 2023) | Date-aware rate resolution based on transaction date | **LOCKED — VERIFIED** |
| **8% Gross Income Tax** | TRAIN Act Sec. 24(A)(2)(b) | 8% on Gross Sales/Receipts in excess of ₱250,000 | Available to Individual Sole Proprietors < ₱3M threshold. Pure business gets ₱250k deduction; mixed income earner gets ₱0 deduction. | **LOCKED — VERIFIED** |
| **Graduated Income Tax** | TRAIN Act Brackets (2023 onwards) | 0% to 35% graduated progressive brackets | Applied to taxable net income for individuals | **LOCKED — VERIFIED** |
| **Corporate Income Tax (CIT)** | CREATE Act Sec. 27(A) | 20% MSME (Assets <= ₱100M excl. land, Net Taxable Income <= ₱5M); 25% Standard | Automatic qualification test based on registered company profile metrics | **LOCKED — VERIFIED** |
| **Expanded Withholding Tax (EWT)** | RR 2-98 as amended, RR 11-2018 | Standard ATC Schedule (1% - 15% depending on income payment type) | Supports ATC codes (WI/WC 158, 160, 010, 100, etc.) with automatic Form 2307 creation | **LOCKED — VERIFIED** |
| **Withholding on Compensation** | TRAIN Withholding Table | Bracketed progressive withholding per payroll frequency | Automated computation in `payroll_runs` | **LOCKED — VERIFIED** |
| **Tax Calendar & Deadlines** | BIR Statutory Schedule | 2550Q (25th day following quarter), 1702Q (60 days following quarter), 1601-EQ (last day of month following quarter) | System calculates active deadlines dynamically based on fiscal year setup | **LOCKED — VERIFIED** |
