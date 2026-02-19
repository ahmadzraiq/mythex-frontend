import { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { GluestackUIProvider } from '@/components/ui/gluestack-ui-provider';
import StyledJsxRegistry from './registry';
import { StoreProvider } from '@/store/StoreProvider';
import { ThemeProvider } from '@/lib/ThemeProvider';
import themeConfig from '@/config/theme.json';

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
<StoreProvider>
            <StyledJsxRegistry>
              <GluestackUIProvider mode="light">
                <ThemeProvider theme={themeConfig}>
                <div className="min-h-screen w-full overflow-auto bg-gray-50">
                {children}
              </div>
                </ThemeProvider>
            </GluestackUIProvider>
          </StyledJsxRegistry>
        </StoreProvider>
      </body>
    </html>
  );
}
