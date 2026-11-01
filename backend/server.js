import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { Redis } from '@upstash/redis';

dotenv.config();

const app = express();
const server = http.createServer(app);

// Inisialisasi Socket.io dengan CORS agar bisa diakses Web & Mobile
const io = new Server(server, {
  cors: {
    origin: '*', // Membolehkan frontend & mobile scanner terhubung
    methods: ['GET', 'POST', 'PUT', 'PATCH'],
  },
});

const prisma = new PrismaClient();
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// 1. EVENT SOCKET.IO (Real-time connection + Room per Divisi)
const VALID_ROLES = ['warehouse', 'purchasing', 'incoming', 'outgoing'];

io.on('connection', (socket) => {
  console.log(`⚡ Client terhubung ke WebSocket: ${socket.id}`);

  // Saat frontend memilih divisi, masukkan socket ke kamar (room) divisi tersebut
  socket.on('join:role', (role) => {
    VALID_ROLES.forEach((r) => socket.leave(`room:${r}`));
    if (VALID_ROLES.includes(role)) {
      socket.join(`room:${role}`);
      console.log(`🔔 Socket ${socket.id} bergabung ke room:${role}`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Client terputus: ${socket.id}`);
  });
});

// Helper: Simpan notifikasi ke Database & pancarkan ke Room divisi terkait
async function notifyRoles(roles, { type = 'INFO', title, message, productId = null }) {
  try {
    for (const role of roles) {
      const notif = await prisma.notification.create({
        data: { targetRole: role, type, title, message, productId },
      });
      io.to(`room:${role}`).emit('notification:new', notif);
    }
  } catch (err) {
    console.error('Gagal mengirim notifikasi:', err.message);
  }
}

// 1B. API: AMBIL RIWAYAT NOTIFIKASI PER DIVISI
app.get('/api/notifications', async (req, res) => {
  const role = req.query.role || 'warehouse';
  try {
    const list = await prisma.notification.findMany({
      where: { targetRole: String(role) },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    return res.json(list);
  } catch (error) {
    return res.status(500).json({ error: 'Gagal mengambil notifikasi.' });
  }
});

// 1C. API: TANDAI SEMUA NOTIFIKASI DIVISI SUDAH DIBACA
app.patch('/api/notifications/read-all', async (req, res) => {
  const { role } = req.body;
  if (!role) return res.status(400).json({ error: 'Role wajib dikirim!' });
  try {
    await prisma.notification.updateMany({
      where: { targetRole: String(role), isRead: false },
      data: { isRead: true },
    });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal menandai notifikasi.' });
  }
});

// 2. API: AMBIL SEMUA BARANG (Dengan Redis Caching)
app.get('/api/products', async (req, res) => {
  const CACHE_KEY = 'products:all';

  try {
    // 1. Cek apakah data barang sudah ada di RAM Redis
    const cachedProducts = await redis.get(CACHE_KEY);

    if (cachedProducts) {
      console.log('⚡ [Redis CACHE HIT] Data diambil super cepat dari RAM Redis!');
      res.setHeader('X-Cache', 'HIT');
      return res.json(cachedProducts);
    }

    // 2. Jika BELUM ada di Redis (CACHE MISS), ambil dari Database PostgreSQL
    console.log('🐘 [Database CACHE MISS] Mengambil data dari PostgreSQL Neon...');
    const products = await prisma.product.findMany({
      orderBy: { createdAt: 'desc' },
    });

    // 3. Simpan hasil query ke Redis agar request berikutnya instan (Simpan selama 60 detik)
    await redis.set(CACHE_KEY, products, { ex: 60 });
    res.setHeader('X-Cache', 'MISS');

    return res.json(products);
  } catch (error) {
    console.error('Peringatan Redis:', error.message);
    // Fallback darurat: Jika Redis ada gangguan, server tetap jalan lewat PostgreSQL
    const products = await prisma.product.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return res.json(products);
  }
});

// 2B. API: TAMBAH BARANG BARU
app.post('/api/products', async (req, res) => {
  const { sku, name, barcode, stock = 0, minStock = 5, maxStock = 100, leadTimeDays = 7 } = req.body;

  // Validasi wajib isi
  if (!sku || !name) {
    return res.status(400).json({ error: 'SKU dan Nama barang wajib diisi!' });
  }

  const initialStock = parseInt(stock, 10);
  const min = parseInt(minStock, 10);
  const max = parseInt(maxStock, 10);
  const lead = parseInt(leadTimeDays, 10);

  if ([initialStock, min, max, lead].some((n) => isNaN(n) || n < 0)) {
    return res.status(400).json({ error: 'Angka stok, min, max, dan lead time tidak boleh negatif!' });
  }
  if (min >= max) {
    return res.status(400).json({ error: 'Stok minimum harus lebih kecil dari stok maksimum!' });
  }

  // Jika barcode dikosongkan, buat otomatis 12 digit (awalan 899 = kode Indonesia)
  const finalBarcode = barcode?.trim() || `899${Date.now().toString().slice(-9)}`;

  try {
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          sku: sku.trim().toUpperCase(),
          name: name.trim(),
          barcode: finalBarcode,
          stock: initialStock,
          minStock: min,
          maxStock: max,
          leadTimeDays: lead,
        },
      });

      // Catat stok awal sebagai barang masuk, supaya riwayat mutasi lengkap
      if (initialStock > 0) {
        await tx.stockMovement.create({
          data: {
            productId: created.id,
            type: 'IN',
            quantity: initialStock,
            notes: 'Stok awal saat barang didaftarkan',
          },
        });
      }

      return created;
    });

    await redis.del('products:all');
    io.emit('product:created', {
      product,
      message: `Barang baru didaftarkan: ${product.name} (${product.stock} unit)`,
    });

    return res.status(201).json({ success: true, data: product });
  } catch (error) {
    // P2002 = kode Prisma untuk data unik yang dobel
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'SKU atau Barcode sudah dipakai barang lain!' });
    }
    console.error('Error tambah barang:', error.message);
    return res.status(500).json({ error: 'Gagal menambahkan barang.' });
  }
});

// 2C. API: UBAH DATA BARANG (nama & batas stok)
app.put('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  const { name, minStock, maxStock, leadTimeDays } = req.body;

  try {
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Barang tidak ditemukan!' });
    }

    const min = minStock !== undefined ? parseInt(minStock, 10) : existing.minStock;
    const max = maxStock !== undefined ? parseInt(maxStock, 10) : existing.maxStock;
    if (min >= max) {
      return res.status(400).json({ error: 'Stok minimum harus lebih kecil dari stok maksimum!' });
    }

    const product = await prisma.product.update({
      where: { id },
      data: {
        name: name?.trim() || existing.name,
        minStock: min,
        maxStock: max,
        leadTimeDays: leadTimeDays !== undefined ? parseInt(leadTimeDays, 10) : existing.leadTimeDays,
      },
    });

    await redis.del('products:all');
    io.emit('product:updated', { product, message: `Data barang diperbarui: ${product.name}` });

    return res.json({ success: true, data: product });
  } catch (error) {
    console.error('Error ubah barang:', error.message);
    return res.status(500).json({ error: 'Gagal mengubah barang.' });
  }
});

// 2D. API: ANALISIS UNDERSTOCK & OVERSTOCK BERDASARKAN RIWAYAT 30 HARI
app.get('/api/products/:id/insights', async (req, res) => {
  const { id } = req.params;

  try {
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      return res.status(404).json({ error: 'Barang tidak ditemukan!' });
    }

    // Ambil total barang keluar (OUT) dalam 30 hari terakhir
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const agg = await prisma.stockMovement.aggregate({
      where: {
        productId: id,
        type: 'OUT',
        createdAt: { gte: thirtyDaysAgo },
      },
      _sum: { quantity: true },
    });

    const totalOut30d = agg._sum.quantity || 0;
    const avgDailyUsage = Number((totalOut30d / 30).toFixed(2));

    // Gunakan minimal 0.5 unit/hari sebagai asumsi dasar jika barang baru belum punya banyak riwayat
    const effectiveDaily = avgDailyUsage > 0 ? avgDailyUsage : 0.5;

    // 1. Berapa hari lagi stok akan menyentuh 0?
    const daysUntilZero =
      avgDailyUsage > 0 ? Math.floor(product.stock / avgDailyUsage) : null;

    // 2. Rekomendasi minStock (kebutuhan selama tunggu vendor + 50% safety stock)
    const recommendedMinStock = Math.max(
      2,
      Math.ceil(effectiveDaily * product.leadTimeDays * 1.5)
    );

    // 3. Rekomendasi maxStock (kebutuhan lead time + 30 hari siklus simpan)
    const recommendedMaxStock = Math.max(
      recommendedMinStock + 10,
      Math.ceil(effectiveDaily * (product.leadTimeDays + 30))
    );

    // 4. Tentukan status & saran tindakan
    let status = 'AMAN';
    let advice = 'Stok berada di rentang ideal berdasarkan pergerakan barang.';

    if (product.stock === 0) {
      status = 'HABIS';
      advice = 'Stok sudah 0! Segera lakukan pengadaan darurat ke vendor.';
    } else if (product.stock <= product.minStock) {
      status = 'UNDERSTOCK';
      advice = `Stok menyentuh batas minimum (${product.minStock}). Segera pesan ulang karena vendor butuh ${product.leadTimeDays} hari pengiriman.`;
    } else if (product.stock > product.maxStock) {
      status = 'OVERSTOCK';
      advice = `Stok melebihi batas maksimum (${product.maxStock}). Hentikan pembelian sementara agar tidak menumpuk di gudang.`;
    } else if (product.stock > recommendedMaxStock && totalOut30d > 0) {
      status = 'OVERSTOCK_HISTORIS';
      advice = `Berdasarkan data 30 hari terakhir (keluar ${totalOut30d} pcs), stok saat ini (${product.stock}) terlalu banyak dibanding kebutuhan nyata (maks ideal ${recommendedMaxStock} pcs).`;
    }

    return res.json({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      stock: product.stock,
      minStock: product.minStock,
      maxStock: product.maxStock,
      leadTimeDays: product.leadTimeDays,
      totalOut30d,
      avgDailyUsage,
      daysUntilZero,
      recommendedMinStock,
      recommendedMaxStock,
      status,
      advice,
    });
  } catch (error) {
    console.error('Error insights:', error.message);
    return res.status(500).json({ error: 'Gagal menghitung analisis stok.' });
  }
});

// 3. API: PENGURANGAN STOK VIA SCAN BARCODE (Inti Proyek Anda!)
app.post('/api/products/reduce-stock', async (req, res) => {
  const { barcode, quantity = 1 } = req.body;

  if (!barcode) {
    return res.status(400).json({ error: 'Barcode wajib dikirim!' });
  }

  try {
    // DATABASE TRANSACTION: Mencegah Race Condition (Anti-Stok Minus)
    const result = await prisma.$transaction(async (tx) => {
      // Cari produk berdasarkan barcode
      const product = await tx.product.findUnique({
        where: { barcode },
      });

      if (!product) {
        throw new Error('Produk tidak ditemukan!');
      }

      // Validasi ketersediaan stok
      if (product.stock < quantity) {
        throw new Error(`Stok tidak cukup! Sisa stok hanya ${product.stock}`);
      }

      // Kurangi stok produk
      const updatedProduct = await tx.product.update({
        where: { id: product.id },
        data: { stock: product.stock - quantity },
      });

      // Catat riwayat mutasi barang keluar
      const movement = await tx.stockMovement.create({
        data: {
          productId: product.id,
          type: 'OUT',
          quantity: quantity,
          notes: 'Pengurangan via Scan Barcode',
        },
      });

      return { updatedProduct, movement };
    });

    // PANCARKAN EVENT WEBSOCKET KE SEMUA DASHBOARD SECARA LIVE!
    io.emit('stock:updated', {
      product: result.updatedProduct,
      movement: result.movement,
      message: `Stok ${result.updatedProduct.name} berkurang ${quantity}!`,
    });

    // Bersihkan cache Redis agar request berikutnya mengambil stok paling baru
    await redis.del('products:all');
    // Kirim notifikasi ke divisi Outgoing
    const p = result.updatedProduct;
    await notifyRoles(['outgoing'], {
      type: 'INFO',
      title: `Barang Keluar: ${p.name}`,
      message: `${quantity} unit keluar via scan. Sisa stok gudang: ${p.stock} unit.`,
      productId: p.id,
    });

    // Jika stok menyentuh atau di bawah minStock, beri peringatan ke Warehouse & Purchasing!
    if (p.stock <= p.minStock) {
      await notifyRoles(['warehouse', 'purchasing'], {
        type: p.stock === 0 ? 'CRITICAL' : 'WARNING',
        title: p.stock === 0 ? `🚨 STOK HABIS: ${p.name}` : `⚠️ Understock: ${p.name}`,
        message: `Sisa stok tinggal ${p.stock} unit (batas min: ${p.minStock}). Segera lakukan pengadaan ke vendor!`,
        productId: p.id,
      });
    }
    console.log('🧹 [Redis Invalidation] Cache dibersihkan karena ada pemotongan stok!');

    return res.json({
      success: true,
      message: 'Stok berhasil dikurangi!',
      data: result.updatedProduct,
    });
  } catch (error) {
    console.error('Error reduce-stock:', error.message);
    return res.status(400).json({ error: error.message });
  }
});

// 4. API: BARANG MASUK / RESTOCK (Inbound)
app.post('/api/products/restock', async (req, res) => {
  const { barcode, quantity = 1, notes } = req.body;

  if (!barcode) {
    return res.status(400).json({ error: 'Barcode wajib dikirim!' });
  }

  const qty = parseInt(quantity, 10);
  if (isNaN(qty) || qty <= 0) {
    return res.status(400).json({ error: 'Jumlah restock harus angka positif lebih dari 0!' });
  }

  try {
    // DATABASE TRANSACTION: Menambah stok & mencatat riwayat mutasi masuk
    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { barcode },
      });

      if (!product) {
        throw new Error('Produk dengan barcode tersebut tidak ditemukan!');
      }

      // 1. Tambah stok barang
      const updatedProduct = await tx.product.update({
        where: { id: product.id },
        data: { stock: product.stock + qty },
      });

      // 2. Catat riwayat mutasi barang masuk (IN)
      const movement = await tx.stockMovement.create({
        data: {
          productId: product.id,
          type: 'IN',
          quantity: qty,
          notes: notes || 'Penerimaan Barang Masuk (Restock)',
        },
      });

      return { updatedProduct, movement };
    });

    // PANCARKAN EVENT KE WEBSOCKET AGAR LAYAR WEB & HP LANGSUNG TER-UPDATE!
    io.emit('stock:updated', {
      product: result.updatedProduct,
      movement: result.movement,
      message: `Restock masuk: ${result.updatedProduct.name} (+${qty} unit)`,
    });

    // Bersihkan cache Redis agar request berikutnya mengambil stok paling baru
    await redis.del('products:all');
    // Kirim notifikasi ke divisi Incoming & Warehouse
    const p = result.updatedProduct;
    await notifyRoles(['incoming', 'warehouse'], {
      type: 'SUCCESS',
      title: `Barang Masuk: ${p.name}`,
      message: `+${qty} unit diterima di Incoming. Total stok sekarang: ${p.stock} unit.`,
      productId: p.id,
    });

    // Jika ternyata jumlah stok melewati batas maxStock, beri peringatan Overstock!
    if (p.stock > p.maxStock) {
      await notifyRoles(['warehouse', 'purchasing'], {
        type: 'WARNING',
        title: `📦 Overstock: ${p.name}`,
        message: `Stok mencapai ${p.stock} unit, melebihi batas maksimum (${p.maxStock} unit). Tahan pembelian berikutnya.`,
        productId: p.id,
      });
    }
    
    console.log('🧹 [Redis Invalidation] Cache dibersihkan karena ada barang restock masuk!');
    
    return res.json({
      success: true,
      message: 'Stok berhasil ditambahkan!',
      data: result.updatedProduct,
    });
  } catch (error) {
    console.error('Error restock:', error.message);
    return res.status(400).json({ error: error.message });
  }
});

// Menjalankan Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
});

// 5. API: AMBIL SEMUA PURCHASE REQUEST (Beserta Data Produknya)
app.get('/api/purchase-requests', async (req, res) => {
  try {
    const list = await prisma.purchaseRequest.findMany({
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(list);
  } catch (error) {
    console.error('Error get PR:', error.message);
    return res.status(500).json({ error: 'Gagal mengambil daftar pengajuan pembelian.' });
  }
});

// 5B. API: WAREHOUSE MENGAJUKAN PEMBELIAN BARANG (Saat Understock)
app.post('/api/purchase-requests', async (req, res) => {
  const { productId, quantity, vendorName, notes } = req.body;
  const qty = parseInt(quantity, 10);

  if (!productId || isNaN(qty) || qty <= 0) {
    return res.status(400).json({ error: 'Produk dan jumlah pesanan (positif) wajib diisi!' });
  }

  try {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return res.status(404).json({ error: 'Barang tidak ditemukan!' });
    }

    const pr = await prisma.purchaseRequest.create({
      data: {
        productId,
        quantity: qty,
        vendorName: vendorName?.trim() || 'Vendor Utama',
        notes: notes?.trim() || `Pengajuan restock dari Warehouse (Stok saat ini: ${product.stock})`,
        status: 'REQUESTED',
      },
      include: { product: true },
    });

    // Pancarkan ke semua layar secara real-time
    io.emit('pr:updated', pr);

    // Kirim notifikasi ke Tim Purchasing!
    await notifyRoles(['purchasing'], {
      type: 'WARNING',
      title: `📝 Pengajuan Pembelian: ${product.name}`,
      message: `Warehouse meminta pembelian ${qty} unit ${product.name}. Menunggu persetujuan Purchasing.`,
      productId: product.id,
    });

    return res.status(201).json({ success: true, data: pr });
  } catch (error) {
    console.error('Error create PR:', error.message);
    return res.status(500).json({ error: 'Gagal membuat pengajuan pembelian.' });
  }
});

// 5C. API: PURCHASING SETUJUI / TOLAK / BAYAR VENDOR (State Machine)
app.patch('/api/purchase-requests/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, vendorName } = req.body;

  // Aturan lompatan status yang sah (Anti-Lompat Alur)
  const ALLOWED_NEXT = {
    REQUESTED: ['APPROVED', 'REJECTED'],
    APPROVED: ['PAID'],
  };

  try {
    const existing = await prisma.purchaseRequest.findUnique({
      where: { id },
      include: { product: true },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Data pengajuan tidak ditemukan!' });
    }

    const allowed = ALLOWED_NEXT[existing.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        error: `Alur tidak sah! Status ${existing.status} tidak boleh langsung ke ${status}.`,
      });
    }

    const updated = await prisma.purchaseRequest.update({
      where: { id },
      data: {
        status,
        vendorName: vendorName?.trim() || existing.vendorName,
      },
      include: { product: true },
    });

    io.emit('pr:updated', updated);

    // Kirim notifikasi otomatis sesuai tahapan alur!
    if (status === 'APPROVED') {
      await notifyRoles(['warehouse'], {
        type: 'INFO',
        title: `✅ Pengajuan Disetujui: ${updated.product.name}`,
        message: `Purchasing menyetujui pembelian ${updated.quantity} unit ke ${updated.vendorName}.`,
        productId: updated.productId,
      });
    } else if (status === 'REJECTED') {
      await notifyRoles(['warehouse'], {
        type: 'WARNING',
        title: `❌ Pengajuan Ditolak: ${updated.product.name}`,
        message: `Purchasing menolak pengajuan ${updated.quantity} unit ${updated.product.name}.`,
        productId: updated.productId,
      });
    } else if (status === 'PAID') {
      await notifyRoles(['incoming', 'warehouse'], {
        type: 'SUCCESS',
        title: `💳 Vendor Dibayar: ${updated.product.name}`,
        message: `Purchasing telah membayar ${updated.vendorName} (${updated.quantity} unit). Divisi Incoming harap bersiap menerima barang!`,
        productId: updated.productId,
      });
    }

    return res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error update PR status:', error.message);
    return res.status(500).json({ error: 'Gagal memperbarui status pengajuan.' });
  }
});

// 5D. API: DIVISI INCOMING MENERIMA BARANG DARI VENDOR + UPDATE STOK OTOMATIS
app.post('/api/purchase-requests/:id/receive', async (req, res) => {
  const { id } = req.params;
  const { receivedQuantity } = req.body;

  try {
    const existing = await prisma.purchaseRequest.findUnique({
      where: { id },
      include: { product: true },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Data pengajuan tidak ditemukan!' });
    }

    if (existing.status !== 'PAID') {
      return res.status(400).json({
        error: 'Hanya pesanan yang sudah dibayar (PAID) yang bisa diterima oleh Incoming!',
      });
    }

    const qty = receivedQuantity !== undefined ? parseInt(receivedQuantity, 10) : existing.quantity;
    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Jumlah barang diterima harus lebih dari 0!' });
    }

    // TRANSAKSI ATOMIK: Update PR + Tambah Stok Produk + Catat Mutasi IN
    const result = await prisma.$transaction(async (tx) => {
      const updatedProduct = await tx.product.update({
        where: { id: existing.productId },
        data: { stock: { increment: qty } },
      });

      const movement = await tx.stockMovement.create({
        data: {
          productId: existing.productId,
          type: 'IN',
          quantity: qty,
          notes: `Penerimaan PR dari ${existing.vendorName}`,
        },
      });

      const updatedPr = await tx.purchaseRequest.update({
        where: { id },
        data: {
          status: 'RECEIVED',
          receivedQuantity: qty,
        },
        include: { product: true },
      });

      return { updatedProduct, movement, updatedPr };
    });

    // Hapus cache Redis & pancarkan ke semua layar
    await redis.del('products:all');

    io.emit('stock:updated', {
      product: result.updatedProduct,
      movement: result.movement,
      message: `Incoming menerima PR: ${result.updatedProduct.name} (+${qty} unit)`,
    });

    io.emit('pr:updated', result.updatedPr);

    // Kirim notifikasi ke Warehouse & Purchasing bahwa barang sudah masuk gudang!
    await notifyRoles(['warehouse', 'purchasing', 'incoming'], {
      type: 'SUCCESS',
      title: `📦 Barang PR Tiba: ${result.updatedProduct.name}`,
      message: `Incoming telah menerima ${qty} unit dari ${existing.vendorName}. Stok gudang kini ${result.updatedProduct.stock} unit & siap ditempel QR!`,
      productId: result.updatedProduct.id,
    });

    return res.json({
      success: true,
      data: result.updatedPr,
      product: result.updatedProduct,
    });
  } catch (error) {
    console.error('Error receive PR:', error.message);
    return res.status(500).json({ error: 'Gagal memproses penerimaan barang.' });
  }
});