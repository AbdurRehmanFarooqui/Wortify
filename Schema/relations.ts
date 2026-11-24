/**
 * Relations for Drizzle's relational query API (db.query.products.findFirst({ with: {...} })).
 * They are separate from the database foreign keys. Child -> parent links use the
 * COMPOSITE (store_id, id) pair so a join can never cross stores.
 */
import { relations } from 'drizzle-orm';
import * as s from './schema';

/* ---------- platform ---------- */
export const storesRelations = relations(s.stores, ({ one, many }) => ({
  plan: one(s.plans, { fields: [s.stores.planId], references: [s.plans.id] }),
  owner: one(s.users, { fields: [s.stores.ownerUserId], references: [s.users.id] }),
  domains: many(s.storeDomains),
  members: many(s.storeMembers),
  themeConfigs: many(s.themeConfigs),
  paymentGateways: many(s.storePaymentGateways),
}));

export const storeDomainsRelations = relations(s.storeDomains, ({ one }) => ({
  store: one(s.stores, { fields: [s.storeDomains.storeId], references: [s.stores.id] }),
}));

export const storeMembersRelations = relations(s.storeMembers, ({ one }) => ({
  store: one(s.stores, { fields: [s.storeMembers.storeId], references: [s.stores.id] }),
  user: one(s.users, { fields: [s.storeMembers.userId], references: [s.users.id] }),
}));

export const storePaymentGatewaysRelations = relations(s.storePaymentGateways, ({ one }) => ({
  store: one(s.stores, { fields: [s.storePaymentGateways.storeId], references: [s.stores.id] }),
}));

export const themeConfigsRelations = relations(s.themeConfigs, ({ one }) => ({
  store: one(s.stores, { fields: [s.themeConfigs.storeId], references: [s.stores.id] }),
  theme: one(s.themes, { fields: [s.themeConfigs.themeId], references: [s.themes.id] }),
}));

/* ---------- catalog ---------- */
export const productsRelations = relations(s.products, ({ many }) => ({
  variants: many(s.productVariants),
  options: many(s.productOptions),
  media: many(s.productMedia),
  collections: many(s.collectionProducts),
  reviews: many(s.reviews),
  bundleItems: many(s.bundleItems),
}));

export const productOptionsRelations = relations(s.productOptions, ({ one }) => ({
  product: one(s.products, {
    fields: [s.productOptions.storeId, s.productOptions.productId],
    references: [s.products.storeId, s.products.id],
  }),
}));

export const productVariantsRelations = relations(s.productVariants, ({ one }) => ({
  product: one(s.products, {
    fields: [s.productVariants.storeId, s.productVariants.productId],
    references: [s.products.storeId, s.products.id],
  }),
  inventory: one(s.inventoryLevels),
}));

export const inventoryLevelsRelations = relations(s.inventoryLevels, ({ one }) => ({
  variant: one(s.productVariants, {
    fields: [s.inventoryLevels.storeId, s.inventoryLevels.variantId],
    references: [s.productVariants.storeId, s.productVariants.id],
  }),
}));

export const productMediaRelations = relations(s.productMedia, ({ one }) => ({
  product: one(s.products, {
    fields: [s.productMedia.storeId, s.productMedia.productId],
    references: [s.products.storeId, s.products.id],
  }),
  media: one(s.mediaAssets, {
    fields: [s.productMedia.storeId, s.productMedia.mediaId],
    references: [s.mediaAssets.storeId, s.mediaAssets.id],
  }),
}));

export const collectionsRelations = relations(s.collections, ({ many }) => ({
  products: many(s.collectionProducts),
}));

export const collectionProductsRelations = relations(s.collectionProducts, ({ one }) => ({
  collection: one(s.collections, {
    fields: [s.collectionProducts.storeId, s.collectionProducts.collectionId],
    references: [s.collections.storeId, s.collections.id],
  }),
  product: one(s.products, {
    fields: [s.collectionProducts.storeId, s.collectionProducts.productId],
    references: [s.products.storeId, s.products.id],
  }),
}));

export const bundleItemsRelations = relations(s.bundleItems, ({ one }) => ({
  bundle: one(s.products, {
    fields: [s.bundleItems.storeId, s.bundleItems.bundleProductId],
    references: [s.products.storeId, s.products.id],
  }),
  variant: one(s.productVariants, {
    fields: [s.bundleItems.storeId, s.bundleItems.variantId],
    references: [s.productVariants.storeId, s.productVariants.id],
  }),
}));

/* ---------- customers & carts ---------- */
export const customersRelations = relations(s.customers, ({ many }) => ({
  addresses: many(s.customerAddresses),
  orders: many(s.orders),
}));

export const customerAddressesRelations = relations(s.customerAddresses, ({ one }) => ({
  customer: one(s.customers, {
    fields: [s.customerAddresses.storeId, s.customerAddresses.customerId],
    references: [s.customers.storeId, s.customers.id],
  }),
}));

export const cartsRelations = relations(s.carts, ({ many }) => ({
  items: many(s.cartItems),
}));

export const cartItemsRelations = relations(s.cartItems, ({ one }) => ({
  cart: one(s.carts, {
    fields: [s.cartItems.storeId, s.cartItems.cartId],
    references: [s.carts.storeId, s.carts.id],
  }),
  variant: one(s.productVariants, {
    fields: [s.cartItems.storeId, s.cartItems.variantId],
    references: [s.productVariants.storeId, s.productVariants.id],
  }),
}));

/* ---------- discounts ---------- */
export const discountsRelations = relations(s.discounts, ({ many }) => ({
  targets: many(s.discountTargets),
  redemptions: many(s.discountRedemptions),
}));

export const discountTargetsRelations = relations(s.discountTargets, ({ one }) => ({
  discount: one(s.discounts, {
    fields: [s.discountTargets.storeId, s.discountTargets.discountId],
    references: [s.discounts.storeId, s.discounts.id],
  }),
}));

export const discountRedemptionsRelations = relations(s.discountRedemptions, ({ one }) => ({
  discount: one(s.discounts, {
    fields: [s.discountRedemptions.storeId, s.discountRedemptions.discountId],
    references: [s.discounts.storeId, s.discounts.id],
  }),
  order: one(s.orders, {
    fields: [s.discountRedemptions.storeId, s.discountRedemptions.orderId],
    references: [s.orders.storeId, s.orders.id],
  }),
}));

/* ---------- orders ---------- */
export const ordersRelations = relations(s.orders, ({ one, many }) => ({
  customer: one(s.customers, {
    fields: [s.orders.storeId, s.orders.customerId],
    references: [s.customers.storeId, s.customers.id],
  }),
  items: many(s.orderItems),
  events: many(s.orderEvents),
  payments: many(s.payments),
  refunds: many(s.refunds),
  shipments: many(s.shipments),
  redemptions: many(s.discountRedemptions),
}));

export const orderItemsRelations = relations(s.orderItems, ({ one }) => ({
  order: one(s.orders, {
    fields: [s.orderItems.storeId, s.orderItems.orderId],
    references: [s.orders.storeId, s.orders.id],
  }),
}));

export const orderEventsRelations = relations(s.orderEvents, ({ one }) => ({
  order: one(s.orders, {
    fields: [s.orderEvents.storeId, s.orderEvents.orderId],
    references: [s.orders.storeId, s.orders.id],
  }),
}));

export const paymentsRelations = relations(s.payments, ({ one }) => ({
  order: one(s.orders, {
    fields: [s.payments.storeId, s.payments.orderId],
    references: [s.orders.storeId, s.orders.id],
  }),
}));

export const refundsRelations = relations(s.refunds, ({ one }) => ({
  order: one(s.orders, {
    fields: [s.refunds.storeId, s.refunds.orderId],
    references: [s.orders.storeId, s.orders.id],
  }),
}));

export const shipmentsRelations = relations(s.shipments, ({ one, many }) => ({
  order: one(s.orders, {
    fields: [s.shipments.storeId, s.shipments.orderId],
    references: [s.orders.storeId, s.orders.id],
  }),
  items: many(s.shipmentItems),
}));

export const shipmentItemsRelations = relations(s.shipmentItems, ({ one }) => ({
  shipment: one(s.shipments, {
    fields: [s.shipmentItems.storeId, s.shipmentItems.shipmentId],
    references: [s.shipments.storeId, s.shipments.id],
  }),
  orderItem: one(s.orderItems, {
    fields: [s.shipmentItems.storeId, s.shipmentItems.orderItemId],
    references: [s.orderItems.storeId, s.orderItems.id],
  }),
}));

/* ---------- shipping & reviews ---------- */
export const shippingZonesRelations = relations(s.shippingZones, ({ many }) => ({
  rates: many(s.shippingRates),
}));

export const shippingRatesRelations = relations(s.shippingRates, ({ one }) => ({
  zone: one(s.shippingZones, {
    fields: [s.shippingRates.storeId, s.shippingRates.zoneId],
    references: [s.shippingZones.storeId, s.shippingZones.id],
  }),
}));

export const reviewsRelations = relations(s.reviews, ({ one }) => ({
  product: one(s.products, {
    fields: [s.reviews.storeId, s.reviews.productId],
    references: [s.products.storeId, s.products.id],
  }),
}));
