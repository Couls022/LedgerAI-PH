# LedgerAI PH - Document Engine Architecture

## 1. Overview
The Document Management Engine handles the secure storage, retrieval, and linking of supporting financial documents (receipts, invoices, withholding certificates, contracts) to their corresponding accounting records.

## 2. Storage Strategy
- **Local File System**: Documents are stored on the local server's file system (e.g., inside a dedicated `data/documents` directory).
- **Database Metadata**: The `documents` table stores metadata, including the file path, original name, mime type, size, and the `company_id` to enforce tenant isolation.

## 3. Linking
Documents can be polymorphically linked to various entities in the system:
- Journal Entries
- Invoices
- Customers / Vendors
- Tax Filings

## 4. Access Control
Accessing a document file via the API requires the user to be authenticated and authorized for the `company_id` associated with that document. Direct HTTP access to the raw file path is prohibited; all file serving routes through an authorization middleware.

## 5. Archiving and Backup
Documents are organized in a directory structure that facilitates easy local backups (e.g., partitioned by year and month).
