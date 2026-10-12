import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { LoadingScreen } from "@/components/loading-screen";
import { AuthProvider } from "@/components/providers/auth-provider";
import { HouseProvider } from "@/components/providers/house-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { THEME_SCRIPT } from "@/lib/theme";
import { Toaster } from "@/components/ui/sonner";
import { getServerSession } from "@/lib/firebase-server";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Who is doing laundry?",
  description: "See at a glance whether a machine is available, and book your slot.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * Resolved from the session cookie so signed-in members land straight in the app shell
 * instead of a client-side redirect. It costs a token check and a few reads, so it sits
 * behind Suspense: the loading screen goes out first and this streams in after it.
 */
async function SessionProviders({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  return (
    <AuthProvider initialUser={session.user}>
      <HouseProvider initial={session.membership}>{children}</HouseProvider>
    </AuthProvider>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Sets light or dark before the first paint, so there is no flash of white. It
            runs as the browser reads the page; this server layout never re-renders it. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="bg-background text-foreground flex min-h-full flex-col">
        <ThemeProvider>
          <Suspense fallback={<LoadingScreen />}>
            <SessionProviders>{children}</SessionProviders>
          </Suspense>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
