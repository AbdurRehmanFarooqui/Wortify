import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL! },
  // Print SQL and ask before applying when you run `drizzle-kit push` (dev only)
  verbose: true,
  strict: true,
});
