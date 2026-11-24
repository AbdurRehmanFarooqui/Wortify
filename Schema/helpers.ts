/** Small, race-safe building blocks for checkout. Call inside withTenant()/a transaction. */
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { inventoryLevels, inventoryMovements, orderCounters, stores, storeDomains } from './schema';

/** Next per-store order number (#1001, #1002, ...). Atomic - safe under concurrent checkouts. */
export async function nextOrderNumber(tx: Tx, storeId: number): Promise<number> {
  const [row] = await tx
    .insert(orderCounters)
    .values({ storeId })
    .onConflictDoUpdate({
      target: orderCounters.storeId,
      set: { lastNumber: sql`${orderCounters.lastNumber} + 1` },
    })
    .returning({ n: orderCounters.lastNumber });
  return row.n;
}

/**
 * Take stock for a sale. Returns false when there isn't enough (nothing changes).
 * One UPDATE with the check inside the WHERE = no oversell, even with simultaneous orders.
 */
export async function takeStock(
  tx: Tx,
  args: { storeId: number; variantId: number; qty: number; allowBackorder: boolean; orderId?: number },
): Promise<boolean> {
  const { storeId, variantId, qty, allowBackorder, orderId } = args;
  const updated = await tx
    .update(inventoryLevels)
    .set({ onHand: sql`${inventoryLevels.onHand} - ${qty}` })
    .where(
      and(
        eq(inventoryLevels.storeId, storeId),
        eq(inventoryLevels.variantId, variantId),
        allowBackorder ? undefined : gte(inventoryLevels.onHand, qty),
      ),
    )
    .returning({ variantId: inventoryLevels.variantId });
  if (updated.length === 0) return false;
  await tx.insert(inventoryMovements).values({ storeId, variantId, delta: -qty, reason: 'sale', orderId });
  return true;
}

/** Hostname -> store. Cache the result in KV; this is the first query of every request. */
export async function findStoreByHostname(tx: Tx, hostname: string) {
  const [row] = await tx
    .select({ store: stores, domainStatus: storeDomains.status })
    .from(storeDomains)
    .innerJoin(stores, eq(stores.id, storeDomains.storeId))
    .where(eq(storeDomains.hostname, hostname.toLowerCase()))
    .limit(1);
  return row ?? null;
}
