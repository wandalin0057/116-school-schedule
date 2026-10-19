import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "通學區案件期程暨發文管理系統", template: "%s｜通學區案件管理" },
  description: "通學區規劃案件期程、工作待辦、公文與 Email 草稿管理",
  robots: { index: false, follow: false },
  applicationName: "通學區案件",
  appleWebApp: { capable: true, title: "通學區案件", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1e3a6e" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant-TW">
      <body>
        {children}
        <Toaster richColors position="top-center" closeButton />
      </body>
    </html>
  );
}
