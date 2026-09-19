import type { Metadata } from "next";
import { Public_Sans, Spectral } from "next/font/google";
import "./globals.css";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

const spectral = Spectral({
  variable: "--font-spectral",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "PlainLease";

export const metadata: Metadata = {
  title: `${appName} — understand your lease before you sign`,
  description:
    "Upload a residential lease agreement and get every clause explained in plain language, unusual terms flagged, and answers grounded in your document.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} ${spectral.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
