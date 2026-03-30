import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "../globals.css";
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PolySports — Whale Tracker",
  description: "Follow the smart money on Polymarket sports markets.",
};

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body className={`${inter.className} antialiased min-h-screen`} style={{backgroundColor: 'var(--bg)', color: 'var(--text)'}}>
        <NextIntlClientProvider messages={messages}>
          <main className="wrap py-8 md:py-14">
            {children}
          </main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
