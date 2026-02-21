import { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { GluestackUIProvider } from '@/components/ui/gluestack-ui-provider';
import StyledJsxRegistry from './registry';
import { ThemeStyles } from '@/lib/ThemeStyles';
import { Toaster } from 'sonner';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'Vendure Store',
    template: '%s | Vendure Store',
  },
  description: 'Shop the best products at Vendure Store. Quality products, competitive prices, and fast delivery.',
};
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        style={{ flex: 1 }}
      >
        <ThemeStyles />
        <StyledJsxRegistry>
          <GluestackUIProvider mode="system">
            <div className="min-h-screen w-full overflow-auto">
              {children}
            </div>
            <Toaster position="top-center" richColors />
          </GluestackUIProvider>
        </StyledJsxRegistry>
      </body>
    </html>
  );
}
