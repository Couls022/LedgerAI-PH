import { db, schema } from './src/server/db';
import { eq } from 'drizzle-orm';
async function main() {
  const users = await db.select().from(schema.users).all();
  for (const u of users) {
    const mems = await db.select().from(schema.companyUsers).where(eq(schema.companyUsers.userId, u.id)).all();
    console.log(`User ${u.email}:`, mems);
  }
}
main();
