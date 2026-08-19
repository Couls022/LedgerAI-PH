# LedgerAI PH - OCR Engine Architecture

## 1. Overview
The OCR (Optical Character Recognition) Engine processes scanned documents or images (receipts, invoices) to extract relevant financial data automatically. 

## 2. Offline Capability
To maintain the offline-first mandate, the OCR engine utilizes a local processing library (e.g., Tesseract.js running in Node.js) rather than relying on a cloud API.

## 3. Data Extraction Goals
The engine attempts to extract:
- Merchant / Business Name
- TIN (Tax Identification Number)
- Date
- Invoice / Receipt Number
- Subtotal
- VAT Amount
- Total Amount

## 4. Validation Workflow
OCR is inherently imperfect. The system enforces a "Human-in-the-Loop" workflow:
1. Document is uploaded and processed by OCR.
2. Extracted data is presented in a staging area (`OCR Review`).
3. A user must visually verify and correct the data against the document preview.
4. Only upon explicit user approval does the extracted data convert into a draft Invoice or Journal Entry.
