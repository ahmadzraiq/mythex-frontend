import { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { GluestackUIProvider } from '@/components/ui/gluestack-ui-provider';
import StyledJsxRegistry from './registry';
import { ThemeStyles } from '@/lib/ThemeStyles';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'E-commerce App',
  description: 'Login, Signup & Dashboard',
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
          <GluestackUIProvider mode="light">
            <div className="min-h-screen w-full overflow-auto" style={{ backgroundColor: 'var(--background)' }}>
              {children}
            </div>
          </GluestackUIProvider>
        </StyledJsxRegistry>
      </body>
    </html>
  );
}
