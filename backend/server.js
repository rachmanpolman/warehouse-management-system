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
    methods: ['GET', 'POST'],
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

// 1. EVENT SOCKET.IO (Real-time connection)
io.on('connection', (socket) => {
  console.log(`⚡ Client terhubung ke WebSocket: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`❌ Client terputus: ${socket.id}`);
  });
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