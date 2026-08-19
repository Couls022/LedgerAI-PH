# LedgerAI PH - Backup Plan

## 1. Overview
Robust backup capabilities are critical for a standalone, local-server application. LedgerAI PH provides automated and manual backup mechanisms for the database and attached documents.

## 2. Database Backup (SQLite)
- **Snapshotting**: Utilizes SQLite's Online Backup API (via `better-sqlite3` `backup()` method) to safely copy the active database to a backup file without halting the server or corrupting concurrent writes.
- **File Format**: Generates timestamped `.sqlite.bak` or `.db` files.

## 3. Document Backup
- **Archive Generation**: Compresses the `data/documents` directory into a `.zip` or `.tar.gz` archive.

## 4. Automation and Retention
- **Scheduled Backups**: A background cron job (managed by the Node server) executes daily/weekly backups based on user configuration.
- **Retention Policy**: Automatically purges backups older than a configured threshold (e.g., keep last 7 daily, last 4 weekly) to prevent disk exhaustion.

## 5. Restore Process
- Restoring a backup is a destructive action requiring Super Admin privileges and explicit confirmation (e.g., typing the company name to confirm).
- Restoring involves shutting down the database connection, replacing the active `local_database.sqlite` file with the backup, and restarting the connection.
