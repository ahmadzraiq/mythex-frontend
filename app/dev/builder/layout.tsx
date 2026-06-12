/**
 * Builder layout — escapes the root layout chrome (chatbot, overlays, overflow-auto div).
 * Makes /dev/builder truly full-screen.
 * Imports builder-tokens.css which defines all --bld-* CSS custom properties.
 */
import './builder-tokens.css';
import React from 'react';

export default function BuilderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {children}
    </div>
  );
}
