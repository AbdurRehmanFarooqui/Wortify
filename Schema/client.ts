/**
 * Database client for Cloudflare Workers (via Hyperdrive) or any Node runtime.
 *
 * Workers rule: create the client PER REQUEST. Connections can't outlive a request.
 *   const { db, close } = createDb(env.HYPERDRIVE.connectionString);
 *   try { ... } finally { ctx.waitUntil(close()); }
 */
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as relations from './relations';
import * as schema from './schema';

export const fullSchema = { ...schema, ...relations };

export function createDb(connectionString: string) {
  const client = postgres(connectionString, { max: 5, fetch_types: false });
  const db = drizzle(client, { schema: fullSchema });
  return { db, close: () => client.end({ timeout: 1 }) };
}

export type Db = ReturnType<typeof createDb>['db'];
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Run a unit of work as ONE store. Sets app.store_id for the transaction so
 * Row-Level Security (optional, see drizzle/custom/002) can enforce isolation
 * even if a query forgets its "store_id = ..." filter.
 */
export async function withTenant<T>(db: Db, storeId: number, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.store_id', ${String(storeId)}, true)`);
    return fn(tx);
  });
}
