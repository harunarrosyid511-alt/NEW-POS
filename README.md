# Kasir Toko Kelontong

Aplikasi kasir web responsif berbahasa Indonesia. Next.js App Router, TypeScript, Tailwind CSS, Supabase Auth/Postgres, dan PWA.

## Jalankan di komputer

1. Pasang Node.js 20.9 atau yang lebih baru.
2. Salin `.env.example` menjadi `.env.local`.
3. Isi `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` dari pengaturan API proyek Supabase.
4. Di folder proyek, jalankan:

   ```powershell
   npm install
   npm run dev
   ```

5. Buka `http://localhost:3000`, lalu buat akun toko.

Tanpa konfigurasi Supabase, aplikasi menampilkan petunjuk sambungan dan belum dapat menyimpan transaksi.

## Menyiapkan Supabase

1. Buat proyek baru di [supabase.com](https://supabase.com), lalu simpan password database di tempat aman.
2. Buka **Authentication → Sign In / Providers → Email** dan aktifkan email/password. Untuk percobaan lokal, pengaturan konfirmasi email dapat disesuaikan dengan kebijakan toko.
3. Buka **SQL Editor → New query**, salin seluruh isi [`supabase/schema.sql`](./supabase/schema.sql), lalu tekan **Run**.
4. Buka **Project Settings → API**. Salin Project URL dan publishable key (atau anon key lama) ke `.env.local`. Jangan pernah memasukkan `service_role` key ke aplikasi browser.
5. Jalankan aplikasi, pilih **Belum punya akun? Daftar**, isi email dan kata sandi. Trigger database membuat toko dan kategori awal untuk akun baru.
6. Pada halaman Kasir yang masih kosong, tekan **Isi contoh barang** untuk mengisi contoh produk kelontong. Tombol ini hanya aktif jika daftar barang akun tersebut masih kosong.

Skema membuat tabel toko, kategori, barang, satuan, pelanggan, supplier, transaksi, pembayaran, piutang, kulakan, dan pergerakan stok. Row Level Security membatasi baris ke toko pemilik akun. Fungsi `process_sale`, `collect_debt`, `cancel_sale`, `adjust_stock`, dan `process_purchase` memproses perubahan terkait secara atomik. Penjualan membayar hutang lama dari yang tertua jika opsi tersebut dipilih.

## Deploy ke Vercel

1. Simpan proyek ini ke repositori Git milik Anda. Pastikan `.env.local` tidak diunggah.
2. Di Vercel, pilih **Add New → Project**, lalu impor repositori.
3. Di **Environment Variables**, tambahkan `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` untuk environment yang digunakan.
4. Tekan **Deploy**. Perintah build memakai konfigurasi Next.js bawaan.
5. Di Supabase Authentication, tambahkan alamat situs Vercel pada **URL Configuration → Site URL** dan alamat lokal pada **Redirect URLs**. Setelah domain berubah, perbarui Site URL.

## Pasang sebagai PWA

- Buka alamat HTTPS aplikasi di Chrome atau Edge. Pilih **Install app / Pasang aplikasi** dari menu browser. Bila browser menampilkan tombol **Pasang aplikasi** di navigasi, tombol itu juga dapat digunakan.
- Di iPhone/iPad, buka situs di Safari, tekan **Bagikan**, lalu **Tambahkan ke Layar Utama**.
- Service worker menampilkan halaman offline dasar. Kasir dan data transaksi tetap memerlukan internet karena data disimpan di Supabase.

## Isi yang tersedia

- Login, daftar, reset kata sandi, dan pemisahan data antartoko dengan RLS.
- Kasir dengan cari barang, kategori, pelanggan, diskon, metode tunai/transfer, kembalian, hutang sebagian, dan FIFO hutang lama.
- Struk penjualan dan bukti cicilan yang bisa dicetak, diunduh sebagai PNG/PDF, atau dibagikan lewat WhatsApp.
- Barang, satuan tambahan berbasis konversi, koreksi stok, kulakan, dan riwayat stok.
- Piutang dan cicilan FIFO, pelanggan dengan riwayat belanja, dashboard dengan ringkasan penjualan/laba/stok/pelanggan, serta laporan penjualan, laba rugi sederhana, stok, kulakan, piutang, dan produk terlaris. Laporan memiliki filter tanggal bila sesuai dan bisa diunduh sebagai PDF A4.
- Navigasi desktop dan mobile, panduan bantuan per menu, manifest, ikon, serta halaman offline.

## Catatan cakupan

- Data pelanggan dan transaksi hanya dapat dipakai setelah proyek Supabase disiapkan.
- Grafik dashboard dapat menampilkan 7 hari, 30 hari, atau bulan berjalan. Laporan merangkum transaksi yang tersimpan di toko.
- Form barang mendukung satu satuan tambahan per proses penyuntingan. Logo toko dan foto barang belum memiliki unggahan dari antarmuka.
- Pembatalan transaksi mengembalikan stok dan mencatat pengembalian pembayaran pada riwayat pembayaran. Pembayaran hutang lama yang sudah diterapkan tidak dapat dibatalkan dari layar laporan.
- Jika pengaturan **Require email confirmation** aktif, pengguna perlu mengonfirmasi email sebelum masuk.

## Catatan desain

Hijau toko dipakai pada aksi utama dan status pilihan agar langkah pembayaran mudah ditemukan. Sistem font perangkat dipilih supaya nama barang dan nominal tetap jelas tanpa unduhan font. Panel barang dan keranjang memisahkan pemilihan produk dari keputusan pembayaran; di layar kecil keranjang berubah menjadi lembar bawah dan navigasi berpindah ke bawah layar. Dials desain: ENERGY 2 / RHYTHM 2 / MOTION 1.
