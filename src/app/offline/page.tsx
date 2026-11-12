import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="offline-page">
      <section>
        <div className="brand-mark" aria-hidden="true">K</div>
        <p className="eyebrow">KASIR TOKO</p>
        <h1>Anda sedang offline</h1>
        <p>Halaman kasir perlu sambungan internet untuk memuat data toko. Periksa jaringan, lalu coba lagi.</p>
        <Link className="button button-primary" href="/">Coba lagi</Link>
      </section>
    </main>
  );
}
