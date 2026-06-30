import './app/globals.css';
import './app/dev/builder/builder-tokens.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import AppRouter from './app/_router';
import { ThemeStyles } from './lib/ThemeStyles';
import { ThemePresetOverlay } from './lib/ThemePresetOverlay';
import { Toaster } from 'sonner';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <>
    <ThemeStyles />
    <ThemePresetOverlay />
    <AppRouter />
    <Toaster position="top-center" richColors />
  </>
);
