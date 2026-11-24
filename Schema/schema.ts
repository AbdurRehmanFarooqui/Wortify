/**
 * Multi-tenant e-commerce SaaS (Pakistan) - Drizzle ORM schema
 * Mirrors schema.sql. PostgreSQL 15+.
 *
 * RULES THIS FILE FOLLOWS
 *  - A store is the tenant. Every tenant table carries store_id.
 *  - Every tenant table has UNIQUE (store_id, id) so children can use a
 *    COMPOSITE foreign key (store_id, parent_id): a row in store A can never
 *    point at a row in store B.
 *  - Every index on a tenant table starts with store_id.
 *  - Money is numeric(12,2) PKR. Drizzle returns numeric as a STRING on purpose
 *    (no float errors). Do money maths in SQL or with a decimal library.
 *  - Status-like columns are text + CHECK (typed in TS, easy to migrate).
 *  - 9 "ON DELETE SET NULL" composite foreign keys cannot be expressed in
 *    Drizzle yet; they live in drizzle/custom/002_constraints_triggers.sql.
 *    Those columns are marked "FK in custom SQL" below.
 */
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const citext = customType<{ data: string }>({ dataType: () => 'citext' });
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

const pk = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const idRef = (name: string) => bigint(name, { mode: 'number' });
/** store_id column with a direct FK to stores (top-level tenant tables) */
const storeRef = () =>
  bigint('store_id', { mode: 'number' })
    .notNull()
    .references(() => stores.id, { onDelete: 'cascade' });
/** store_id column for child tables (existence is guaranteed by the composite FK) */
const storeCol = () => bigint('store_id', { mode: 'number' }).notNull();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

/** CHECK (col IN ('a','b',...)) */
const inList = (col: AnyPgColumn, values: readonly string[]) =>
  sql`${col} in (${sql.join(
    values.map((v) => sql.raw(`'${v}'`)),
    sql`, `,
  )})`;

/** Composite tenant foreign key: (store_id, child_id) -> (store_id, parent_id) */
const tenantFk = (
  name: string,
  columns: [AnyPgColumn, AnyPgColumn],
  foreignColumns: [AnyPgColumn, AnyPgColumn],
  onDelete: 'cascade' | 'no action' = 'cascade',
) => foreignKey({ name, columns, foreignColumns }).onDelete(onDelete);

/* ------------------------------------------------------------------ */
/* Enum-like value lists (used for TS types AND database CHECKs)       */
/* ------------------------------------------------------------------ */

export const STORE_STATUS = ['trial', 'active', 'past_due', 'suspended', 'cancelled'] as const;
export const MEMBER_ROLE = ['owner', 'admin', 'staff'] as const;
export const INVOICE_STATUS = ['open', 'paid', 'void', 'failed'] as const;
export const DOMAIN_KIND = ['platform_subdomain', 'custom'] as const;
export const DOMAIN_STATUS = ['pending', 'verifying', 'active', 'failed'] as const;
export const PAYMENT_PROVIDER = ['cod', 'jazzcash', 'easypaisa', 'card', 'bank_transfer'] as const;
export const GATEWAY_MODE = ['sandbox', 'live'] as const;
export const CONFIG_STATUS = ['draft', 'published'] as const;
export const PAGE_TYPE = ['home', 'page', 'policy', 'landing'] as const;
export const COLLECTION_TYPE = ['manual', 'smart'] as const;
export const COLLECTION_SORT = ['manual', 'best_selling', 'newest', 'price_asc', 'price_desc'] as const;
export const PRODUCT_STATUS = ['draft', 'active', 'archived'] as const;
export const PRODUCT_KIND = ['simple', 'bundle'] as const;
export const STOCK_REASON = ['sale', 'restock', 'return', 'adjustment', 'cancel'] as const;
export const DISCOUNT_METHOD = ['code', 'automatic'] as const;
export const DISCOUNT_TYPE = ['percentage', 'fixed_amount', 'free_shipping', 'buy_x_get_y', 'tiered'] as const;
export const DISCOUNT_APPLIES_TO = ['order', 'products', 'collections'] as const;
export const CART_STATUS = ['active', 'converted', 'abandoned'] as const;
export const ORDER_STATUS = ['open', 'completed', 'cancelled'] as const;
export const PAYMENT_STATUS = ['pending', 'authorized', 'paid', 'partially_refunded', 'refunded', 'failed'] as const;
export const FULFILLMENT_STATUS = ['unfulfilled', 'partial', 'fulfilled', 'returned'] as const;
/** COD orders are usually confirmed by phone / WhatsApp before dispatch */
export const CONFIRMATION_STATUS = ['not_required', 'pending', 'confirmed', 'unreachable', 'rejected'] as const;
export const ACTOR_TYPE = ['system', 'staff', 'customer'] as const;
export const TXN_STATUS = ['pending', 'authorized', 'succeeded', 'failed', 'cancelled'] as const;
export const REFUND_STATUS = ['pending', 'processed', 'failed'] as const;
export const RATE_TYPE = ['flat', 'weight', 'subtotal'] as const;
export const SHIPMENT_STATUS = [
  'pending',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'failed',
  'returned',
] as const;
export const REVIEW_STATUS = ['pending', 'approved', 'rejected'] as const;

/* ------------------------------------------------------------------ */
/* JSON shapes                                                         */
/* ------------------------------------------------------------------ */

export type Address = {
  fullName: string;
  phone: string;
  address1: string;
  address2?: string;
  area?: string;
  city: string;
  province?: string;
  postalCode?: string;
  country: string; // ISO-2, 'PK'
};

/** One block on a page: {type:'hero', settings:{...}} - rendered by the theme's section registry */
export type PageSection = { id: string; type: string; isVisible?: boolean; settings: Record<string, unknown> };
export type MenuItem = { label: string; url: string; children?: MenuItem[] };

/* ================================================================== */
/* 1. PLATFORM LEVEL                                                   */
/* ================================================================== */

export const plans = pgTable(
  'plans',
  {
    id: pk(),
    code: text('code').notNull().unique(), // 'starter', 'growth'
    name: text('name').notNull(),
    priceMonthly: money('price_monthly').notNull(), // PKR
    limits: jsonb('limits').$type<Record<string, number>>().notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [check('plans_price_chk', sql`${t.priceMonthly} >= 0`)],
);

/** Merchants and their staff (NOT shoppers - those are "customers") */
export const users = pgTable('users', {
  id: pk(),
  email: citext('email').notNull().unique(),
  passwordHash: text('password_hash'), // null for magic-link / OAuth
  fullName: text('full_name'),
  phone: text('phone'),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  lastLoginAt: ts('last_login_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A store IS the tenant */
export const stores = pgTable(
  'stores',
  {
    id: pk(),
    slug: text('slug').notNull().unique(), // mystore -> mystore.yourplatform.pk
    name: text('name').notNull(),
    status: text('status', { enum: STORE_STATUS }).notNull().default('trial'),
    planId: idRef('plan_id').references(() => plans.id),
    ownerUserId: idRef('owner_user_id').references(() => users.id),
    currency: char('currency', { length: 3 }).notNull().default('PKR'),
    locale: text('locale').notNull().default('en'),
    timezone: text('timezone').notNull().default('Asia/Karachi'),
    logoUrl: text('logo_url'),
    faviconUrl: text('favicon_url'),
    contact: jsonb('contact')
      .$type<{ phone?: string; whatsapp?: string; email?: string; address?: string; social?: Record<string, string> }>()
      .notNull()
      .default({}),
    /** guest checkout, require phone, COD on/off, etc. */
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    trialEndsAt: ts('trial_ends_at'),
    currentPeriodEnd: ts('current_period_end'), // subscription paid until
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('stores_slug_chk', sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,40}$'`),
    check('stores_status_chk', inList(t.status, STORE_STATUS)),
    index('stores_owner').on(t.ownerUserId),
    index('stores_status_period').on(t.status, t.currentPeriodEnd), // billing jobs
  ],
);

export const storeMembers = pgTable(
  'store_members',
  {
    storeId: bigint('store_id', { mode: 'number' })
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: MEMBER_ROLE }).notNull(),
    permissions: jsonb('permissions').$type<Record<string, boolean>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.userId] }),
    check('store_members_role_chk', inList(t.role, MEMBER_ROLE)),
    index('store_members_user').on(t.userId),
  ],
);

/** What you bill the stores (your PKR 6,000/month) */
export const billingInvoices = pgTable(
  'billing_invoices',
  {
    id: pk(),
    storeId: storeRef(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    amount: money('amount').notNull(),
    status: text('status', { enum: INVOICE_STATUS }).notNull().default('open'),
    provider: text('provider'),
    providerReference: text('provider_reference'),
    paidAt: ts('paid_at'),
    createdAt: createdAt(),
  },
  (t) => [
    check('billing_invoices_amount_chk', sql`${t.amount} >= 0`),
    check('billing_invoices_status_chk', inList(t.status, INVOICE_STATUS)),
    index('billing_invoices_store').on(t.storeId, t.periodStart.desc()),
  ],
);

/** Hostname -> store. THE hottest lookup in the system (cache it in KV). */
export const storeDomains = pgTable(
  'store_domains',
  {
    id: pk(),
    storeId: storeRef(),
    hostname: text('hostname').notNull(), // lowercase: 'mystore.yourplatform.pk', 'www.mystore.pk'
    kind: text('kind', { enum: DOMAIN_KIND }).notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    status: text('status', { enum: DOMAIN_STATUS }).notNull().default('pending'),
    cfCustomHostnameId: text('cf_custom_hostname_id'), // Cloudflare for SaaS id
    sslStatus: text('ssl_status'),
    verifiedAt: ts('verified_at'),
    createdAt: createdAt(),
  },
  (t) => [
    check('store_domains_hostname_lower_chk', sql`${t.hostname} = lower(${t.hostname})`),
    check('store_domains_kind_chk', inList(t.kind, DOMAIN_KIND)),
    check('store_domains_status_chk', inList(t.status, DOMAIN_STATUS)),
    uniqueIndex('store_domains_hostname_key').on(t.hostname),
    uniqueIndex('store_domains_one_primary').on(t.storeId).where(sql`${t.isPrimary}`),
    index('store_domains_store').on(t.storeId),
  ],
);

/**
 * Per-store payment gateway credentials (the merchant's own JazzCash / Easypaisa account).
 * credentialsEncrypted: encrypt in the app (key in a Workers secret). Never plaintext.
 */
export const storePaymentGateways = pgTable(
  'store_payment_gateways',
  {
    storeId: storeRef(),
    provider: text('provider', { enum: PAYMENT_PROVIDER }).notNull(),
    isEnabled: boolean('is_enabled').notNull().default(false),
    mode: text('mode', { enum: GATEWAY_MODE }).notNull().default('sandbox'),
    displayName: text('display_name'),
    instructions: text('instructions'), // e.g. bank account details shown at checkout
    credentialsEncrypted: text('credentials_encrypted'),
    sortOrder: integer('sort_order').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.provider] }),
    check('store_payment_gateways_provider_chk', inList(t.provider, PAYMENT_PROVIDER)),
    check('store_payment_gateways_mode_chk', inList(t.mode, GATEWAY_MODE)),
  ],
);

/* ================================================================== */
/* 2. THEMES, PAGES, MEDIA                                             */
/* ================================================================== */

/** Platform-wide theme catalog. "code" matches a folder in your /themes directory. */
export const themes = pgTable('themes', {
  id: pk(),
  code: text('code').notNull().unique(), // 'aurora', 'minimal', 'bold'
  name: text('name').notNull(),
  version: text('version').notNull().default('1.0.0'),
  tokenSchema: jsonb('token_schema').$type<Record<string, unknown>>().notNull().default({}),
  settingsSchema: jsonb('settings_schema').$type<Record<string, unknown>>().notNull().default({}),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
});

/** One DRAFT and one PUBLISHED config per store (preview before publishing) */
export const themeConfigs = pgTable(
  'theme_configs',
  {
    id: pk(),
    storeId: storeRef(),
    themeId: bigint('theme_id', { mode: 'number' })
      .notNull()
      .references(() => themes.id),
    status: text('status', { enum: CONFIG_STATUS }).notNull(),
    /** colors, fonts, radius... (AI brand-matching writes here; validate against themes.tokenSchema) */
    tokens: jsonb('tokens').$type<Record<string, string>>().notNull().default({}),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    customCss: text('custom_css'), // optional, sanitised, premium feature
    version: integer('version').notNull().default(1),
    publishedAt: ts('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('theme_configs_store_status_key').on(t.storeId, t.status),
    check('theme_configs_status_chk', inList(t.status, CONFIG_STATUS)),
  ],
);

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: pk(),
    storeId: storeRef(),
    r2Key: text('r2_key').notNull(), // object key in R2
    filename: text('filename'),
    mimeType: text('mime_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    width: integer('width'),
    height: integer('height'),
    altText: text('alt_text'),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.storeId, t.id),
    unique().on(t.storeId, t.r2Key),
    index('media_assets_store_created').on(t.storeId, t.createdAt.desc()),
  ],
);

/**
 * Pages keep their section list as JSON: ONE row read renders a whole page.
 * sections = published version, draftSections = unpublished edits.
 */
export const pages = pgTable(
  'pages',
  {
    id: pk(),
    storeId: storeRef(),
    handle: citext('handle').notNull(), // url slug
    type: text('type', { enum: PAGE_TYPE }).notNull().default('page'),
    title: text('title').notNull(),
    sections: jsonb('sections').$type<PageSection[]>().notNull().default([]),
    draftSections: jsonb('draft_sections').$type<PageSection[]>(),
    seo: jsonb('seo').$type<{ title?: string; description?: string; image?: string }>().notNull().default({}),
    status: text('status', { enum: CONFIG_STATUS }).notNull().default('draft'),
    publishedAt: ts('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.storeId, t.id),
    unique().on(t.storeId, t.handle),
    uniqueIndex('pages_one_home').on(t.storeId).where(sql`${t.type} = 'home'`),
    check('pages_type_chk', inList(t.type, PAGE_TYPE)),
    check('pages_status_chk', inList(t.status, CONFIG_STATUS)),
  ],
);

export const menus = pgTable(
  'menus',
  {
    id: pk(),
    storeId: storeRef(),
    handle: citext('handle').notNull(), // 'main', 'footer'
    items: jsonb('items').$type<MenuItem[]>().notNull().default([]),
    updatedAt: updatedAt(),
  },
  (t) => [unique().on(t.storeId, t.handle)],
);

/* ================================================================== */
/* 3. CATALOG                                                          */
/* ================================================================== */

export const collections = pgTable(
  'collections',
  {
    id: pk(),
    storeId: storeRef(),
    handle: citext('handle').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    imageId: idRef('image_id'), // FK in custom SQL (set null)
    type: text('type', { enum: COLLECTION_TYPE }).notNull().default('manual'),
    /** smart collections: e.g. {"tag":"summer","priceLt":3000} */
    rules: jsonb('rules').$type<Record<string, unknown>>().notNull().default({}),
    sortOrder: text('sort_order', { enum: COLLECTION_SORT }).notNull().default('manual'),
    isVisible: boolean('is_visible').notNull().default(true),
    seo: jsonb('seo').$type<{ title?: string; description?: string }>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.storeId, t.id),
    unique().on(t.storeId, t.handle),
    check('collections_type_chk', inList(t.type, COLLECTION_TYPE)),
    check('collections_sort_chk', inList(t.sortOrder, COLLECTION_SORT)),
  ],
);

export const products = pgTable(
  'products',
  {
    id: pk(),
    storeId: storeRef(),
    handle: citext('handle').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status', { enum: PRODUCT_STATUS }).notNull().default('draft'),
    kind: text('kind', { enum: PRODUCT_KIND }).notNull().default('simple'),
    vendor: text('vendor'),
    productType: text('product_type'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    // denormalised for fast product grids (keep in sync when variants change)
    priceMin: money('price_min'),
    priceMax: money('price_max'),
    compareAtMax: money('compare_at_max'),
    featuredMediaId: idRef('featured_media_id'), // FK in custom SQL (set null)
    ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }).notNull().default('0'),
    ratingCount: integer('rating_count').notNull().default(0),
    soldCount: integer('sold_count').notNull().default(0), // for "best selling" sort
    seo: jsonb('seo').$type<{ title?: string; description?: string }>().notNull().default({}),
    /** Full-text search vector, generated by Postgres - never written by the app */
    search: tsvector('search').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(vendor,'') || ' ' || coalesce(product_type,''))`,
    ),
    publishedAt: ts('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.storeId, t.id),
    unique().on(t.storeId, t.handle),
    check('products_status_chk', inList(t.status, PRODUCT_STATUS)),
    check('products_kind_chk', inList(t.kind, PRODUCT_KIND)),
    // storefront listings: partial indexes keep them small (active products only)
    index('products_active_newest')
      .on(t.storeId, t.publishedAt.desc())
      .where(sql`${t.status} = 'active'`),
    index('products_active_price')
      .on(t.storeId, t.priceMin)
      .where(sql`${t.status} = 'active'`),
    index('products_active_sold')
      .on(t.storeId, t.soldCount.desc())
      .where(sql`${t.status} = 'active'`),
    index('products_admin_list').on(t.storeId, t.status, t.updatedAt.desc()),
    index('products_search_gin').using('gin', t.search),
    index('products_title_trgm').using('gin', t.title.op('gin_trgm_ops')),
    index('products_tags_gin').using('gin', t.tags),
  ],
);

/** Up to 3 options per product (Size, Color, ...) */
export const productOptions = pgTable(
  'product_options',
  {
    id: pk(),
    storeId: storeCol(),
    productId: idRef('product_id').notNull(),
    name: text('name').notNull(),
    position: smallint('position').notNull(),
    values: text('values').array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [
    unique().on(t.productId, t.position),
    check('product_options_position_chk', sql`${t.position} between 1 and 3`),
    tenantFk('fk_product_options_product', [t.storeId, t.productId], [products.storeId, products.id]),
    index('product_options_product').on(t.storeId, t.productId),
  ],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: pk(),
    storeId: storeCol(),
    productId: idRef('product_id').notNull(),
    title: text('title').notNull().default('Default'),
    sku: text('sku'),
    barcode: text('barcode'),
    option1: text('option1'),
    option2: text('option2'),
    option3: text('option3'),
    price: money('price').notNull(),
    compareAtPrice: money('compare_at_price'),
    cost: money('cost'),
    weightGrams: integer('weight_grams'),
    position: integer('position').notNull().default(1),
    trackInventory: boolean('track_inventory').notNull().default(true),
    allowBackorder: boolean('allow_backorder').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    mediaId: idRef('media_id'), // FK in custom SQL (set null)
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.storeId, t.id),
    unique().on(t.storeId, t.sku), // NULL skus are allowed many times
    check('product_variants_price_chk', sql`${t.price} >= 0`),
    check('product_variants_compare_chk', sql`${t.compareAtPrice} >= 0`),
    check('product_variants_cost_chk', sql`${t.cost} >= 0`),
    check('product_variants_weight_chk', sql`${t.weightGrams} >= 0`),
    tenantFk('fk_variants_product', [t.storeId, t.productId], [products.storeId, products.id]),
    index('product_variants_product').on(t.storeId, t.productId, t.position),
  ],
);

export const productMedia = pgTable(
  'product_media',
  {
    storeId: storeCol(),
    productId: idRef('product_id').notNull(),
    mediaId: idRef('media_id').notNull(),
    position: integer('position').notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.mediaId] }),
    tenantFk('fk_product_media_product', [t.storeId, t.productId], [products.storeId, products.id]),
    tenantFk('fk_product_media_media', [t.storeId, t.mediaId], [mediaAssets.storeId, mediaAssets.id]),
    index('product_media_order').on(t.storeId, t.productId, t.position),
  ],
);

export const collectionProducts = pgTable(
  'collection_products',
  {
    storeId: storeCol(),
    collectionId: idRef('collection_id').notNull(),
    productId: idRef('product_id').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.productId] }),
    tenantFk('fk_collection_products_collection', [t.storeId, t.collectionId], [collections.storeId, collections.id]),
    tenantFk('fk_collection_products_product', [t.storeId, t.productId], [products.storeId, products.id]),
    index('collection_products_order').on(t.storeId, t.collectionId, t.position),
    index('collection_products_product').on(t.storeId, t.productId),
  ],
);

/**
 * Current stock per variant (single location to start).
 * Always decrement atomically:
 *   UPDATE inventory_levels SET on_hand = on_hand - $qty
 *   WHERE store_id=$1 AND variant_id=$2 AND (on_hand >= $qty OR <backorder allowed>)
 */
export const inventoryLevels = pgTable(
  'inventory_levels',
  {
    variantId: bigint('variant_id', { mode: 'number' }).primaryKey(),
    storeId: storeCol(),
    onHand: integer('on_hand').notNull().default(0),
    reserved: integer('reserved').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('inventory_levels_reserved_chk', sql`${t.reserved} >= 0`),
    tenantFk('fk_inventory_levels_variant', [t.storeId, t.variantId], [productVariants.storeId, productVariants.id]),
    index('inventory_levels_store').on(t.storeId),
  ],
);

/** Audit trail of every stock change */
export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: pk(),
    storeId: storeCol(),
    variantId: idRef('variant_id').notNull(),
    delta: integer('delta').notNull(),
    reason: text('reason', { enum: STOCK_REASON }).notNull(),
    orderId: idRef('order_id'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    check('inventory_movements_reason_chk', inList(t.reason, STOCK_REASON)),
    tenantFk('fk_inventory_movements_variant', [t.storeId, t.variantId], [productVariants.storeId, productVariants.id]),
    index('inventory_movements_variant').on(t.storeId, t.variantId, t.createdAt.desc()),
  ],
);

/**
 * A bundle is a product with kind='bundle'. Its components live here.
 * The bundle's own variant price IS the bundle price.
 */
export const bundleItems = pgTable(
  'bundle_items',
  {
    storeId: storeCol(),
    bundleProductId: idRef('bundle_product_id').notNull(),
    variantId: idRef('variant_id').notNull(), // component variant
    quantity: integer('quantity').notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.bundleProductId, t.variantId] }),
    check('bundle_items_quantity_chk', sql`${t.quantity} > 0`),
    tenantFk('fk_bundle_items_product', [t.storeId, t.bundleProductId], [products.storeId, products.id]),
    tenantFk('fk_bundle_items_variant', [t.storeId, t.variantId], [productVariants.storeId, productVariants.id]),
    index('bundle_items_variant').on(t.storeId, t.variantId),
  ],
);

/* ================================================================== */
/* 4. CUSTOMERS (shoppers, scoped to ONE store)                        */
/* ================================================================== */

export const customers = pgTable(
  'customers',
  {
    id: pk(),
    storeId: storeRef(),
    email: citext('email'),
    phone: text('phone'), // E.164, e.g. +923001234567 - often the main identifier in PK
    firstName: text('first_name'),
    lastName: text('last_name'),
    passwordHash: text('password_hash'), // null = guest / phone-only customer
    acceptsMarketing: boolean('accepts_marketing').notNull().default(false),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    ordersCount: integer('orders_count').notNull().default(0), // denormalised
    totalSpent: numeric('total_spent', { precision: 14, scale: 2 }).notNull().default('0'), // denormalised
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.storeId, t.id),
    check('customers_contact_chk', sql`${t.email} is not null or ${t.phone} is not null`),
    uniqueIndex('customers_store_email').on(t.storeId, t.email).where(sql`${t.email} is not null`),
    uniqueIndex('customers_store_phone').on(t.storeId, t.phone).where(sql`${t.phone} is not null`),
    index('customers_store_created').on(t.storeId, t.createdAt.desc()),
  ],
);

export const customerAddresses = pgTable(
  'customer_addresses',
  {
    id: pk(),
    storeId: storeCol(),
    customerId: idRef('customer_id').notNull(),
    fullName: text('full_name').notNull(),
    phone: text('phone').notNull(),
    address1: text('address1').notNull(),
    address2: text('address2'),
    area: text('area'),
    city: text('city').notNull(),
    province: text('province'),
    postalCode: text('postal_code'),
    country: char('country', { length: 2 }).notNull().default('PK'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    tenantFk('fk_customer_addresses_customer', [t.storeId, t.customerId], [customers.storeId, customers.id]),
    index('customer_addresses_customer').on(t.storeId, t.customerId),
    uniqueIndex('customer_addresses_one_default').on(t.customerId).where(sql`${t.isDefault}`),
  ],
);

/* ================================================================== */
/* 5. DISCOUNTS & COUPONS                                              */
/* ================================================================== */

export const discounts = pgTable(
  'discounts',
  {
    id: pk(),
    storeId: storeRef(),
    title: text('title').notNull(),
    method: text('method', { enum: DISCOUNT_METHOD }).notNull(),
    code: citext('code'),
    type: text('type', { enum: DISCOUNT_TYPE }).notNull(),
    value: money('value').notNull().default('0'), // % or PKR depending on type
    /** buy_x_get_y / tier definitions, e.g. {"buy":2,"get":1} */
    rules: jsonb('rules').$type<Record<string, unknown>>().notNull().default({}),
    appliesTo: text('applies_to', { enum: DISCOUNT_APPLIES_TO }).notNull().default('order'),
    minSubtotal: money('min_subtotal'),
    minQuantity: integer('min_quantity'),
    usageLimit: integer('usage_limit'),
    usageCount: integer('usage_count').notNull().default(0),
    oncePerCustomer: boolean('once_per_customer').notNull().default(false),
    combinable: boolean('combinable').notNull().default(false),
    startsAt: ts('starts_at'),
    endsAt: ts('ends_at'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.storeId, t.id),
    unique().on(t.storeId, t.code),
    check('discounts_value_chk', sql`${t.value} >= 0`),
    check('discounts_code_method_chk', sql`(${t.method} = 'code') = (${t.code} is not null)`),
    check('discounts_method_chk', inList(t.method, DISCOUNT_METHOD)),
    check('discounts_type_chk', inList(t.type, DISCOUNT_TYPE)),
    check('discounts_applies_chk', inList(t.appliesTo, DISCOUNT_APPLIES_TO)),
    index('discounts_active_auto')
      .on(t.storeId)
      .where(sql`${t.isActive} and ${t.method} = 'automatic'`),
  ],
);

export const discountTargets = pgTable(
  'discount_targets',
  {
    id: pk(),
    storeId: storeCol(),
    discountId: idRef('discount_id').notNull(),
    productId: idRef('product_id'),
    collectionId: idRef('collection_id'),
  },
  (t) => [
    check('discount_targets_one_chk', sql`num_nonnulls(${t.productId}, ${t.collectionId}) = 1`),
    tenantFk('fk_discount_targets_discount', [t.storeId, t.discountId], [discounts.storeId, discounts.id]),
    tenantFk('fk_discount_targets_product', [t.storeId, t.productId], [products.storeId, products.id]),
    tenantFk('fk_discount_targets_collection', [t.storeId, t.collectionId], [collections.storeId, collections.id]),
    index('discount_targets_discount').on(t.storeId, t.discountId),
  ],
);

/* ================================================================== */
/* 6. CARTS (created lazily on first "add to cart"; abandoned-cart recovery) */
/* ================================================================== */

export const carts = pgTable(
  'carts',
  {
    id: pk(),
    storeId: storeRef(),
    token: uuid('token').notNull().defaultRandom().unique(), // stored in the shopper's cookie
    customerId: idRef('customer_id'), // FK in custom SQL (set null)
    email: citext('email'),
    phone: text('phone'),
    status: text('status', { enum: CART_STATUS }).notNull().default('active'),
    discountCodes: text('discount_codes').array().notNull().default(sql`'{}'::text[]`),
    utm: jsonb('utm').$type<Record<string, string>>(),
    expiresAt: ts('expires_at').notNull().default(sql`now() + interval '30 days'`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.storeId, t.id),
    check('carts_status_chk', inList(t.status, CART_STATUS)),
    index('carts_abandoned_scan')
      .on(t.storeId, t.updatedAt)
      .where(sql`${t.status} = 'active'`),
  ],
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: pk(),
    storeId: storeCol(),
    cartId: idRef('cart_id').notNull(),
    variantId: idRef('variant_id').notNull(),
    quantity: integer('quantity').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.cartId, t.variantId),
    check('cart_items_quantity_chk', sql`${t.quantity} > 0`),
    tenantFk('fk_cart_items_cart', [t.storeId, t.cartId], [carts.storeId, carts.id]),
    tenantFk('fk_cart_items_variant', [t.storeId, t.variantId], [productVariants.storeId, productVariants.id]),
    index('cart_items_cart').on(t.storeId, t.cartId),
  ],
);

/* ================================================================== */
/* 7. ORDERS                                                           */
/* ================================================================== */

/**
 * Per-store order numbers (#1001, #1002 ...), incremented atomically:
 *   INSERT INTO order_counters (store_id) VALUES ($1)
 *   ON CONFLICT (store_id) DO UPDATE SET last_number = order_counters.last_number + 1
 *   RETURNING last_number;
 */
export const orderCounters = pgTable('order_counters', {
  storeId: bigint('store_id', { mode: 'number' })
    .primaryKey()
    .references(() => stores.id, { onDelete: 'cascade' }),
  lastNumber: integer('last_number').notNull().default(1001),
});

export const orders = pgTable(
  'orders',
  {
    id: pk(),
    storeId: storeRef(),
    orderNumber: integer('order_number').notNull(),
    publicToken: uuid('public_token').notNull().defaultRandom().unique(), // order-tracking link
    customerId: idRef('customer_id'), // FK in custom SQL (set null)
    email: citext('email'),
    phone: text('phone').notNull(),
    status: text('status', { enum: ORDER_STATUS }).notNull().default('open'),
    paymentStatus: text('payment_status', { enum: PAYMENT_STATUS }).notNull().default('pending'),
    fulfillmentStatus: text('fulfillment_status', { enum: FULFILLMENT_STATUS }).notNull().default('unfulfilled'),
    confirmationStatus: text('confirmation_status', { enum: CONFIRMATION_STATUS }).notNull().default('not_required'),
    paymentMethod: text('payment_method', { enum: PAYMENT_PROVIDER }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('PKR'),
    subtotal: money('subtotal').notNull().default('0'),
    discountTotal: money('discount_total').notNull().default('0'),
    shippingTotal: money('shipping_total').notNull().default('0'),
    taxTotal: money('tax_total').notNull().default('0'),
    total: money('total').notNull().default('0'),
    shippingAddress: jsonb('shipping_address').$type<Address>().notNull(), // snapshot at purchase time
    billingAddress: jsonb('billing_address').$type<Address>(),
    customerNote: text('customer_note'),
    internalNote: text('internal_note'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    channel: text('channel').notNull().default('web'), // web, whatsapp, instagram, manual
    utm: jsonb('utm').$type<Record<string, string>>(),
    placedAt: ts('placed_at').notNull().defaultNow(),
    cancelledAt: ts('cancelled_at'),
    cancelReason: text('cancel_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.storeId, t.id),
    unique().on(t.storeId, t.orderNumber),
    check('orders_status_chk', inList(t.status, ORDER_STATUS)),
    check('orders_payment_status_chk', inList(t.paymentStatus, PAYMENT_STATUS)),
    check('orders_fulfillment_chk', inList(t.fulfillmentStatus, FULFILLMENT_STATUS)),
    check('orders_confirmation_chk', inList(t.confirmationStatus, CONFIRMATION_STATUS)),
    check('orders_method_chk', inList(t.paymentMethod, PAYMENT_PROVIDER)),
    check('orders_subtotal_chk', sql`${t.subtotal} >= 0`),
    check('orders_discount_chk', sql`${t.discountTotal} >= 0`),
    check('orders_shipping_chk', sql`${t.shippingTotal} >= 0`),
    check('orders_tax_chk', sql`${t.taxTotal} >= 0`),
    check('orders_total_chk', sql`${t.total} >= 0`),
    index('orders_store_placed').on(t.storeId, t.placedAt.desc()), // dashboard list
    index('orders_store_status').on(t.storeId, t.status, t.placedAt.desc()),
    index('orders_store_customer').on(t.storeId, t.customerId, t.placedAt.desc()),
    index('orders_store_phone').on(t.storeId, t.phone), // search by phone
    index('orders_needs_confirm')
      .on(t.storeId, t.placedAt.desc())
      .where(sql`${t.confirmationStatus} = 'pending'`),
    index('orders_unfulfilled')
      .on(t.storeId, t.placedAt.desc())
      .where(sql`${t.status} = 'open' and ${t.fulfillmentStatus} = 'unfulfilled'`),
  ],
);

/**
 * Lines are snapshots; productId / variantId are soft references (no FK) so
 * deleting a product never touches order history.
 */
export const orderItems = pgTable(
  'order_items',
  {
    id: pk(),
    storeId: storeCol(),
    orderId: idRef('order_id').notNull(),
    productId: idRef('product_id'),
    variantId: idRef('variant_id'),
    title: text('title').notNull(),
    variantTitle: text('variant_title'),
    sku: text('sku'),
    imageUrl: text('image_url'),
    quantity: integer('quantity').notNull(),
    unitPrice: money('unit_price').notNull(),
    compareAtPrice: money('compare_at_price'),
    discountTotal: money('discount_total').notNull().default('0'),
    total: money('total').notNull(),
    /** bundle components, custom text, etc. */
    properties: jsonb('properties').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    unique().on(t.storeId, t.id),
    check('order_items_quantity_chk', sql`${t.quantity} > 0`),
    check('order_items_price_chk', sql`${t.unitPrice} >= 0`),
    check('order_items_total_chk', sql`${t.total} >= 0`),
    tenantFk('fk_order_items_order', [t.storeId, t.orderId], [orders.storeId, orders.id]),
    index('order_items_order').on(t.storeId, t.orderId),
    index('order_items_variant').on(t.storeId, t.variantId),
  ],
);

/** Timeline: "placed", "confirmed via WhatsApp", "shipped", "refunded" ... */
export const orderEvents = pgTable(
  'order_events',
  {
    id: pk(),
    storeId: storeCol(),
    orderId: idRef('order_id').notNull(),
    type: text('type').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    actorType: text('actor_type', { enum: ACTOR_TYPE }).notNull().default('system'),
    actorId: idRef('actor_id'),
    createdAt: createdAt(),
  },
  (t) => [
    check('order_events_actor_chk', inList(t.actorType, ACTOR_TYPE)),
    tenantFk('fk_order_events_order', [t.storeId, t.orderId], [orders.storeId, orders.id]),
    index('order_events_order').on(t.storeId, t.orderId, t.createdAt),
  ],
);

export const discountRedemptions = pgTable(
  'discount_redemptions',
  {
    id: pk(),
    storeId: storeCol(),
    discountId: idRef('discount_id').notNull(),
    orderId: idRef('order_id').notNull(),
    customerId: idRef('customer_id'), // FK in custom SQL (set null)
    amount: money('amount').notNull().default('0'),
    createdAt: createdAt(),
  },
  (t) => [
    tenantFk('fk_redemptions_discount', [t.storeId, t.discountId], [discounts.storeId, discounts.id]),
    tenantFk('fk_redemptions_order', [t.storeId, t.orderId], [orders.storeId, orders.id]),
    index('discount_redemptions_discount').on(t.storeId, t.discountId),
    index('discount_redemptions_customer').on(t.storeId, t.discountId, t.customerId),
  ],
);

/* ================================================================== */
/* 8. PAYMENTS & REFUNDS                                               */
/* ================================================================== */

export const payments = pgTable(
  'payments',
  {
    id: pk(),
    storeId: storeCol(),
    orderId: idRef('order_id').notNull(),
    provider: text('provider', { enum: PAYMENT_PROVIDER }).notNull(),
    status: text('status', { enum: TXN_STATUS }).notNull().default('pending'),
    amount: money('amount').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('PKR'),
    providerReference: text('provider_reference'), // the txn reference WE send to the gateway
    idempotencyKey: text('idempotency_key'),
    providerPayload: jsonb('provider_payload').$type<Record<string, unknown>>(), // raw gateway response
    failureReason: text('failure_reason'),
    paidAt: ts('paid_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.storeId, t.id),
    unique().on(t.storeId, t.idempotencyKey),
    check('payments_provider_chk', inList(t.provider, PAYMENT_PROVIDER)),
    check('payments_status_chk', inList(t.status, TXN_STATUS)),
    check('payments_amount_chk', sql`${t.amount} >= 0`),
    tenantFk('fk_payments_order', [t.storeId, t.orderId], [orders.storeId, orders.id]),
    // gateway callbacks arrive WITHOUT knowing the store, so this one is global
    uniqueIndex('payments_provider_ref')
      .on(t.provider, t.providerReference)
      .where(sql`${t.providerReference} is not null`),
    index('payments_order').on(t.storeId, t.orderId),
  ],
);

export const refunds = pgTable(
  'refunds',
  {
    id: pk(),
    storeId: storeCol(),
    orderId: idRef('order_id').notNull(),
    paymentId: idRef('payment_id'), // FK in custom SQL (set null)
    amount: money('amount').notNull(),
    reason: text('reason'),
    status: text('status', { enum: REFUND_STATUS }).notNull().default('pending'),
    createdAt: createdAt(),
  },
  (t) => [
    check('refunds_amount_chk', sql`${t.amount} > 0`),
    check('refunds_status_chk', inList(t.status, REFUND_STATUS)),
    tenantFk('fk_refunds_order', [t.storeId, t.orderId], [orders.storeId, orders.id]),
    index('refunds_order').on(t.storeId, t.orderId),
  ],
);

/* ================================================================== */
/* 9. SHIPPING                                                         */
/* ================================================================== */

export const shippingZones = pgTable(
  'shipping_zones',
  {
    id: pk(),
    storeId: storeRef(),
    name: text('name').notNull(),
    provinces: text('provinces').array(), // NULL = all provinces
    cities: text('cities').array(), // NULL = all cities
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [unique().on(t.storeId, t.id)],
);

export const shippingRates = pgTable(
  'shipping_rates',
  {
    id: pk(),
    storeId: storeCol(),
    zoneId: idRef('zone_id').notNull(),
    name: text('name').notNull(),
    rateType: text('rate_type', { enum: RATE_TYPE }).notNull().default('flat'),
    price: money('price').notNull().default('0'),
    minValue: money('min_value'), // weight (g) or subtotal range
    maxValue: money('max_value'),
    freeOver: money('free_over'),
    estDaysMin: integer('est_days_min'),
    estDaysMax: integer('est_days_max'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    check('shipping_rates_type_chk', inList(t.rateType, RATE_TYPE)),
    check('shipping_rates_price_chk', sql`${t.price} >= 0`),
    tenantFk('fk_shipping_rates_zone', [t.storeId, t.zoneId], [shippingZones.storeId, shippingZones.id]),
    index('shipping_rates_zone').on(t.storeId, t.zoneId),
  ],
);

/** Courier APIs come later: "courier" + tracking number already work for manual entry */
export const shipments = pgTable(
  'shipments',
  {
    id: pk(),
    storeId: storeCol(),
    orderId: idRef('order_id').notNull(),
    courier: text('courier').notNull().default('manual'), // tcs, leopards, trax, postex, manual ...
    trackingNumber: text('tracking_number'),
    trackingUrl: text('tracking_url'),
    status: text('status', { enum: SHIPMENT_STATUS }).notNull().default('pending'),
    codAmount: money('cod_amount'),
    shippedAt: ts('shipped_at'),
    deliveredAt: ts('delivered_at'),
    courierPayload: jsonb('courier_payload').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.storeId, t.id),
    check('shipments_status_chk', inList(t.status, SHIPMENT_STATUS)),
    tenantFk('fk_shipments_order', [t.storeId, t.orderId], [orders.storeId, orders.id]),
    index('shipments_order').on(t.storeId, t.orderId),
    index('shipments_tracking').on(t.courier, t.trackingNumber),
  ],
);

export const shipmentItems = pgTable(
  'shipment_items',
  {
    storeId: storeCol(),
    shipmentId: idRef('shipment_id').notNull(),
    orderItemId: idRef('order_item_id').notNull(),
    quantity: integer('quantity').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.shipmentId, t.orderItemId] }),
    check('shipment_items_quantity_chk', sql`${t.quantity} > 0`),
    tenantFk('fk_shipment_items_shipment', [t.storeId, t.shipmentId], [shipments.storeId, shipments.id]),
    tenantFk('fk_shipment_items_order_item', [t.storeId, t.orderItemId], [orderItems.storeId, orderItems.id]),
  ],
);

/* ================================================================== */
/* 10. REVIEWS                                                         */
/* ================================================================== */

export const reviews = pgTable(
  'reviews',
  {
    id: pk(),
    storeId: storeCol(),
    productId: idRef('product_id').notNull(),
    customerId: idRef('customer_id'), // FK in custom SQL (set null)
    orderId: idRef('order_id'), // FK in custom SQL (set null); set = "verified purchase"
    authorName: text('author_name').notNull(),
    rating: smallint('rating').notNull(),
    title: text('title'),
    body: text('body'),
    media: jsonb('media').$type<string[]>().notNull().default([]),
    status: text('status', { enum: REVIEW_STATUS }).notNull().default('pending'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('reviews_rating_chk', sql`${t.rating} between 1 and 5`),
    check('reviews_status_chk', inList(t.status, REVIEW_STATUS)),
    tenantFk('fk_reviews_product', [t.storeId, t.productId], [products.storeId, products.id]),
    index('reviews_product_approved')
      .on(t.storeId, t.productId, t.createdAt.desc())
      .where(sql`${t.status} = 'approved'`),
    index('reviews_moderation')
      .on(t.storeId, t.createdAt.desc())
      .where(sql`${t.status} = 'pending'`),
  ],
);

/* ================================================================== */
/* 11. OPERATIONAL                                                     */
/* ================================================================== */

/** Idempotency for gateway callbacks (JazzCash / Easypaisa send retries) */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: pk(),
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    storeId: idRef('store_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
    processedAt: ts('processed_at'),
  },
  (t) => [unique().on(t.provider, t.eventId)],
);

/**
 * Rolled-up numbers so dashboards never scan the orders table. A background job
 * fills it; visits come from Cloudflare analytics, not from Postgres.
 */
export const storeDailyStats = pgTable(
  'store_daily_stats',
  {
    storeId: bigint('store_id', { mode: 'number' })
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    ordersCount: integer('orders_count').notNull().default(0),
    revenue: numeric('revenue', { precision: 14, scale: 2 }).notNull().default('0'),
    itemsSold: integer('items_sold').notNull().default(0),
    newCustomers: integer('new_customers').notNull().default(0),
    visits: integer('visits').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.day] })],
);

/* ------------------------------------------------------------------ */
/* Inferred row types                                                  */
/* ------------------------------------------------------------------ */
export type Store = typeof stores.$inferSelect;
export type NewStore = typeof stores.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductVariant = typeof productVariants.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
