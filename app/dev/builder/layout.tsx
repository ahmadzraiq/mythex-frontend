/**
 * Builder layout — escapes the root layout chrome (chatbot, overlays, overflow-auto div).
 * Makes /dev/builder truly full-screen.
 */
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

import React from 'react';
