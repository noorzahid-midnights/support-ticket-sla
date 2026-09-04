import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "./providers";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

/**
 * Self-hosted rather than next/font/google: that helper fetches at build time
 * and, when the fetch fails, silently substitutes a metric-matched system font
 * instead of erroring — so the app ships in the wrong typeface with nothing
 * visibly wrong. Self-hosting takes the network out of the build entirely.
 */
const sans = localFont({
  src: "./fonts/inter-latin-variable.woff2",
  weight: "400 700",
  style: "normal",
  variable: "--font-sans",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: { default: "Helpdesk SLA", template: "%s · Helpdesk SLA" },
  description: "Support ticketing with a business-hours-aware SLA engine.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable} suppressHydrationWarning>
      <head>
        {/*
          Stamps the saved theme before first paint. Without it the page renders
          in the OS theme and then snaps to the chosen one a frame later, which
          is the flash every theme toggle is judged by. Deliberately inline and
          render-blocking — it is three lines and has to run before the body.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("helpdesk.theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`,
          }}
        />
      </head>
      <body>
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
