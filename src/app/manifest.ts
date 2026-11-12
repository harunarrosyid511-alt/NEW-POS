import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kasir Toko Kelontong",
    short_name: "Kasir Toko",
    description: "Kasir sederhana untuk toko kelontong.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f7f3",
    theme_color: "#16a34a",
    lang: "id-ID",
    icons: [
      { src: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
