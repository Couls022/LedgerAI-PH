# LedgerAI PH - BIR Tax Engine Architecture

## 1. Core Philosophy
The BIR Tax Engine is a deterministic, version-controlled domain engine designed specifically for Philippine taxation. It does NOT use generic tax formulas. Every tax calculation derives from an authoritative, versioned rule.

## 2. Rule Versioning
To ensure historical accuracy, tax rules are strictly version-controlled. If a rule changes (e.g., a VAT rate change or withholding tax update), old transactions MUST retain the rule version applicable at the time they were recorded.

### Schema Structure:
- `tax_rule_definitions`: The overarching tax concept (e.g., "Expanded Withholding Tax - Professionals").
- `tax_rule_versions`: The specific incarnation of a rule.
  - `id`: UUID
  - `rule_id`: FK to definition
  - `rate`: Numeric value (e.g., 0.10 for 10%)
  - `effective_from`: Date (e.g., 2018-01-01)
  - `effective_to`: Date (Null if current)
  - `official_source`: Reference (e.g., "RR 11-2018")
  - `calculation_method`: Enum/String (e.g., "GROSS_AMOUNT_MULTIPLIER")

## 3. Taxpayer Classifications
The engine dynamically applies rules based on the company's registered taxpayer profile:
- Individual / Sole Proprietor (e.g., 8% Flat Rate vs Graduated)
- Professional
- Corporation / Partnership
- VAT Registered vs Non-VAT Registered
- Mixed Income Earner

## 4. Sub-Engines
- **Income Tax Engine**: Computes based on graduated tables or flat rates depending on the taxpayer's profile.
- **VAT Engine**: Differentiates between VATable, Zero-Rated, and Exempt sales/purchases. Tracks Input and Output VAT.
- **Withholding Tax Engine**: Handles EWT (Expanded) and CWT (Creditable).
- **Percentage Tax Engine**: For non-VAT registered entities subject to specific percentage taxes.

## 5. BIR Form Architecture
Forms (e.g., 2550M, 2550Q, 1701, 1601-EQ) are represented as data structures that map to the underlying tax and accounting records. They are NOT hardcoded React components. 

### Data Flow:
Accounting Data -> Tax Classification -> Tax Rule Version -> Tax Record -> BIR Form Mapping.

## 6. Official Source Validation
*Crucial Rule*: No tax rate or rule is hardcoded without a verified official source (e.g., BIR Revenue Regulations, RMCs). If a rule is unverified, the system will flag it as `REQUIRES_OFFICIAL_RULE_VERIFICATION`.
