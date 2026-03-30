// 1. Change the import here
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

// 2. Change the function call here
export default getRequestConfig(async ({ requestLocale }) => {
  const locale = await requestLocale;

  // Ensure that a valid locale is used
  if (!locale || !routing.locales.includes(locale as typeof routing.locales[number])) {
    return {
      locale: routing.defaultLocale,
      messages: (await import(`../../messages/${routing.defaultLocale}.json`)).default
    };
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default
  };
});