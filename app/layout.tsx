import { Metadata } from 'next';
import {
  Geist,
  Geist_Mono,
  Inter,
  Plus_Jakarta_Sans,
  Roboto,
  Roboto_Mono,
  Space_Grotesk,
  Rajdhani,
  Oxanium,
  Rubik,
  Exo_2,
  IBM_Plex_Sans,
  Noto_Sans,
  Lato,
  Poppins,
  Montserrat,
  Playfair_Display,
  DM_Sans,
  Nunito,
} from 'next/font/google';
import './globals.css';
import { GluestackUIProvider } from '@/components/ui/gluestack-ui-provider';
import StyledJsxRegistry from './registry';
import { ThemeStyles } from '@/lib/ThemeStyles';
import { ThemePresetOverlay } from '@/lib/ThemePresetOverlay';
import { Toaster } from 'sonner';
import { Suspense } from 'react';
import { LayoutChatbot } from './components/LayoutChatbot';
import { AiResponsePreviewOverlay } from './components/AiResponsePreviewOverlay';
import { NavbarPreviewFromUrl } from './components/NavbarPreviewFromUrl';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: '--font-plus-jakarta-sans',
  subsets: ['latin'],
});

const roboto = Roboto({
  variable: '--font-roboto',
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
});

const robotoMono = Roboto_Mono({
  variable: '--font-roboto-mono',
  subsets: ['latin'],
});

const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
});

const rajdhani = Rajdhani({
  variable: '--font-rajdhani',
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
});

const oxanium = Oxanium({
  variable: '--font-oxanium',
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
});

const rubik = Rubik({
  variable: '--font-rubik',
  subsets: ['latin'],
});

const exo2 = Exo_2({
  variable: '--font-exo-2',
  subsets: ['latin'],
});

const ibmPlexSans = IBM_Plex_Sans({
  variable: '--font-ibm-plex-sans',
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
});

const notoSans = Noto_Sans({
  variable: '--font-noto-sans',
  subsets: ['latin'],
});

const lato = Lato({
  variable: '--font-lato',
  weight: ['400', '700'],
  subsets: ['latin'],
});

const poppins = Poppins({
  variable: '--font-poppins',
  weight: ['400', '600', '700'],
  subsets: ['latin'],
});

const montserrat = Montserrat({
  variable: '--font-montserrat',
  weight: ['400', '600', '700'],
  subsets: ['latin'],
});

const playfairDisplay = Playfair_Display({
  variable: '--font-playfair-display',
  weight: ['400', '600', '700'],
  subsets: ['latin'],
});

const dmSans = DM_Sans({
  variable: '--font-dm-sans',
  weight: ['400', '600', '700'],
  subsets: ['latin'],
});

const nunito = Nunito({
  variable: '--font-nunito',
  weight: ['400', '600', '700'],
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
        className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${plusJakartaSans.variable} ${roboto.variable} ${robotoMono.variable} ${spaceGrotesk.variable} ${rajdhani.variable} ${oxanium.variable} ${rubik.variable} ${exo2.variable} ${ibmPlexSans.variable} ${notoSans.variable} ${lato.variable} ${poppins.variable} ${montserrat.variable} ${playfairDisplay.variable} ${dmSans.variable} ${nunito.variable} antialiased`}
        style={{ flex: 1 }}
      >
        <ThemeStyles />
        <ThemePresetOverlay />
        <StyledJsxRegistry>
          <GluestackUIProvider mode="system">
            <Suspense fallback={null}>
              <NavbarPreviewFromUrl />
            </Suspense>
            <div className="min-h-screen w-full overflow-auto">
              {children}
            </div>
            <LayoutChatbot />
            <AiResponsePreviewOverlay />
            <Toaster position="top-center" richColors />
          </GluestackUIProvider>
        </StyledJsxRegistry>
      </body>
    </html>
  );
}
