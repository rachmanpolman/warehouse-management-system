# 📦 Live Warehouse Management System (WMS) & Mobile Barcode/QR Scanner

![React](https://img.shields.io/badge/Frontend-React_19_+_Vite-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![React Native](https://img.shields.io/badge/Mobile-React_Native_0.88-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Node.js](https://img.shields.io/badge/Backend-Node.js_+_Express-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Socket.io](https://img.shields.io/badge/Realtime-Socket.io-010101?style=for-the-badge&logo=socketdotio&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/Database-Neon_PostgreSQL_+_Prisma-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Cache-Upstash_Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)

Sistem **Inventory & Warehouse Management System (WMS) Real-Time** terintegrasi yang menghubungkan **Web Dashboard Multi-Divisi** dengan **Aplikasi Mobile Kamera Scanner (Android)** secara instan melalui **WebSocket (Socket.io)**, **Upstash Redis Caching**, dan **Neon Serverless PostgreSQL**.

---

## 🚀 Live Demo & Unduh Aplikasi (APK)

| Platform | Tautan Akses Langsung | Status |
| :--- | :--- | :--- |
| 🌐 **Web Dashboard (Vercel)** | [**warehouse-management-system-ruby-alpha.vercel.app**](https://warehouse-management-system-ruby-alpha.vercel.app) | 🟢 Online |
| ⚡ **Cloud Backend API (Render)** | [**warehouse-management-system-backend-q5ms.onrender.com**](https://warehouse-management-system-backend-q5ms.onrender.com/api/products) | 🟢 Online |
| 📱 **Android Mobile Scanner (.APK)** | [**📥 Unduh `wms-mobile-scanner.apk` (Siap Install di HP)**](https://github.com/rachmanpolman/warehouse-management-system/raw/main/apk/wms-mobile-scanner.apk) | 🟢 Standalone Release |

> ⏳ **Catatan:** Website ini menggunakan layanan *cloud & database serverless* gratis (**Neon / Render**). Jika website pertama kali dibuka setelah beberapa saat tidak aktif, mungkin akan ada jeda waktu sekitar **5–10 detik** karena proses *'cold start'* server dan database sebelum data tersinkronisasi penuh. Terima kasih atas kesabarannya.

> 💡 **Cara Mencoba Sinkronisasi Real-Time (Web + HP):**
> 1. Buka [**Web Dashboard**](https://warehouse-management-system-ruby-alpha.vercel.app) di laptop/komputer Anda.
> 2. Unduh dan pasang file [**`wms-mobile-scanner.apk`**](./apk/wms-mobile-scanner.apk) di HP Android Anda (tidak memerlukan kabel USB / laptop karena sudah terhubung langsung ke Cloud Server).
> 3. Klik tombol **Ikon QR Code** pada salah satu barang di tabel Web Dashboard untuk menampilkan label QR di layar monitor.
> 4. Arahkan kamera aplikasi HP ke QR Code di layar monitor — stok di Web Dashboard dan HP akan **langsung berkurang/bertambah dalam hitungan milidetik** tanpa *refresh* halaman!

---

## 📸 Tampilan Antarmuka (Web & Mobile App)

| 🌐 Web Dashboard (Real-Time Inventory & Kanban PR) | 📱 Mobile Scanner (Camera QR/Barcode & 3-Tab Menu) |
| :---: | :---: |
| <img src="./docs/web-dashboard.png" alt="Web Dashboard" width="600"/> | <img src="./docs/mobile-app.png" alt="Mobile Scanner" width="280"/> |

---

## 🏗️ Arsitektur Sistem

```mermaid
flowchart LR
    subgraph Clients["💻 Client Applications"]
        Web["🌐 React Web Dashboard\n(Vercel)"]
        Mobile["📱 React Native Scanner\n(Android Release APK)"]
    end

    subgraph CloudBackend["⚙️ Cloud Backend (Render)"]
        API["Node.js + Express\nREST API"]
        WS["Socket.io Server\nRoom per Divisi"]
    end

    subgraph DataLayer["🗄️ Cloud Data & Cache Layer"]
        Redis[("⚡ Upstash Redis\nCache-Aside (products:all)")]
        Postgres[("🐘 Neon PostgreSQL\nPrisma ORM (ACID Transaction)")]
    end

    Mobile -- "POST /reduce-stock\nPOST /add-stock" --> API
    Web -- "REST API (CRUD, PR, Analytics)" --> API
    API -- "1. Read/Invalidate Cache" --> Redis
    API -- "2. Prisma $transaction" --> Postgres
    WS == "Real-time Event Broadcast\n(stock:updated, pr:updated, notification:new)" ==> Web
    Mobile -. "Pull & Sync Data" .-> API
```

---

## ✨ Fitur Utama (End-to-End WMS)

### 1. ⚡ Sinkronisasi Stok Real-Time & Redis Cache-Aside
- Setiap transaksi barang keluar (`OUT`), barang masuk (`IN`), atau perubahan master data diproses secara atomik menggunakan **`prisma.$transaction`**.
- Menggunakan pola **Cache-Aside** dengan **Upstash Serverless Redis** (`products:all`, TTL 60 detik). Saat terjadi perubahan stok, cache otomatis di-invalidasi dan **Socket.io** memancarkan event `stock:updated` ke seluruh layar yang sedang membuka dashboard.

### 2. 📊 Deteksi Understock & Overstock Berbasis Analisis 30 Hari
- Merekam seluruh riwayat pergerakan stok (`StockMovement` `IN` & `OUT`).
- Menghitung secara otomatis:
  - **Rata-rata Pemakaian Harian (*Daily Burn Rate*)** selama 30 hari terakhir.
  - **Estimasi Hari Habis (*Days Until Zero*)**.
  - **Rekomendasi `Min Stock` (*Reorder Point*)** berdasarkan *Lead Time* vendor + *Safety Stock* 30%.
  - **Rekomendasi `Max Stock` (*Overstock Threshold*)** untuk mencegah penumpukan barang di gudang.
- Dilengkapi fitur **Terapkan Rekomendasi Otomatis (1-Klik)** maupun **Edit Manual (`Min`/`Max`/`Lead Time`)**.

### 3. 🔔 Notifikasi Real-Time Spesifik per Divisi (Socket.io Rooms)
- Mendukung 4 peran divisi: **`Staff Warehouse`**, **`Tim Purchasing`**, **`Divisi Incoming`**, dan **`Divisi Outgoing`**.
- Notifikasi dikirim secara terarah ke *Socket.io Room* masing-masing divisi (`room:warehouse`, `room:purchasing`, `room:incoming`, `room:outgoing`) sekaligus disimpan permanen di PostgreSQL (`Notification`).

### 4. 🛒 Alur Pengadaan Barang (*Purchase Request* Kanban Board)
- Siklus pengadaan barang terstruktur dalam 4 kolom status Kanban:
  1. **`REQUESTED` (Diajukan Warehouse):** Staf gudang melaporkan barang *understock* ke Purchasing.
  2. **`APPROVED` / `REJECTED` (Disetujui Purchasing):** Tim Purchasing meninjau dan menyetujui pengajuan pembelian ke vendor.
  3. **`PAID` (Vendor Dibayar / Dikirim):** Purchasing mengonfirmasi pembayaran; Divisi Incoming menerima notifikasi barang sedang dikirim.
  4. **`RECEIVED` (Diterima Incoming):** Divisi Incoming memverifikasi kedatangan barang fisik, stok gudang otomatis bertambah, dan sistem menerbitkan **Label QR Code**.

### 5. 📱 Aplikasi Mobile Kamera Scanner (3 Menu Utama)
- **`📷 Scanner`:** Mendukung 2 mode pemindaian langsung dari kamera HP:
  - **Mode Outgoing (`-1 Unit`):** Mengurangi stok saat barang keluar. Jika stok menyentuh batas minimum, muncul tombol cepat untuk mengajukan *Purchase Request (PR)* langsung dari HP.
  - **Mode Incoming (`+Qty Unit`):** Menambah stok barang masuk dengan pilihan kuantitas cepat (`+1`, `+5`, `+10`, `+25`, `+50`).
- **`📦 Stok`:** Memantau daftar seluruh SKU, kapasitas `Min/Max`, dan indikator status (`Aman`, `Understock`, `Overstock`) secara langsung dari HP.
- **`🔔 PR & Info`:** Memilih divisi aktif, memproses penerimaan barang datang (`Terima Barang Masuk`), dan membaca notifikasi divisi.

---

## 🛠️ Tech Stack

| Kategori | Teknologi |
| :--- | :--- |
| **Frontend Web** | React 19, Vite, Tailwind CSS, Socket.io Client, Lucide Icons |
| **Mobile App** | React Native 0.88 (Android CLI), TypeScript, `react-native-camera-kit` |
| **Backend Server** | Node.js, Express.js, Socket.io |
| **Database & ORM** | Neon.tech Serverless PostgreSQL, Prisma ORM |
| **Caching** | Upstash Serverless Redis (`@upstash/redis`) |
| **Deployment** | Vercel (Frontend), Render (Backend Web Service), GitHub (APK & Source) |

---

## 📡 Daftar Endpoint REST API

| Method | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `GET` | `/api/products` | Mengambil seluruh daftar barang (via Redis Cache / PostgreSQL) |
| `POST` | `/api/products` | Menambahkan master barang baru beserta auto-generate Barcode |
| `PUT` | `/api/products/:id` | Mengubah nama, `minStock`, `maxStock`, atau `leadTimeDays` barang |
| `POST` | `/api/products/reduce-stock` | Mengurangi stok barang berdasarkan hasil scan Barcode/QR (`OUT`) |
| `POST` | `/api/products/add-stock` | Menambah stok barang masuk (`IN`) & memicu notifikasi jika Overstock |
| `GET` | `/api/products/:id/insights` | Menghitung analisis pemakaian 30 hari & rekomendasi `Min/Max` stok |
| `GET` | `/api/notifications?role=...` | Mengambil riwayat notifikasi berdasarkan divisi aktif |
| `PATCH` | `/api/notifications/read-all` | Menandai seluruh notifikasi divisi sebagai sudah dibaca |
| `GET` | `/api/purchase-requests` | Mengambil daftar pengajuan pengadaan barang (Kanban PR) |
| `POST` | `/api/purchase-requests` | Membuat pengajuan pembelian barang (*Purchase Request*) baru |
| `PATCH` | `/api/purchase-requests/:id/status` | Mengubah status PR (`APPROVED`, `REJECTED`, `PAID`) |
| `POST` | `/api/purchase-requests/:id/receive` | Menerima barang masuk di divisi Incoming & otomatis menambah stok |

---

## 💻 Panduan Menjalankan Secara Lokal

### 1. Persiapan Backend (`backend/`)
```bash
cd backend
npm install
```
Buat file `.env` di dalam folder `backend/`:
```env
DATABASE_URL="postgresql://user:password@ep-xxx.aws.neon.tech/neondb?sslmode=require"
UPSTASH_REDIS_REST_URL="https://xxx.upstash.io"
UPSTASH_REDIS_REST_TOKEN="your_upstash_token"
PORT=5000
```
Sinkronkan skema database, isi data awal (*seed*), dan jalankan server:
```bash
npx prisma db push
node seed.js
node server.js
```

### 2. Persiapan Frontend Web (`frontend/`)
```bash
cd frontend
npm install
npm run dev
```
Buka `http://localhost:5173` di browser.

### 3. Build / Install Aplikasi Mobile Android (`mobile/`)
Jika ingin langsung menginstall tanpa kompilasi, cukup unduh file [**`apk/wms-mobile-scanner.apk`**](./apk/wms-mobile-scanner.apk) ke HP Android Anda.

Jika ingin memodifikasi kode dan mem-build ulang APK *Release* secara mandiri (tanpa perlu kabel USB saat digunakan):
```bash
cd mobile
npm install
cd android
./gradlew assembleRelease
```
File APK hasil build akan tersedia di `mobile/android/app/build/outputs/apk/release/app-release.apk`.

---

## 📁 Struktur Direktori Proyek

```text
warehouse-live/
├── apk/
│   └── wms-mobile-scanner.apk      # File APK Android Release siap pasang di HP
├── backend/
│   ├── prisma/
│   │   └── schema.prisma           # Skema PostgreSQL (Product, StockMovement, Notification, PurchaseRequest)
│   ├── server.js                   # Express API + Socket.io + Redis Cache + Analisis 30 Hari
│   └── seed.js                     # Seeder data awal barang gudang
├── frontend/
│   ├── src/
│   │   ├── App.jsx                 # Dashboard Web Utama (Sidebar, Grafik Kapasitas, Tabel, Kanban PR, QR Modal)
│   │   └── index.css               # Custom styling & scrollbar
│   └── index.html
├── mobile/
│   ├── App.tsx                     # Aplikasi React Native 3-Tab (Scanner, Stok, PR & Notifikasi Divisi)
│   └── android/                    # Konfigurasi Native Android & Gradle
└── README.md
```

