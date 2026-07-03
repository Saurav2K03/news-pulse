import './globals.css';

export const metadata = {
  title: 'News Pulse - Dashboard',
  description: 'Live news topics clustered and plotted on a timeline',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="light">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;700&family=Source+Serif+4:opsz,wght@8..60,400;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-background text-primary antialiased min-h-screen flex flex-col items-center py-margin-desktop px-margin-mobile md:px-margin-desktop">
        {children}
      </body>
    </html>
  );
}
