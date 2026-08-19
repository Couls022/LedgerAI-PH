import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './src/server/db/schema';

const client = createClient({ url: 'file:test.sqlite' });
const db = drizzle(client, { schema });

const query = db.insert(schema.documents).values({
  id: 'doc1',
  companyId: 'comp1',
  fileName: 'test.pdf',
  fileType: 'pdf',
  filePath: '/dev/null',
  entityType: 'INVOICE',
  entityId: 'NONE',
  uploadedBy: 'system',
  status: 'ACTIVE',
  ocrStatus: 'COMPLETED',
  ocrResult: JSON.stringify({ vendorName: 'Acme', totalAmount: 100 })
}).toSQL();

console.log(query);
