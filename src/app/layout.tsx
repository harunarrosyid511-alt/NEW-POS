import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegister } from "./sw-register";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kasir Toko Kelontong",
  description: "Aplikasi kasir sederhana untuk toko kelontong.",
  applicationName: "Kasir Toko",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Kasir Toko" },
};

export const viewport: Viewport = {
  themeColor: "#16a34a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
