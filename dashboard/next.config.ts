import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// If your file from the previous step is saved at src/i18n/request.ts or src/i18n.ts, 
// leave the parentheses empty:
const withNextIntl = createNextIntlPlugin();

// If you saved it somewhere else (like src/app/[locale]/i18n.ts), 
// you must provide the exact path like this:
// const withNextIntl = createNextIntlPlugin("./src/app/[locale]/i18n.ts");

const nextConfig: NextConfig = {
  /* config options here */
};

export default withNextIntl(nextConfig);