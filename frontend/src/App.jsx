import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import {
  Package,
  AlertTriangle,
  Scan,
  Plus,
  BarChart3,
  Bell,
  ShoppingCart,
  QrCode,
  Pencil,
  Calendar,
  LayoutDashboard,
  Layers,
  Truck,
  Search,
  X,
} from 'lucide-react';

const SOCKET_SERVER_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

const ROLE_META = {
  warehouse: { label: 'Staff Warehouse', code: 'WH #101', badge: 'bg-blue-500' },
  purchasing: { label: 'Tim Purchasing', code: 'PR #204', badge: 'bg-amber-500' },
  incoming: { label: 'Divisi Incoming', code: 'IN #308', badge: 'bg-emerald-500' },
  outgoing: { label: 'Divisi Outgoing', code: 'OUT #412', badge: 'bg-purple-500' },
};

export default function App() {
  const [products, setProducts] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [activeNav, setActiveNav] = useState('dashboard'); // 'dashboard' | 'inventory' | 'procurement'
  const [searchQuery, setSearchQuery] = useState('');
  const [showNotifDrawer, setShowNotifDrawer] = useState(false);

  // State Modal Restock
  const [restockModalItem, setRestockModalItem] = useState(null);
  const [restockQuantity, setRestockQuantity] = useState(10);
  const [isRestocking, setIsRestocking] = useState(false);

  // State Modal Tambah Barang
  const emptyForm = { sku: '', name: '', barcode: '', stock: 0, minStock: 5, maxStock: 100, leadTimeDays: 7 };
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProduct, setNewProduct] = useState(emptyForm);
  const [isAdding, setIsAdding] = useState(false);

  // State Modal Analisis 30 Hari
  const [insightData, setInsightData] = useState(null);
  const [isLoadingInsight, setIsLoadingInsight] = useState(false);

  // State Divisi & Notifikasi
  const [activeRole, setActiveRole] = useState('warehouse');
  const [notifications, setNotifications] = useState([]);
  const socketRef = useRef(null);

  // State Purchase Request (Kanban)
  const [purchaseRequests, setPurchaseRequests] = useState([]);
  const [prModalProduct, setPrModalProduct] = useState(null);
  const [prForm, setPrForm] = useState({ quantity: 20, vendorName: 'PT Sumber Makmur', notes: '' });
  const [isSubmittingPr, setIsSubmittingPr] = useState(false);

  // State Modal QR & Modal Edit Manual
  const [qrModalItem, setQrModalItem] = useState(null);
  const [editModalItem, setEditModalItem] = useState(null);
  const [isEditing, setIsEditing] = useState(false);

  // 1. Ambil Data Barang (dilengkapi auto-retry jika database/server sedang cold start)
  const fetchProducts = async (retryCount = 0) => {
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/products`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setProducts(data);
      } else if (retryCount < 4) {
        setTimeout(() => fetchProducts(retryCount + 1), 3000);
      }
    } catch (err) {
      console.error('Gagal mengambil data:', err);
      if (retryCount < 4) {
        setTimeout(() => fetchProducts(retryCount + 1), 3000);
      }
    }
  };

  // 1B. Ambil Notifikasi Divisi
  const fetchNotifications = async (role) => {
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/notifications?role=${role}`);
      const data = await res.json();
      if (Array.isArray(data)) setNotifications(data);
    } catch (err) {
      console.error('Gagal mengambil notifikasi:', err);
    }
  };

  // 1C. Ambil Daftar Purchase Request
  const fetchPurchaseRequests = async (retryCount = 0) => {
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/purchase-requests`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setPurchaseRequests(data);
      } else if (retryCount < 4) {
        setTimeout(() => fetchPurchaseRequests(retryCount + 1), 3000);
      }
    } catch (err) {
      console.error('Gagal mengambil PR:', err);
      if (retryCount < 4) {
        setTimeout(() => fetchPurchaseRequests(retryCount + 1), 3000);
      }
    }
  };

  useEffect(() => {
    fetchProducts();
    fetchPurchaseRequests();

    const socket = io(SOCKET_SERVER_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      socket.emit('join:role', activeRole);
      fetchProducts();
      fetchPurchaseRequests();
      fetchNotifications(activeRole);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('stock:updated', ({ product }) => {
      setProducts((prev) => prev.map((p) => (p.id === product.id ? product : p)));
    });

    socket.on('product:created', ({ product }) => {
      setProducts((prev) => (prev.some((p) => p.id === product.id) ? prev : [product, ...prev]));
    });

    socket.on('product:updated', ({ product }) => {
      setProducts((prev) => prev.map((p) => (p.id === product.id ? product : p)));
    });

    socket.on('notification:new', (notif) => {
      setNotifications((prev) => [notif, ...prev.slice(0, 24)]);
    });

    socket.on('pr:updated', (pr) => {
      setPurchaseRequests((prev) => {
        const exists = prev.some((item) => item.id === pr.id);
        return exists ? prev.map((item) => (item.id === pr.id ? pr : item)) : [pr, ...prev];
      });
    });

    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    setNotifications([]);
    fetchNotifications(activeRole);
    if (socketRef.current?.connected) {
      socketRef.current.emit('join:role', activeRole);
    }
  }, [activeRole]);

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
      if (!res.ok) alert(data.error);
      else setRestockModalItem(null);
    } catch (err) {
      alert('Gagal terhubung ke backend!');
    } finally {
      setIsRestocking(false);
    }
  };

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
      if (!res.ok) alert(data.error);
      else {
        setShowAddModal(false);
        setNewProduct(emptyForm);
      }
    } catch (err) {
      alert('Gagal terhubung ke backend!');
    } finally {
      setIsAdding(false);
    }
  };

  const handleOpenInsights = async (productId) => {
    setIsLoadingInsight(true);
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/products/${productId}/insights`);
      const data = await res.json();
      if (!res.ok) alert(data.error);
      else setInsightData(data);
    } catch (err) {
      alert('Gagal mengambil analisis stok!');
    } finally {
      setIsLoadingInsight(false);
    }
  };

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
      if (!res.ok) alert(data.error);
      else setInsightData(null);
    } catch (err) {
      alert('Gagal memperbarui batas stok!');
    }
  };

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
      if (!res.ok) alert(data.error);
      else setPrModalProduct(null);
    } catch (err) {
      alert('Gagal mengajukan pembelian!');
    } finally {
      setIsSubmittingPr(false);
    }
  };

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

  const handleReceivePr = async (pr) => {
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/purchase-requests/${pr.id}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receivedQuantity: pr.quantity }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error);
      else setQrModalItem(data.product);
    } catch (err) {
      alert('Gagal memproses penerimaan barang!');
    }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editModalItem) return;
    setIsEditing(true);
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/products/${editModalItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editModalItem.name,
          minStock: Number(editModalItem.minStock),
          maxStock: Number(editModalItem.maxStock),
          leadTimeDays: Number(editModalItem.leadTimeDays),
        }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error);
      else setEditModalItem(null);
    } catch (err) {
      alert('Gagal menyimpan perubahan barang!');
    } finally {
      setIsEditing(false);
    }
  };

  // Ringkasan Metrik
  const totalStock = products.reduce((acc, curr) => acc + curr.stock, 0);
  const lowStockCount = products.filter((p) => p.stock <= p.minStock).length;
  const overStockCount = products.filter((p) => p.stock > (p.maxStock ?? 100)).length;
  const safeStockCount = Math.max(0, products.length - lowStockCount - overStockCount);
  const activePrCount = purchaseRequests.filter((pr) => ['REQUESTED', 'APPROVED', 'PAID'].includes(pr.status)).length;
  const unreadNotifCount = notifications.filter((n) => !n.isRead).length;

  // Filter pencarian tabel
  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.barcode.includes(searchQuery)
  );

  // Perhitungan Donut Chart SVG (Komposisi Status Stok)
  const totalSku = products.length || 1;
  const safePct = Math.round((safeStockCount / totalSku) * 100);
  const lowPct = Math.round((lowStockCount / totalSku) * 100);
  const overPct = Math.max(0, 100 - safePct - lowPct);

  const todayStr = new Date().toLocaleDateString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return (
    <div className="min-h-screen bg-[#171926] text-slate-100 flex font-sans">
      {/* SIDEBAR KIRI (Tampil di Tablet/Laptop md ke atas, di HP pindah ke Bottom Nav) */}
      <aside className="hidden md:flex w-20 bg-[#1e2132] border-r border-slate-800/80 flex-col items-center py-6 gap-8 shrink-0">
        {/* Logo */}
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <Package className="w-6 h-6 text-white" />
        </div>

        {/* Menu Ikon */}
        <nav className="flex flex-col gap-3 w-full items-center">
          {[
            { id: 'dashboard', icon: LayoutDashboard, title: 'Ringkasan Gudang' },
            { id: 'inventory', icon: Layers, title: 'Master Stok Barang' },
            { id: 'procurement', icon: Truck, title: 'Alur Pengadaan (PR)' },
          ].map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveNav(item.id)}
                title={item.title}
                className={`relative w-12 h-12 rounded-2xl flex items-center justify-center transition ${
                  active
                    ? 'bg-blue-500/15 text-blue-400'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                {active && (
                  <span className="absolute right-0 top-2.5 bottom-2.5 w-1 bg-blue-400 rounded-l-full" />
                )}
                <Icon className="w-5 h-5" />
              </button>
            );
          })}
        </nav>
      </aside>

      {/* KONTEN UTAMA */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* TOP HEADER BAR (Responsif di HP & Desktop) */}
        <header className="px-3.5 sm:px-6 py-3 sm:py-4 bg-[#1e2132]/70 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2.5 sm:gap-4">
          <div className="flex items-center gap-2.5 sm:gap-4 min-w-0">
            <div className="md:hidden w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-emerald-400 flex items-center justify-center shrink-0">
              <Package className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl md:text-2xl font-bold text-white tracking-tight truncate">
                Halo, {ROLE_META[activeRole]?.label}
              </h1>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                Live Warehouse & Procurement Synchronization
              </p>
            </div>
            <div className="hidden lg:flex items-center gap-2 bg-[#262a40] text-slate-300 text-xs font-medium px-3.5 py-2 rounded-xl border border-slate-700/60">
              <Calendar className="w-3.5 h-3.5 text-blue-400" />
              <span>{todayStr}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 ml-auto">
            {/* Indikator WebSocket */}
            <div className="hidden sm:flex items-center gap-2 bg-[#262a40] px-3 py-2 rounded-xl border border-slate-700/60">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
                }`}
              />
              <span className="text-xs text-slate-300">
                {isConnected ? 'Live Sync' : 'Offline'}
              </span>
            </div>

            {/* Tombol Lonceng Notifikasi (Membuka Drawer tanpa memanjangkan halaman) */}
            <button
              onClick={() => setShowNotifDrawer(!showNotifDrawer)}
              className="relative bg-[#262a40] hover:bg-slate-700/70 p-2 sm:p-2.5 rounded-xl border border-slate-700/60 transition"
              title="Notifikasi Divisi"
            >
              <Bell className="w-4 h-4 sm:w-5 sm:h-5 text-slate-200" />
              {unreadNotifCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] font-bold w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center">
                  {unreadNotifCount}
                </span>
              )}
            </button>

            {/* Pemilih Divisi bergaya Kartu Profil di Pojok Kanan Atas */}
            <div className="flex items-center gap-2 bg-[#262a40] pl-2 pr-2.5 py-1.5 rounded-xl border border-slate-700/60">
              <div
                className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full ${ROLE_META[activeRole]?.badge} flex items-center justify-center text-[10px] sm:text-xs font-extrabold text-white uppercase shrink-0`}
              >
                {activeRole.slice(0, 2)}
              </div>
              <div className="text-left">
                <select
                  value={activeRole}
                  onChange={(e) => setActiveRole(e.target.value)}
                  className="bg-transparent text-white text-[11px] sm:text-xs font-bold focus:outline-none cursor-pointer"
                >
                  <option value="warehouse" className="bg-slate-900">Staff Warehouse</option>
                  <option value="purchasing" className="bg-slate-900">Tim Purchasing</option>
                  <option value="incoming" className="bg-slate-900">Divisi Incoming</option>
                  <option value="outgoing" className="bg-slate-900">Divisi Outgoing</option>
                </select>
                <div className="text-[10px] text-slate-400 leading-none">
                  {ROLE_META[activeRole]?.code}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* ISI DASHBOARD */}
        <main className="p-3 sm:p-6 pb-24 md:pb-6 space-y-4 sm:space-y-6 max-w-[1440px] w-full mx-auto">
          {/* 4 KARTU METRIK ATAS (2x2 di layar HP, 4 berjejer di layar Desktop) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
            {/* Card 1 */}
            <div className="bg-[#23273a] p-3.5 sm:p-5 rounded-2xl border border-slate-700/40 shadow-lg">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0">
                  <Package className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </div>
                <span className="text-xs sm:text-sm text-slate-300 font-medium truncate">Total Fisik Stok</span>
              </div>
              <div className="text-xl sm:text-3xl font-extrabold text-white mt-2 sm:mt-3">{totalStock} Unit</div>
              <div className="flex items-center justify-between text-[11px] sm:text-xs mt-2 sm:mt-3 pt-2 border-t border-slate-700/40">
                <span className="text-slate-400 hidden sm:inline">Terdaftar</span>
                <span className="text-emerald-400 font-semibold bg-emerald-500/10 px-2 py-0.5 rounded-full">
                  {products.length} Jenis SKU
                </span>
              </div>
            </div>

            {/* Card 2 */}
            <div className="bg-[#23273a] p-3.5 sm:p-5 rounded-2xl border border-slate-700/40 shadow-lg">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                  <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </div>
                <span className="text-xs sm:text-sm text-slate-300 font-medium truncate">Stok Aman</span>
              </div>
              <div className="text-xl sm:text-3xl font-extrabold text-white mt-2 sm:mt-3">{safeStockCount} SKU</div>
              <div className="flex items-center justify-between text-[11px] sm:text-xs mt-2 sm:mt-3 pt-2 border-t border-slate-700/40">
                <span className="text-slate-400 hidden sm:inline">Rasio sehat</span>
                <span className="text-emerald-400 font-semibold bg-emerald-500/10 px-2 py-0.5 rounded-full">
                  {safePct}% Gudang
                </span>
              </div>
            </div>

            {/* Card 3 */}
            <div className="bg-[#23273a] p-3.5 sm:p-5 rounded-2xl border border-slate-700/40 shadow-lg">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </div>
                <span className="text-xs sm:text-sm text-slate-300 font-medium truncate">Under & Over</span>
              </div>
              <div className="text-xl sm:text-3xl font-extrabold text-white mt-2 sm:mt-3">
                {lowStockCount} <span className="text-xs sm:text-base font-normal text-slate-400">Min</span> / {overStockCount}{' '}
                <span className="text-xs sm:text-base font-normal text-slate-400">Max</span>
              </div>
              <div className="flex items-center justify-between text-[11px] sm:text-xs mt-2 sm:mt-3 pt-2 border-t border-slate-700/40">
                <span className="text-slate-400 hidden sm:inline">Perlu perhatian</span>
                <span className="text-rose-400 font-semibold bg-rose-500/10 px-2 py-0.5 rounded-full">
                  {lowStockCount + overStockCount} SKU
                </span>
              </div>
            </div>

            {/* Card 4 */}
            <div className="bg-[#23273a] p-3.5 sm:p-5 rounded-2xl border border-slate-700/40 shadow-lg">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                  <Truck className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </div>
                <span className="text-xs sm:text-sm text-slate-300 font-medium truncate">Pengadaan PR</span>
              </div>
              <div className="text-xl sm:text-3xl font-extrabold text-white mt-2 sm:mt-3">{activePrCount} Pesanan</div>
              <div className="flex items-center justify-between text-[11px] sm:text-xs mt-2 sm:mt-3 pt-2 border-t border-slate-700/40">
                <span className="text-slate-400 hidden sm:inline">Total riwayat PR</span>
                <span className="text-amber-300 font-semibold bg-amber-500/10 px-2 py-0.5 rounded-full">
                  {purchaseRequests.length} Transaksi
                </span>
              </div>
            </div>
          </div>

          {/* BARIS GRAFIK VISUAL (Persis seperti "Warehouse workload" di gambar referensi) */}
          {activeNav === 'dashboard' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              {/* Grafik Kiri: Donut Chart Komposisi Gudang */}
              <div className="bg-[#23273a] p-4 sm:p-6 rounded-2xl border border-slate-700/40 shadow-lg flex flex-col justify-between">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-white">Komposisi Beban Gudang</h2>
                    <p className="text-xs text-slate-400">Perbandingan status SKU secara real-time</p>
                  </div>
                  <span className="text-xs bg-[#1b1e2e] text-slate-300 px-3 py-1 rounded-lg border border-slate-700/50">
                    Total {products.length} SKU
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-around gap-6 my-auto py-2">
                  {/* Donut Chart dengan conic-gradient */}
                  <div
                    className="w-40 h-40 rounded-full flex items-center justify-center shadow-inner relative"
                    style={{
                      background: `conic-gradient(#3b82f6 0% ${safePct}%, #f59e0b ${safePct}% ${
                        safePct + lowPct
                      }%, #a855f7 ${safePct + lowPct}% 100%)`,
                    }}
                  >
                    <div className="w-24 h-24 rounded-full bg-[#23273a] flex flex-col items-center justify-center">
                      <span className="text-xl font-extrabold text-white">{safePct}%</span>
                      <span className="text-[10px] text-slate-400">Stok Ideal</span>
                    </div>
                  </div>

                  {/* Legenda bergaya badge seperti gambar referensi */}
                  <div className="space-y-3 text-xs w-full sm:w-auto">
                    <div className="flex items-center justify-between gap-6 bg-[#1b1e2e] px-3.5 py-2 rounded-xl border border-slate-700/40">
                      <span className="flex items-center gap-2 text-slate-200 font-medium">
                        <span className="w-3 h-3 rounded-full bg-blue-500" />
                        Aman (Ideal)
                      </span>
                      <span className="font-bold text-blue-400">{safeStockCount} SKU ({safePct}%)</span>
                    </div>
                    <div className="flex items-center justify-between gap-6 bg-[#1b1e2e] px-3.5 py-2 rounded-xl border border-slate-700/40">
                      <span className="flex items-center gap-2 text-slate-200 font-medium">
                        <span className="w-3 h-3 rounded-full bg-amber-500" />
                        Understock / Kritis
                      </span>
                      <span className="font-bold text-amber-400">{lowStockCount} SKU ({lowPct}%)</span>
                    </div>
                    <div className="flex items-center justify-between gap-6 bg-[#1b1e2e] px-3.5 py-2 rounded-xl border border-slate-700/40">
                      <span className="flex items-center gap-2 text-slate-200 font-medium">
                        <span className="w-3 h-3 rounded-full bg-purple-500" />
                        Overstock / Berlebih
                      </span>
                      <span className="font-bold text-purple-400">{overStockCount} SKU ({overPct}%)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Grafik Kanan: Perbandingan Stok Aktual vs Batas Min & Max per Barang */}
              <div className="bg-[#23273a] p-4 sm:p-6 rounded-2xl border border-slate-700/40 shadow-lg flex flex-col justify-between">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-white">Kapasitas Stok per SKU</h2>
                    <p className="text-xs text-slate-400">Stok saat ini dibandingkan dengan batas maksimum</p>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> Aman
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Under
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-purple-400" /> Over
                    </span>
                  </div>
                </div>

                <div className="space-y-3 max-h-[190px] overflow-y-auto pr-1">
                  {products.map((item) => {
                    const max = item.maxStock ?? 100;
                    const ratio = Math.min(100, Math.round((item.stock / Math.max(1, max)) * 100));
                    const isLow = item.stock <= item.minStock;
                    const isOver = item.stock > max;
                    const barColor = isLow
                      ? 'bg-amber-400'
                      : isOver
                      ? 'bg-purple-400'
                      : 'bg-emerald-400';

                    return (
                      <div key={item.id} className="space-y-1">
                        <div className="flex justify-between text-xs gap-2">
                          <span className="text-slate-200 font-medium truncate">
                            {item.name}
                          </span>
                          <span className="text-slate-400 font-mono shrink-0">
                            <strong className="text-white">{item.stock}</strong> / {max} unit (Min {item.minStock})
                          </span>
                        </div>
                        <div className="w-full h-2.5 bg-[#171926] rounded-full overflow-hidden">
                          <div
                            className={`h-full ${barColor} rounded-full transition-all duration-300`}
                            style={{ width: `${ratio}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TABEL MASTER STOK GUDANG (Dengan Scroll Internal agar tidak memanjang ke bawah) */}
          {(activeNav === 'dashboard' || activeNav === 'inventory') && (
            <div className="bg-[#23273a] rounded-2xl border border-slate-700/40 p-4 sm:p-6 shadow-lg">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                    <Package className="w-5 h-5 text-blue-400" />
                    Daftar Stok Gudang (Real-Time)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Tabel memiliki scroll otomatis jika barang sudah banyak
                  </p>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:flex-initial">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Cari SKU / nama..."
                      className="w-full bg-[#171926] border border-slate-700/60 rounded-xl pl-9 pr-3 py-2 sm:py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3.5 py-2 rounded-xl flex items-center gap-1.5 transition active:scale-95 shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    Tambah Barang
                  </button>
                </div>
              </div>

              {/* Kontainer Tabel dengan tinggi maksimal (max-h) supaya halaman tetap rapi */}
              <div className="overflow-x-auto max-h-[340px] overflow-y-auto pr-1">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#1b1e2e] text-slate-400 border-b border-slate-700/60 sticky top-0 z-10">
                    <tr>
                      <th className="py-3 px-4">SKU / Nama</th>
                      <th className="py-3 px-4">Barcode</th>
                      <th className="py-3 px-4 text-center">Stok & Batas</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4 text-center">Aksi Gudang</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/40">
                    {filteredProducts.map((item) => {
                      const max = item.maxStock ?? 100;
                      const isLow = item.stock <= item.minStock;
                      const isOver = item.stock > max;
                      return (
                        <tr key={item.id} className="hover:bg-slate-800/40 transition">
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-white">{item.name}</div>
                            <div className="text-xs text-slate-400">{item.sku}</div>
                          </td>
                          <td className="py-3.5 px-4 font-mono text-slate-300 text-xs">
                            {item.barcode}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <span
                              className={`text-lg font-black ${
                                isLow ? 'text-rose-400' : isOver ? 'text-purple-400' : 'text-emerald-400'
                              }`}
                            >
                              {item.stock}
                            </span>
                            <div className="text-[11px] text-slate-400">
                              Min {item.minStock} • Max {max}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <span
                              className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                                item.stock === 0
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                  : isLow
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  : isOver
                                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              }`}
                            >
                              {item.stock === 0 ? 'Habis' : isLow ? 'Understock' : isOver ? 'Overstock' : 'Aman'}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => handleSimulateScan(item.barcode)}
                                className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition active:scale-95"
                                title="Simulasi Scan Keluar (-1)"
                              >
                                <Scan className="w-3.5 h-3.5" />
                                -1
                              </button>
                              <button
                                onClick={() => {
                                  setRestockModalItem(item);
                                  setRestockQuantity(10);
                                }}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-2.5 py-1.5 rounded-lg transition active:scale-95"
                                title="Restock Barang Masuk"
                              >
                                + Restock
                              </button>
                              <button
                                onClick={() => handleOpenInsights(item.id)}
                                disabled={isLoadingInsight}
                                className="bg-purple-600/80 hover:bg-purple-500 text-white text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition active:scale-95"
                                title="Analisis 30 Hari"
                              >
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
                                title="Ajukan PR ke Purchasing"
                              >
                                <ShoppingCart className="w-3.5 h-3.5" />
                                PR
                              </button>
                              <button
                                onClick={() => setQrModalItem(item)}
                                className="bg-[#171926] hover:bg-slate-700 text-slate-200 text-xs p-1.5 rounded-lg border border-slate-700/60 transition"
                                title="Label QR Barang"
                              >
                                <QrCode className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() =>
                                  setEditModalItem({
                                    id: item.id,
                                    sku: item.sku,
                                    name: item.name,
                                    minStock: item.minStock,
                                    maxStock: item.maxStock ?? 100,
                                    leadTimeDays: item.leadTimeDays ?? 7,
                                  })
                                }
                                className="bg-[#171926] hover:bg-slate-700 text-amber-300 text-xs p-1.5 rounded-lg border border-slate-700/60 transition"
                                title="Edit Manual Nama & Min/Max"
                              >
                                <Pencil className="w-3.5 h-3.5" />
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
          )}

          {/* PAPAN KANBAN ALUR PENGADAAN (Setiap kolom dibatasi tingginya + scroll internal!) */}
          {(activeNav === 'dashboard' || activeNav === 'procurement') && (
            <div className="bg-[#23273a] rounded-2xl border border-slate-700/40 p-4 sm:p-6 shadow-lg">
              <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-2">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                    <ShoppingCart className="w-5 h-5 text-amber-400 shrink-0" />
                    Alur Pengadaan Barang (Purchase Request Board)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Setiap kolom dilengkapi scroll internal sehingga daftar tidak akan memanjang ke bawah
                  </p>
                </div>
                <span className="self-start md:self-auto text-xs bg-[#171926] border border-slate-700/60 px-3 py-1.5 rounded-xl text-slate-300">
                  Peran Aktif: <strong className="uppercase text-blue-400">{activeRole}</strong>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
                {[
                  { key: 'REQUESTED', title: '1. Diajukan Warehouse', color: 'border-amber-500/30' },
                  { key: 'APPROVED', title: '2. Disetujui Purchasing', color: 'border-blue-500/30' },
                  { key: 'PAID', title: '3. Vendor Dibayar', color: 'border-purple-500/30' },
                  { key: 'DONE', title: '4. Diterima / Selesai', color: 'border-emerald-500/30' },
                ].map((col) => {
                  const items = purchaseRequests.filter((pr) =>
                    col.key === 'DONE'
                      ? pr.status === 'RECEIVED' || pr.status === 'REJECTED'
                      : pr.status === col.key
                  );

                  return (
                    <div
                      key={col.key}
                      className={`bg-[#191c2b] rounded-xl border ${col.color} p-3 flex flex-col h-[310px]`}
                    >
                      <div className="text-xs font-bold text-slate-300 flex justify-between items-center border-b border-slate-800 pb-2 mb-2 shrink-0">
                        <span>{col.title}</span>
                        <span className="bg-[#23273a] px-2 py-0.5 rounded-full text-slate-300">
                          {items.length}
                        </span>
                      </div>

                      {/* Daftar Kartu dengan Scroll Internal (Tidak akan memanjang ke bawah!) */}
                      <div className="space-y-2.5 overflow-y-auto flex-1 pr-1">
                        {items.length === 0 ? (
                          <div className="text-xs text-slate-500 text-center py-16">Kosong</div>
                        ) : (
                          items.map((pr) => (
                            <div
                              key={pr.id}
                              className="bg-[#23273a] border border-slate-700/60 rounded-xl p-3 space-y-1.5 text-xs"
                            >
                              <div className="font-bold text-white">{pr.product?.name}</div>
                              <div className="text-slate-400 flex justify-between">
                                <span>
                                  Pesanan: <strong className="text-amber-300">{pr.quantity} unit</strong>
                                </span>
                                <span>{pr.product?.sku}</span>
                              </div>
                              <div className="text-[11px] text-slate-400">
                                Vendor: <span className="text-slate-200">{pr.vendorName}</span>
                              </div>
                              {pr.notes && (
                                <div className="text-[11px] text-slate-400 italic truncate" title={pr.notes}>
                                  "{pr.notes}"
                                </div>
                              )}

                              {pr.status === 'REQUESTED' &&
                                (activeRole === 'purchasing' ? (
                                  <div className="flex gap-1.5 pt-1">
                                    <button
                                      onClick={() => handleUpdatePrStatus(pr.id, 'APPROVED')}
                                      className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-1.5 rounded-lg font-semibold"
                                    >
                                      ✅ Setujui
                                    </button>
                                    <button
                                      onClick={() => handleUpdatePrStatus(pr.id, 'REJECTED')}
                                      className="bg-rose-600/80 hover:bg-rose-500 text-white px-2.5 py-1.5 rounded-lg font-semibold"
                                    >
                                      Tolak
                                    </button>
                                  </div>
                                ) : (
                                  <div className="text-[11px] text-amber-400/80 pt-1">
                                    ⏳ Menunggu Purchasing
                                  </div>
                                ))}

                              {pr.status === 'APPROVED' &&
                                (activeRole === 'purchasing' ? (
                                  <button
                                    onClick={() => handleUpdatePrStatus(pr.id, 'PAID')}
                                    className="w-full bg-purple-600 hover:bg-purple-500 text-white py-1.5 rounded-lg font-semibold mt-1"
                                  >
                                    💳 Bayar Vendor
                                  </button>
                                ) : (
                                  <div className="text-[11px] text-blue-400/80 pt-1">
                                    ⏳ Menunggu pembayaran
                                  </div>
                                ))}

                              {pr.status === 'PAID' &&
                                (activeRole === 'incoming' ? (
                                  <button
                                    onClick={() => handleReceivePr(pr)}
                                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-1.5 rounded-lg font-bold mt-1 flex items-center justify-center gap-1"
                                  >
                                    <QrCode className="w-3.5 h-3.5" />
                                    📦 Terima & Buat QR
                                  </button>
                                ) : (
                                  <div className="text-[11px] text-purple-300 pt-1">
                                    🚚 Menunggu Divisi Incoming
                                  </div>
                                ))}

                              {(pr.status === 'RECEIVED' || pr.status === 'REJECTED') && (
                                <div className="pt-1 space-y-1.5">
                                  <div
                                    className={`text-[11px] font-bold ${
                                      pr.status === 'RECEIVED' ? 'text-emerald-400' : 'text-rose-400'
                                    }`}
                                  >
                                    {pr.status === 'RECEIVED'
                                      ? `✅ Diterima Incoming (+${pr.receivedQuantity ?? pr.quantity} unit)`
                                      : '❌ Ditolak Purchasing'}
                                  </div>
                                  {pr.status === 'RECEIVED' && pr.product && (
                                    <button
                                      onClick={() => setQrModalItem(pr.product)}
                                      className="w-full bg-[#171926] hover:bg-slate-700 text-slate-200 py-1 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 border border-slate-700/60"
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
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* MOBILE BOTTOM NAVIGATION BAR (Hanya muncul di layar HP < md) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-[#1e2132]/95 backdrop-blur-md border-t border-slate-800 px-3 py-2 flex items-center justify-around z-30">
        {[
          { id: 'dashboard', icon: LayoutDashboard, label: 'Ringkasan' },
          { id: 'inventory', icon: Layers, label: 'Master Stok' },
          { id: 'procurement', icon: Truck, label: 'Pengadaan PR' },
        ].map((item) => {
          const Icon = item.icon;
          const active = activeNav === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`flex-1 py-1.5 rounded-xl flex flex-col items-center gap-1 text-[11px] font-semibold transition ${
                active ? 'text-blue-400 bg-blue-500/10' : 'text-slate-400'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* DRAWER NOTIFIKASI DIVISI (Muncul saat klik ikon lonceng di atas) */}
      {showNotifDrawer && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-40 flex justify-end">
          <div className="bg-[#1e2132] border-l border-slate-700/70 w-full max-w-md h-full p-6 flex flex-col shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-white">
                  Notifikasi Divisi: <span className="uppercase text-blue-400">{activeRole}</span>
                </h3>
              </div>
              <div className="flex items-center gap-3">
                {unreadNotifCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-xs text-blue-400 hover:underline"
                  >
                    Tandai dibaca
                  </button>
                )}
                <button
                  onClick={() => setShowNotifDrawer(false)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="space-y-3 flex-1 overflow-y-auto mt-4 pr-1">
              {notifications.length === 0 ? (
                <div className="text-slate-500 text-center py-16 text-sm">
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
                      : 'border-slate-700/60 bg-[#171926]';

                  return (
                    <div
                      key={notif.id}
                      className={`p-3.5 rounded-xl border ${badgeStyle} ${
                        !notif.isRead ? 'ring-1 ring-blue-500/40' : 'opacity-75'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span className="font-bold text-slate-200">{notif.title}</span>
                        <span>{new Date(notif.createdAt).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed">{notif.message}</p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL RESTOCK BARANG MASUK */}
      {restockModalItem && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#23273a] border border-slate-700 w-full max-w-md rounded-2xl p-6 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-1">📦 Restock Barang Masuk</h3>
            <p className="text-slate-400 text-sm mb-4">
              Tambahkan jumlah unit masuk dari supplier ke gudang.
            </p>

            <div className="bg-[#171926] p-4 rounded-xl border border-slate-700/60 mb-4 space-y-1">
              <div className="text-sm font-semibold text-white">{restockModalItem.name}</div>
              <div className="text-xs text-slate-400">
                SKU: {restockModalItem.sku} • Barcode: {restockModalItem.barcode}
              </div>
              <div className="text-xs text-blue-400 mt-1 font-medium">
                Sisa Stok Saat Ini: {restockModalItem.stock} unit
              </div>
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
                  className="w-full bg-[#171926] border border-slate-700 rounded-xl px-4 py-2.5 text-white font-bold text-lg focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              {restockModalItem.stock + Number(restockQuantity || 0) >
                (restockModalItem.maxStock ?? 100) && (
                <div className="bg-purple-500/15 border border-purple-500/40 rounded-xl p-3 text-xs text-purple-200">
                  ⚠️ <strong>Peringatan Overstock:</strong> Total stok akan menjadi{' '}
                  <strong>{restockModalItem.stock + Number(restockQuantity || 0)} unit</strong>,
                  melebihi batas maksimum ({restockModalItem.maxStock ?? 100} unit).
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
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-xl text-sm font-bold transition"
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
          <div className="bg-[#23273a] border border-slate-700 w-full max-w-lg rounded-2xl p-6 shadow-2xl">
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
                    placeholder="BRG-006"
                    className="w-full bg-[#171926] border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Barcode (opsional)
                  </label>
                  <input
                    value={newProduct.barcode}
                    onChange={(e) => setNewProduct({ ...newProduct, barcode: e.target.value })}
                    placeholder="Otomatis"
                    className="w-full bg-[#171926] border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Nama Barang *
                </label>
                <input
                  value={newProduct.name}
                  onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                  placeholder="Helm Safety Proyek"
                  className="w-full bg-[#171926] border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
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
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      {label}
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={newProduct[key]}
                      onChange={(e) => setNewProduct({ ...newProduct, [key]: e.target.value })}
                      className="w-full bg-[#171926] border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                      required
                    />
                  </div>
                ))}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setNewProduct(emptyForm);
                  }}
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
          <div className="bg-[#23273a] border border-slate-700 w-full max-w-lg rounded-2xl p-6 shadow-2xl space-y-4">
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
              <div className="bg-[#171926] p-3 rounded-xl border border-slate-700/60">
                <div className="text-xs text-slate-400">Keluar 30 Hari</div>
                <div className="text-lg font-bold text-white mt-1">
                  {insightData.totalOut30d} unit
                </div>
              </div>
              <div className="bg-[#171926] p-3 rounded-xl border border-slate-700/60">
                <div className="text-xs text-slate-400">Rata-rata / Hari</div>
                <div className="text-lg font-bold text-blue-400 mt-1">
                  {insightData.avgDailyUsage} unit
                </div>
              </div>
              <div className="bg-[#171926] p-3 rounded-xl border border-slate-700/60">
                <div className="text-xs text-slate-400">Estimasi Habis</div>
                <div className="text-lg font-bold text-amber-400 mt-1">
                  {insightData.daysUntilZero !== null ? `${insightData.daysUntilZero} hari` : 'Stabil'}
                </div>
              </div>
            </div>

            <div className="bg-[#171926] p-4 rounded-xl border border-slate-700 space-y-2 text-sm">
              <div className="font-semibold text-slate-200">
                💡 Kesimpulan Sistem ({insightData.status}):
              </div>
              <p className="text-slate-300 text-xs leading-relaxed">{insightData.advice}</p>
              <div className="pt-2 border-t border-slate-800 flex justify-between text-xs text-slate-400">
                <span>
                  Batas Saat Ini:{' '}
                  <strong>
                    Min {insightData.minStock} / Max {insightData.maxStock}
                  </strong>
                </span>
                <span className="text-emerald-400">
                  Saran Data:{' '}
                  <strong>
                    Min {insightData.recommendedMinStock} / Max {insightData.recommendedMaxStock}
                  </strong>
                </span>
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
          <div className="bg-[#23273a] border border-slate-700 w-full max-w-md rounded-2xl p-6 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-1">📝 Ajukan Pembelian ke Purchasing</h3>
            <p className="text-slate-400 text-sm mb-4">
              Laporkan barang understock agar Purchasing segera memesan ke vendor.
            </p>

            <div className="bg-[#171926] p-3 rounded-xl border border-slate-700 mb-4 text-xs space-y-1">
              <div className="font-bold text-white text-sm">{prModalProduct.name}</div>
              <div className="text-slate-400">
                Stok Saat Ini: <strong className="text-rose-400">{prModalProduct.stock}</strong> •
                Min: {prModalProduct.minStock} • Max: {prModalProduct.maxStock ?? 100}
              </div>
            </div>

            <form onSubmit={handleCreatePr} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Jumlah Unit yang Diminta *
                </label>
                <input
                  type="number"
                  min="1"
                  value={prForm.quantity}
                  onChange={(e) => setPrForm({ ...prForm, quantity: e.target.value })}
                  className="w-full bg-[#171926] border border-slate-700 rounded-xl px-3 py-2 text-white font-bold"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Nama Vendor / Supplier
                </label>
                <input
                  value={prForm.vendorName}
                  onChange={(e) => setPrForm({ ...prForm, vendorName: e.target.value })}
                  className="w-full bg-[#171926] border border-slate-700 rounded-xl px-3 py-2 text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Catatan untuk Purchasing
                </label>
                <input
                  value={prForm.notes}
                  onChange={(e) => setPrForm({ ...prForm, notes: e.target.value })}
                  className="w-full bg-[#171926] border border-slate-700 rounded-xl px-3 py-2 text-white"
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

      {/* MODAL LABEL QR CODE BARANG */}
      {qrModalItem && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#23273a] border border-slate-700 w-full max-w-sm rounded-2xl p-6 shadow-2xl text-center space-y-4">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 px-2.5 py-1 rounded-full border border-emerald-500/30">
                Label Gudang Incoming
              </span>
              <h3 className="text-xl font-bold text-white mt-2">{qrModalItem.name}</h3>
              <p className="text-xs text-slate-400">SKU: {qrModalItem.sku}</p>
            </div>

            <div className="bg-white p-5 rounded-2xl inline-block mx-auto shadow-inner">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
                  qrModalItem.barcode
                )}`}
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

      {/* MODAL EDIT MANUAL BARANG */}
      {editModalItem && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#23273a] border border-slate-700 w-full max-w-md rounded-2xl p-6 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
              <Pencil className="w-5 h-5 text-amber-400" />
              Edit Data & Batas Stok ({editModalItem.sku})
            </h3>
            <p className="text-slate-400 text-xs mb-4">
              Atur batas Understock (Min) dan Overstock (Max) secara manual.
            </p>

            <form onSubmit={handleEditSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Nama Barang *
                </label>
                <input
                  value={editModalItem.name}
                  onChange={(e) => setEditModalItem({ ...editModalItem, name: e.target.value })}
                  className="w-full bg-[#171926] border border-slate-700 rounded-xl px-3 py-2 text-white"
                  required
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Stok Min *
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editModalItem.minStock}
                    onChange={(e) =>
                      setEditModalItem({ ...editModalItem, minStock: e.target.value })
                    }
                    className="w-full bg-[#171926] border border-slate-700 rounded-xl px-3 py-2 text-white font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Stok Max *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={editModalItem.maxStock}
                    onChange={(e) =>
                      setEditModalItem({ ...editModalItem, maxStock: e.target.value })
                    }
                    className="w-full bg-[#171926] border border-slate-700 rounded-xl px-3 py-2 text-white font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Lead Time (hr)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={editModalItem.leadTimeDays}
                    onChange={(e) =>
                      setEditModalItem({ ...editModalItem, leadTimeDays: e.target.value })
                    }
                    className="w-full bg-[#171926] border border-slate-700 rounded-xl px-3 py-2 text-white"
                    required
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditModalItem(null)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 py-2.5 rounded-xl text-sm font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isEditing}
                  className="flex-1 bg-amber-600 hover:bg-amber-500 text-white py-2.5 rounded-xl text-sm font-bold"
                >
                  {isEditing ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
