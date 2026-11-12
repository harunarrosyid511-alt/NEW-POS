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
2. Buka **Authentication → Sign In / Providers → Email** dan aktifkan email/password. Jika konfirmasi email aktif, pendaftar harus membuka tautan konfirmasi sebelum bisa masuk. Tautan konfirmasi kembali ke alamat aplikasi yang sedang dipakai, jadi alamat tersebut harus masuk daftar **Redirect URLs**. Untuk percobaan lokal saja, konfirmasi email dapat dimatikan; untuk toko sungguhan, gunakan pengiriman email yang sudah dikonfigurasi.
3. Buka **SQL Editor → New query**, salin seluruh isi [`supabase/schema.sql`](./supabase/schema.sql), lalu tekan **Run**.
4. Buka **Project Settings → API**. Salin Project URL dan publishable key (atau anon key lama) ke `.env.local`. Jangan pernah memasukkan `service_role` key ke aplikasi browser.
5. Untuk login Google, buat OAuth Client ID jenis **Web application** di Google Cloud Console. Masukkan URL callback Supabase yang ditampilkan di **Authentication → Providers → Google** sebagai **Authorized redirect URI** di Google Cloud. Salin Client ID dan Client secret dari Google ke pengaturan provider Google di Supabase, lalu aktifkan provider tersebut.
6. Di **Authentication → URL Configuration**, jadikan domain produksi sebagai **Site URL**, misalnya `https://nama-aplikasi.vercel.app`. Tambahkan alamat produksi dan alamat lokal yang dipakai, misalnya `https://nama-aplikasi.vercel.app/**`, `http://localhost:3000/**`, dan `http://127.0.0.1:3000/**`, ke **Redirect URLs**. Jika alamat redirect tidak diizinkan, Supabase dapat kembali ke **Site URL**. Tambahkan juga domain preview Vercel bila login dari preview diperlukan.
7. Redirect autentikasi secara bawaan memakai `https://newposs.vercel.app`, termasuk saat aplikasi dibuka di localhost. Jika domain deployment berbeda, atur `NEXT_PUBLIC_SITE_URL` ke domain tersebut di Environment Variables Vercel lalu redeploy. Untuk menguji redirect lokal, atur variabel itu ke `http://localhost:3000` di `.env.local`.
8. Jalankan aplikasi. Pilih **Belum punya akun? Daftar** untuk email dan kata sandi, atau **Lanjutkan dengan Google**. Login Google dapat membuat akun baru; toko awalnya bernama “Toko Saya” dan namanya dapat diubah dari Pengaturan.
9. Pada halaman Kasir yang masih kosong, tekan **Isi contoh barang** untuk mengisi contoh produk kelontong. Tombol ini hanya aktif jika daftar barang akun tersebut masih kosong.

Jika pendaftaran email gagal, pastikan provider Email aktif, schema sudah dijalankan, dan cek pesan kesalahan yang ditampilkan aplikasi. Jika konfirmasi email aktif, periksa kotak masuk dan folder spam. Jika email sudah pernah didaftarkan, masuk atau gunakan **Lupa kata sandi?**. Login Google baru berfungsi setelah provider Google dan URL redirect di atas disiapkan.

Skema membuat tabel toko, kategori, barang, satuan, pelanggan, supplier, transaksi, pembayaran, piutang, kulakan, dan pergerakan stok. Row Level Security membatasi baris ke toko pemilik akun. Fungsi `process_sale`, `collect_debt`, `cancel_sale`, `adjust_stock`, dan `process_purchase` memproses perubahan terkait secara atomik. Penjualan membayar hutang lama dari yang tertua jika opsi tersebut dipilih.

## Deploy ke Vercel

1. Simpan proyek ini ke repositori Git milik Anda. Pastikan `.env.local` tidak diunggah.
2. Di Vercel, pilih **Add New → Project**, lalu impor repositori.
3. Di **Environment Variables**, tambahkan `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Jika domain produksi bukan `https://newposs.vercel.app`, tambahkan juga `NEXT_PUBLIC_SITE_URL` dengan URL domain produksi.
4. Tekan **Deploy**. Perintah build memakai konfigurasi Next.js bawaan.
5. Di Supabase Authentication, jadikan domain produksi Vercel sebagai **URL Configuration → Site URL** dan daftarkan domain produksi serta alamat lokal pada **Redirect URLs**. Redirect URL yang tidak terdaftar dapat diarahkan kembali ke Site URL. Setelah domain berubah, perbarui konfigurasi ini dan redeploy agar nilai `NEXT_PUBLIC_SITE_URL` terbaru digunakan.

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
