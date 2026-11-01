import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Package, AlertTriangle, Activity, Scan, ArrowDownRight, Plus, BarChart3, Bell, ShoppingCart, QrCode } from 'lucide-react';

const SOCKET_SERVER_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

export default function App() {
  const [products, setProducts] = useState([]);
  const [logs, setLogs] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [restockModalItem, setRestockModalItem] = useState(null);
  const [restockQuantity, setRestockQuantity] = useState(10);
  const [isRestocking, setIsRestocking] = useState(false);
  const emptyForm = { sku: '', name: '', barcode: '', stock: 0, minStock: 5, maxStock: 100, leadTimeDays: 7 };
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProduct, setNewProduct] = useState(emptyForm);
  const [isAdding, setIsAdding] = useState(false);
  const [insightData, setInsightData] = useState(null);
  const [isLoadingInsight, setIsLoadingInsight] = useState(false);
  const [activeRole, setActiveRole] = useState('warehouse');
  const [notifications, setNotifications] = useState([]);
  const socketRef = useRef(null);
  const [purchaseRequests, setPurchaseRequests] = useState([]);
  const [prModalProduct, setPrModalProduct] = useState(null);
  const [prForm, setPrForm] = useState({ quantity: 20, vendorName: 'PT Sumber Makmur', notes: '' });
  const [isSubmittingPr, setIsSubmittingPr] = useState(false);
  const [qrModalItem, setQrModalItem] = useState(null);
  

  // 1. Ambil Data Awal dari Backend API
  const fetchProducts = async () => {
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/products`);
      const data = await res.json();
      setProducts(data);
    } catch (err) {
      console.error('Gagal mengambil data:', err);
    }
  };

  // 1B. Ambil Notifikasi Divisi dari Database (Tidak hilang saat di-refresh!)
  const fetchNotifications = async (role) => {
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/notifications?role=${role}`);
      const data = await res.json();
      if (Array.isArray(data)) setNotifications(data);
    } catch (err) {
      console.error('Gagal mengambil notifikasi:', err);
    }
  };

    // 1C. Ambil Daftar Purchase Request (Alur Pengadaan)
  const fetchPurchaseRequests = async () => {
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/purchase-requests`);
      const data = await res.json();
      if (Array.isArray(data)) setPurchaseRequests(data);
    } catch (err) {
      console.error('Gagal mengambil PR:', err);
    }
  };

  useEffect(() => {
    fetchProducts();
    fetchPurchaseRequests();

    // 2. Hubungkan ke WebSocket Server
    const socket = io(SOCKET_SERVER_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      socket.emit('join:role', activeRole);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    // 3. MENERIMA PENGURANGAN STOK SECARA REAL-TIME DARI HP SCANNER!
    socket.on('stock:updated', (payload) => {
      const { product, message } = payload;

      // Update angka stok di tabel secara instan tanpa reload halaman
      setProducts((prevProducts) =>
        prevProducts.map((p) => (p.id === product.id ? product : p))
      );

      // Tambahkan ke log aktivitas
      const newLog = {
        id: Date.now(),
        text: message,
        time: new Date().toLocaleTimeString(),
        sku: product.sku,
      };
      setLogs((prev) => [newLog, ...prev.slice(0, 7)]); // simpan 8 log terbaru
    });

    // 4. BARANG BARU DIDAFTARKAN (dari tab/perangkat mana pun)
    socket.on('product:created', ({ product, message }) => {
      setProducts((prev) =>
        prev.some((p) => p.id === product.id) ? prev : [product, ...prev]
      );
      setLogs((prev) => [
        { id: Date.now(), text: message, time: new Date().toLocaleTimeString(), sku: product.sku },
        ...prev.slice(0, 7),
      ]);
    });

    // 5. DATA BARANG DIUBAH (nama / batas stok)
    socket.on('product:updated', ({ product }) => {
      setProducts((prev) => prev.map((p) => (p.id === product.id ? product : p)));
    });

    // 6. TERIMA NOTIFIKASI REAL-TIME KHUSUS ROOM DIVISI
    socket.on('notification:new', (notif) => {
      setNotifications((prev) => [notif, ...prev.slice(0, 24)]);
    });

     // 7. UPDATE ALUR PURCHASE REQUEST SECARA REAL-TIME
    socket.on('pr:updated', (pr) => {
      setPurchaseRequests((prev) => {
        const exists = prev.some((item) => item.id === pr.id);
        return exists ? prev.map((item) => (item.id === pr.id ? pr : item)) : [pr, ...prev];
      });
    });

    return () => socket.disconnect();
  }, []);

  // Saat pengguna mengganti dropdown Divisi: pindah Room Socket.io & muat notifikasi divisi tersebut
  useEffect(() => {
    setNotifications([]); // kosongkan tampilan sejenak saat ganti divisi
    fetchNotifications(activeRole);
    if (socketRef.current?.connected) {
      socketRef.current.emit('join:role', activeRole);
    }
  }, [activeRole]);

  // Saat pengguna mengganti dropdown Divisi: pindah Room Socket.io & muat notifikasi divisi tersebut useEffect(() => { fetchNotifications(activeRole); if (socketRef.current?.connected) { socketRef.current.emit('join:role', activeRole); } }, [activeRole]);
  const handleMarkAllRead = async () => { 
    try { 
      await fetch(`${SOCKET_SERVER_URL}/api/notifications/read-all`, { 
        method: 'PATCH', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ role: activeRole }), 
      }); 
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true }))); 
    } catch (err) { 
      console.error('Gagal menandai notifikasi:', err); 
    } 
  };

  // Fungsi Simulasi Scan Barcode (bisa dicoba langsung dari Web sebelum HP selesai)
  const handleSimulateScan = async (barcode) => {
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/products/reduce-stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode, quantity: 1 }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error);
    } catch (err) {
      alert('Gagal terhubung ke backend!');
    }
  };

    // Fungsi Kirim Restock ke Backend
  const handleRestockSubmit = async (e) => {
    e.preventDefault();
    if (!restockModalItem) return;

    setIsRestocking(true);
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/products/restock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barcode: restockModalItem.barcode,
          quantity: parseInt(restockQuantity, 10),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error);
      } else {
        setRestockModalItem(null); // Tutup modal jika sukses
      }
    } catch (err) {
      alert('Gagal terhubung ke backend!');
    } finally {
      setIsRestocking(false);
    }
  };

    // Fungsi Kirim Barang Baru ke Backend
  const handleAddSubmit = async (e) => {
    e.preventDefault();
    setIsAdding(true);
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProduct),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error);
      } else {
        setShowAddModal(false);
        setNewProduct(emptyForm);
        // Tidak perlu setProducts di sini: barang baru akan masuk lewat event WebSocket 'product:created'
      }
    } catch (err) {
      alert('Gagal terhubung ke backend!');
    } finally {
      setIsAdding(false);
    }
  };

    // Fungsi Buka Analisis Cerdas (Understock / Overstock 30 Hari)
  const handleOpenInsights = async (productId) => {
    setIsLoadingInsight(true);
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/products/${productId}/insights`);
      const data = await res.json();
      if (!res.ok) {
        alert(data.error);
      } else {
        setInsightData(data);
      }
    } catch (err) {
      alert('Gagal mengambil analisis stok!');
    } finally {
      setIsLoadingInsight(false);
    }
  };

  // Fungsi Terapkan Rekomendasi Min & Max Otomatis dari Data Historis
  const handleApplyRecommendation = async () => {
    if (!insightData) return;
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/products/${insightData.productId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minStock: insightData.recommendedMinStock,
          maxStock: insightData.recommendedMaxStock,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error);
      } else {
        setInsightData(null);
      }
    } catch (err) {
      alert('Gagal memperbarui batas stok!');
    }
  };

    // Fungsi Warehouse Mengajukan Pembelian (PR)
  const handleCreatePr = async (e) => {
    e.preventDefault();
    if (!prModalProduct) return;
    setIsSubmittingPr(true);
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/purchase-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: prModalProduct.id,
          quantity: Number(prForm.quantity),
          vendorName: prForm.vendorName,
          notes: prForm.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error);
      } else {
        setPrModalProduct(null);
      }
    } catch (err) {
      alert('Gagal mengajukan pembelian!');
    } finally {
      setIsSubmittingPr(false);
    }
  };

  // Fungsi Purchasing Setujui / Tolak / Bayar Vendor
  const handleUpdatePrStatus = async (prId, nextStatus) => {
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/purchase-requests/${prId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error);
    } catch (err) {
      alert('Gagal memperbarui status pengajuan!');
    }
  };

    // Fungsi Divisi Incoming Menerima Barang Fisik & Memunculkan Label QR Code
  const handleReceivePr = async (pr) => {
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/purchase-requests/${pr.id}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receivedQuantity: pr.quantity }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error);
      } else {
        // Otomatis tampilkan Label QR Code barang yang baru tiba!
        setQrModalItem(data.product);
      }
    } catch (err) {
      alert('Gagal memproses penerimaan barang!');
    }
  };

    // Hitung ringkasan stok
  const totalStock = products.reduce((acc, curr) => acc + curr.stock, 0);
  const lowStockCount = products.filter((p) => p.stock <= p.minStock).length;
  const overStockCount = products.filter((p) => p.stock > (p.maxStock ?? 100)).length;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-slate-800 gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-3">
              <Package className="text-blue-500 w-8 h-8" />
              Live Warehouse Management System
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Real-time stock monitoring & mobile scanner synchronization
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Pemilih Peran / Divisi Demo */}
            <div className="flex items-center gap-2 bg-slate-800 px-3 py-2 rounded-xl border border-slate-700">
              <span className="text-xs text-slate-400">Divisi Aktif:</span>
              <select
                value={activeRole}
                onChange={(e) => setActiveRole(e.target.value)}
                className="bg-slate-900 text-white text-xs font-bold px-2.5 py-1 rounded-lg border border-slate-700 focus:outline-none focus:border-blue-500">
                <option value="warehouse">🏢 Staff Warehouse</option>
                <option value="purchasing">💳 Tim Purchasing</option>
                <option value="incoming">📥 Divisi Incoming</option>
                <option value="outgoing">📤 Divisi Outgoing</option>
              </select>
            </div>
            <div className="flex items-center gap-3 bg-slate-800/80 px-4 py-2 rounded-full border border-slate-700 w-fit">
              <span className={`w-3 h-3 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
              <span className="text-xs font-medium text-slate-300">
                {isConnected ? 'WebSocket: Connected' : 'WebSocket: Disconnected'}
              </span>
            </div>
          </div>
        </div>

        {/* METRICS CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-slate-800/60 p-5 rounded-2xl border border-slate-700/60 shadow-lg">
            <div className="text-slate-400 text-sm font-medium">Total Jenis SKU</div>
            <div className="text-3xl font-bold mt-2 text-white">{products.length} Barang</div>
          </div>
          <div className="bg-slate-800/60 p-5 rounded-2xl border border-slate-700/60 shadow-lg">
            <div className="text-slate-400 text-sm font-medium">Total Fisik Unit Stok</div>
            <div className="text-3xl font-bold mt-2 text-blue-400">{totalStock} Unit</div>
          </div>
          <div className="bg-slate-800/60 p-5 rounded-2xl border border-slate-700/60 shadow-lg">
            <div className="text-slate-400 text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              Understock / Kritis
            </div>
            <div className="text-3xl font-bold mt-2 text-amber-400">{lowStockCount} SKU</div>
          </div>
          <div className="bg-slate-800/60 p-5 rounded-2xl border border-slate-700/60 shadow-lg">
            <div className="text-slate-400 text-sm font-medium flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-purple-400" />
              Overstock / Berlebih
            </div>
            <div className="text-3xl font-bold mt-2 text-purple-400">{overStockCount} SKU</div>
          </div>
        </div>

        {/* MAIN CONTENT: TABLE & LIVE FEED */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* TABEL STOK LIVE (2 KOLOM) */}
          <div className="lg:col-span-2 bg-slate-800/60 rounded-2xl border border-slate-700/60 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4 gap-3">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Package className="w-5 h-5 text-blue-400" />
                Daftar Stok Gudang (Real-time)
              </h2>
              <button
                onClick={() => setShowAddModal(true)}
                className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 transition active:scale-95">
                <Plus className="w-4 h-4" />
                Tambah Barang
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-900/50 text-slate-400 border-b border-slate-700">
                  <tr>
                    <th className="py-3 px-4">SKU / Nama</th>
                    <th className="py-3 px-4">Barcode</th>
                    <th className="py-3 px-4 text-center">Sisa Stok</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-center">Simulasi Scan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                                    {products.map((item) => {
                    const max = item.maxStock ?? 100;
                    const isLow = item.stock <= item.minStock;
                    const isOver = item.stock > max;
                    return (
                      <tr key={item.id} className="hover:bg-slate-700/30 transition">
                        <td className="py-4 px-4">
                          <div className="font-semibold text-white">{item.name}</div>
                          <div className="text-xs text-slate-400">{item.sku}</div>
                        </td>
                        <td className="py-4 px-4 font-mono text-slate-300 text-xs">
                          {item.barcode}
                        </td>
                        <td className="py-4 px-4 text-center">
                          <span className={`text-xl font-black ${
                            isLow ? 'text-rose-400' : isOver ? 'text-purple-400' : 'text-emerald-400'
                          }`}>
                            {item.stock}
                          </span>
                          <div className="text-[11px] text-slate-500">
                            Min {item.minStock} • Max {max}
                          </div>
                        </td>
                        <td className="py-4 px-4 text-center">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                            item.stock === 0
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : isLow
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : isOver
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          }`}>
                            {item.stock === 0
                              ? 'Habis'
                              : isLow
                              ? 'Understock'
                              : isOver
                              ? 'Overstock'
                              : 'Aman'}
                          </span>
                        </td>
                        <td className="py-4 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleSimulateScan(item.barcode)}
                              className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition active:scale-95"
                              title="Simulasi Scan Keluar"
                            >
                              <Scan className="w-3.5 h-3.5" />
                              -1
                            </button>
                            <button
                              onClick={() => {
                                setRestockModalItem(item);
                                setRestockQuantity(10);
                              }}
                              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition active:scale-95"
                              title="Restock Barang Masuk"
                            >
                              + Restock
                            </button>
                            <button
                              onClick={() => handleOpenInsights(item.id)}
                              disabled={isLoadingInsight}
                              className="bg-purple-600/80 hover:bg-purple-500 text-white text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition active:scale-95"
                              title="Analisis Understock & Overstock 30 Hari">
                              <BarChart3 className="w-3.5 h-3.5" />
                              Analisis
                            </button>
                            <button
                              onClick={() => {
                                setPrModalProduct(item);
                                setPrForm({
                                  quantity: Math.max(10, (item.maxStock ?? 100) - item.stock),
                                  vendorName: 'PT Sumber Makmur',
                                  notes: `Stok sisa ${item.stock} unit (batas min ${item.minStock})`,
                                });
                              }}
                              className="bg-amber-600 hover:bg-amber-500 text-white text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition active:scale-95"
                              title="Warehouse Lapor ke Purchasing"
                              >
                              <ShoppingCart className="w-3.5 h-3.5" />
                              PR
                            </button>
                            <button
                              onClick={() => setQrModalItem(item)}
                              className="bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs px-2 py-1.5 rounded-lg flex items-center gap-1 transition active:scale-95"
                              title="Tampilkan QR Code Barang">
                              <QrCode className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* PANEL NOTIFIKASI PER DIVISI (1 KOLOM) */}
          <div className="bg-slate-800/60 rounded-2xl border border-slate-700/60 p-6 shadow-xl flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Bell className="w-5 h-5 text-amber-400" />
                Notifikasi: <span className="uppercase text-blue-400">{activeRole}</span>
                {notifications.filter((n) => !n.isRead).length > 0 && (
                  <span className="bg-rose-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    {notifications.filter((n) => !n.isRead).length}
                  </span>
                )}
              </h2>
              {notifications.some((n) => !n.isRead) && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-slate-400 hover:text-white underline"
                >
                  Tandai dibaca
                </button>
              )}
            </div>

            <div className="space-y-3 flex-1 overflow-y-auto max-h-[420px]">
              {notifications.length === 0 ? (
                <div className="text-slate-500 text-center py-10 text-sm">
                  Belum ada notifikasi untuk divisi {activeRole}...
                </div>
              ) : (
                notifications.map((notif) => {
                  const badgeStyle =
                    notif.type === 'CRITICAL'
                      ? 'border-rose-500/50 bg-rose-500/10'
                      : notif.type === 'WARNING'
                      ? 'border-amber-500/50 bg-amber-500/10'
                      : notif.type === 'SUCCESS'
                      ? 'border-emerald-500/50 bg-emerald-500/10'
                      : 'border-slate-700/60 bg-slate-900/60';

                  return (
                    <div
                      key={notif.id}
                      className={`p-3 rounded-xl border ${badgeStyle} ${
                        !notif.isRead ? 'ring-1 ring-blue-500/40' : 'opacity-75'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span className="font-bold text-slate-200">{notif.title}</span>
                        <span>{new Date(notif.createdAt).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                        {notif.message}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>

                {/* PAPAN KANBAN ALUR PENGADAAN (WAREHOUSE -> PURCHASING -> VENDOR -> INCOMING) */}
        <div className="bg-slate-800/60 rounded-2xl border border-slate-700/60 p-6 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-2">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-amber-400" />
                Alur Pengadaan Barang (Purchase Request Board)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Warehouse Lapor Understock → Purchasing Setujui & Bayar Vendor → Incoming Terima Barang
              </p>
            </div>
            <span className="text-xs bg-slate-900 border border-slate-700 px-3 py-1.5 rounded-lg text-slate-300">
              Anda sedang berperan sebagai: <strong className="uppercase text-blue-400">{activeRole}</strong>
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { key: 'REQUESTED', title: '1. Diajukan Warehouse', color: 'border-amber-500/40' },
              { key: 'APPROVED', title: '2. Disetujui Purchasing', color: 'border-blue-500/40' },
              { key: 'PAID', title: '3. Vendor Dibayar (Dikirim)', color: 'border-purple-500/40' },
              { key: 'DONE', title: '4. Diterima / Selesai', color: 'border-emerald-500/40' },
            ].map((col) => {
              const items = purchaseRequests.filter((pr) =>
                col.key === 'DONE'
                  ? pr.status === 'RECEIVED' || pr.status === 'REJECTED'
                  : pr.status === col.key
              );

              return (
                <div key={col.key} className={`bg-slate-900/60 rounded-xl border ${col.color} p-3 flex flex-col gap-2.5 min-h-[220px]`}>
                  <div className="text-xs font-bold text-slate-300 flex justify-between items-center border-b border-slate-800 pb-2">
                    <span>{col.title}</span>
                    <span className="bg-slate-800 px-2 py-0.5 rounded-full text-slate-400">{items.length}</span>
                  </div>

                  {items.length === 0 ? (
                    <div className="text-xs text-slate-600 text-center my-auto py-8">Kosong</div>
                  ) : (
                    items.map((pr) => (
                      <div key={pr.id} className="bg-slate-800/90 border border-slate-700/70 rounded-lg p-3 space-y-2 text-xs">
                        <div className="font-bold text-white">{pr.product?.name}</div>
                        <div className="text-slate-400 flex justify-between">
                          <span>Pesanan: <strong className="text-amber-300">{pr.quantity} unit</strong></span>
                          <span>{pr.product?.sku}</span>
                        </div>
                        <div className="text-[11px] text-slate-400">Vendor: <span className="text-slate-200">{pr.vendorName}</span></div>
                        {pr.notes && <div className="text-[11px] text-slate-500 italic">"{pr.notes}"</div>}

                        {/* Tombol Aksi sesuai Status & Divisi Aktif */}
                        {pr.status === 'REQUESTED' && (
                          activeRole === 'purchasing' ? (
                            <div className="flex gap-1.5 pt-1">
                              <button
                                onClick={() => handleUpdatePrStatus(pr.id, 'APPROVED')}
                                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-1.5 rounded font-semibold"
                              >
                                ✅ Setujui
                              </button>
                              <button
                                onClick={() => handleUpdatePrStatus(pr.id, 'REJECTED')}
                                className="bg-rose-600/80 hover:bg-rose-500 text-white px-2.5 py-1.5 rounded font-semibold"
                              >
                                Tolak
                              </button>
                            </div>
                          ) : (
                            <div className="text-[11px] text-amber-400/80 pt-1">⏳ Menunggu persetujuan Purchasing</div>
                          )
                        )}

                        {pr.status === 'APPROVED' && (
                          activeRole === 'purchasing' ? (
                            <button
                              onClick={() => handleUpdatePrStatus(pr.id, 'PAID')}
                              className="w-full bg-purple-600 hover:bg-purple-500 text-white py-1.5 rounded font-semibold mt-1"
                            >
                              💳 Bayar Vendor Sekarang
                            </button>
                          ) : (
                            <div className="text-[11px] text-blue-400/80 pt-1">⏳ Menunggu pembayaran Purchasing</div>
                          )
                        )}

                        {pr.status === 'PAID' && (
                          activeRole === 'incoming' ? (
                            <button
                              onClick={() => handleReceivePr(pr)}
                              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-1.5 rounded font-bold mt-1 flex items-center justify-center gap-1"
                            >
                              <QrCode className="w-3.5 h-3.5" />
                              📦 Terima Barang & Buat QR
                            </button>
                          ) : (
                            <div className="text-[11px] text-purple-300 pt-1">
                              🚚 Barang dikirim — menunggu Divisi Incoming
                            </div>
                          )
                        )}

                        {(pr.status === 'RECEIVED' || pr.status === 'REJECTED') && (
                          <div className="pt-1 space-y-1.5">
                            <div className={`text-[11px] font-bold ${pr.status === 'RECEIVED' ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {pr.status === 'RECEIVED'
                                ? `✅ Diterima Incoming (+${pr.receivedQuantity ?? pr.quantity} unit)`
                                : '❌ Ditolak Purchasing'}
                            </div>
                            {pr.status === 'RECEIVED' && pr.product && (
                              <button
                                onClick={() => setQrModalItem(pr.product)}
                                className="w-full bg-slate-700 hover:bg-slate-600 text-slate-200 py-1 rounded text-[11px] font-semibold flex items-center justify-center gap-1"
                              >
                                <QrCode className="w-3 h-3" />
                                Lihat Label QR
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        </div>

      </div>

        {/* MODAL RESTOCK BARANG MASUK */}
        {restockModalItem && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-800 border border-slate-700 w-full max-w-md rounded-2xl p-6 shadow-2xl">
              <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
                📦 Restock Barang Masuk
              </h3>
              <p className="text-slate-400 text-sm mb-4">
                Tambahkan jumlah unit masuk dari supplier ke gudang.
              </p>

              <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-700/60 mb-4 space-y-1">
                <div className="text-sm font-semibold text-white">{restockModalItem.name}</div>
                <div className="text-xs text-slate-400">SKU: {restockModalItem.sku} • Barcode: {restockModalItem.barcode}</div>
                <div className="text-xs text-blue-400 mt-1 font-medium">Sisa Stok Saat Ini: {restockModalItem.stock} unit</div>
              </div>

              <form onSubmit={handleRestockSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Jumlah Unit Masuk (Pcs):
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={restockQuantity}
                    onChange={(e) => setRestockQuantity(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white font-bold text-lg focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>

                {restockModalItem.stock + Number(restockQuantity || 0) > (restockModalItem.maxStock ?? 100) && (
                  <div className="bg-purple-500/15 border border-purple-500/40 rounded-xl p-3 text-xs text-purple-200">
                    ⚠️ <strong>Peringatan Overstock:</strong> Total stok akan menjadi{' '}
                    <strong>{restockModalItem.stock + Number(restockQuantity || 0)} unit</strong>, melebihi batas maksimum ({restockModalItem.maxStock ?? 100} unit).
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setRestockModalItem(null)}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 py-2.5 rounded-xl text-sm font-semibold transition"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={isRestocking}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-xl text-sm font-bold transition flex items-center justify-center"
                  >
                    {isRestocking ? 'Memproses...' : 'Konfirmasi Masuk'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL TAMBAH BARANG BARU */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-800 border border-slate-700 w-full max-w-lg rounded-2xl p-6 shadow-2xl">
              <h3 className="text-xl font-bold text-white mb-1">➕ Tambah Barang Baru</h3>
              <p className="text-slate-400 text-sm mb-4">
                Kosongkan barcode agar dibuat otomatis oleh sistem.
              </p>

              <form onSubmit={handleAddSubmit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">SKU *</label>
                    <input
                      value={newProduct.sku}
                      onChange={(e) => setNewProduct({ ...newProduct, sku: e.target.value })}
                      placeholder="BRG-004"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Barcode (opsional)</label>
                    <input
                      value={newProduct.barcode}
                      onChange={(e) => setNewProduct({ ...newProduct, barcode: e.target.value })}
                      placeholder="Otomatis"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Nama Barang *</label>
                  <input
                    value={newProduct.name}
                    onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                    placeholder="Tas Ransel Eiger"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: 'stock', label: 'Stok Awal' },
                    { key: 'leadTimeDays', label: 'Lama Kirim Vendor (hari)' },
                    { key: 'minStock', label: 'Stok Minimum' },
                    { key: 'maxStock', label: 'Stok Maksimum' },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">{label}</label>
                      <input
                        type="number"
                        min="0"
                        value={newProduct[key]}
                        onChange={(e) => setNewProduct({ ...newProduct, [key]: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                        required
                      />
                    </div>
                  ))}
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => { setShowAddModal(false); setNewProduct(emptyForm); }}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 py-2.5 rounded-xl text-sm font-semibold transition"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={isAdding}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-bold transition"
                  >
                    {isAdding ? 'Menyimpan...' : 'Simpan Barang'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

                {/* MODAL ANALISIS UNDERSTOCK & OVERSTOCK */}
        {insightData && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-800 border border-slate-700 w-full max-w-lg rounded-2xl p-6 shadow-2xl space-y-4">
              <div>
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-purple-400" />
                  Analisis Stok 30 Hari Terakhir
                </h3>
                <p className="text-slate-400 text-sm">
                  {insightData.name} ({insightData.sku})
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-slate-900/70 p-3 rounded-xl border border-slate-700/60">
                  <div className="text-xs text-slate-400">Keluar 30 Hari</div>
                  <div className="text-lg font-bold text-white mt-1">{insightData.totalOut30d} unit</div>
                </div>
                <div className="bg-slate-900/70 p-3 rounded-xl border border-slate-700/60">
                  <div className="text-xs text-slate-400">Rata-rata / Hari</div>
                  <div className="text-lg font-bold text-blue-400 mt-1">{insightData.avgDailyUsage} unit</div>
                </div>
                <div className="bg-slate-900/70 p-3 rounded-xl border border-slate-700/60">
                  <div className="text-xs text-slate-400">Estimasi Habis</div>
                  <div className="text-lg font-bold text-amber-400 mt-1">
                    {insightData.daysUntilZero !== null ? `${insightData.daysUntilZero} hari` : 'Stabil'}
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-700 space-y-2 text-sm">
                <div className="font-semibold text-slate-200">💡 Kesimpulan Sistem ({insightData.status}):</div>
                <p className="text-slate-300 text-xs leading-relaxed">{insightData.advice}</p>
                <div className="pt-2 border-t border-slate-800 flex justify-between text-xs text-slate-400">
                  <span>Batas Saat Ini: <strong>Min {insightData.minStock} / Max {insightData.maxStock}</strong></span>
                  <span className="text-emerald-400">Saran Data: <strong>Min {insightData.recommendedMinStock} / Max {insightData.recommendedMaxStock}</strong></span>
                </div>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setInsightData(null)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 py-2.5 rounded-xl text-sm font-semibold transition"
                >
                  Tutup
                </button>
                <button
                  type="button"
                  onClick={handleApplyRecommendation}
                  className="flex-1 bg-purple-600 hover:bg-purple-500 text-white py-2.5 rounded-xl text-sm font-bold transition"
                >
                Terapkan Saran Min/Max
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL PENGAJUAN PEMBELIAN (WAREHOUSE -> PURCHASING) */}
        {prModalProduct && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-800 border border-slate-700 w-full max-w-md rounded-2xl p-6 shadow-2xl">
              <h3 className="text-xl font-bold text-white mb-1">📝 Ajukan Pembelian ke Purchasing</h3>
              <p className="text-slate-400 text-sm mb-4">
                Laporkan barang understock agar Purchasing segera memesan ke vendor.
              </p>

              <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-700 mb-4 text-xs space-y-1">
                <div className="font-bold text-white text-sm">{prModalProduct.name}</div>
                <div className="text-slate-400">
                  Stok Saat Ini: <strong className="text-rose-400">{prModalProduct.stock}</strong> • Min: {prModalProduct.minStock} • Max: {prModalProduct.maxStock ?? 100}
                </div>
              </div>

              <form onSubmit={handleCreatePr} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Jumlah Unit yang Diminta *</label>
                  <input
                    type="number"
                    min="1"
                    value={prForm.quantity}
                    onChange={(e) => setPrForm({ ...prForm, quantity: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Nama Vendor / Supplier</label>
                  <input
                    value={prForm.vendorName}
                    onChange={(e) => setPrForm({ ...prForm, vendorName: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Catatan untuk Purchasing</label>
                  <input
                    value={prForm.notes}
                    onChange={(e) => setPrForm({ ...prForm, notes: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setPrModalProduct(null)}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 py-2.5 rounded-xl text-sm font-semibold"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingPr}
                    className="flex-1 bg-amber-600 hover:bg-amber-500 text-white py-2.5 rounded-xl text-sm font-bold"
                  >
                    {isSubmittingPr ? 'Mengirim...' : 'Kirim ke Purchasing'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {/* MODAL LABEL QR CODE BARANG (SIAP SCAN HP / CETAK) */}
        {qrModalItem && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-slate-800 border border-slate-700 w-full max-w-sm rounded-2xl p-6 shadow-2xl text-center space-y-4">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 px-2.5 py-1 rounded-full border border-emerald-500/30">
                  Label Gudang Incoming
                </span>
                <h3 className="text-xl font-bold text-white mt-2">{qrModalItem.name}</h3>
                <p className="text-xs text-slate-400">SKU: {qrModalItem.sku}</p>
              </div>
              {/* Kotak Putih QR Code Agar Mudah Discan Kamera HP */}
              <div className="bg-white p-5 rounded-2xl inline-block mx-auto shadow-inner">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrModalItem.barcode)}`}
                  alt={qrModalItem.barcode}
                  className="w-48 h-48 mx-auto"
                />
                <div className="text-slate-900 font-mono font-bold text-sm mt-2 tracking-widest">
                  {qrModalItem.barcode}
                </div>
              </div>
              <p className="text-xs text-slate-400">
                Arahkan kamera aplikasi Scanner HP Anda ke QR di atas, atau cetak untuk ditempel di rak gudang.
              </p>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setQrModalItem(null)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 py-2.5 rounded-xl text-sm font-semibold transition"
                >
                  Tutup
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-xl text-sm font-bold transition"
                >
                  🖨️ Cetak Label
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}