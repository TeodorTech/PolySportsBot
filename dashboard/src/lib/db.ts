import postgres from 'postgres';

// Internal Railway URLs (.railway.internal) don't use SSL.
// The public proxy URL (used locally) requires it.
const isInternal = process.env.DATABASE_URL?.includes('.railway.internal');

const sql = postgres(process.env.DATABASE_URL!, {
  ssl: isInternal ? false : 'require',
  max: 1, // Next.js server actions / components are short-lived
});

export default sql;
