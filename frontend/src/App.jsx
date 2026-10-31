import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { Package, AlertTriangle, Activity, Scan, ArrowDownRight } from 'lucide-react';

const SOCKET_SERVER_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

export default function App() {
  const [products, setProducts] = useState([]);
  const [logs, setLogs] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [restockModalItem, setRestockModalItem] = useState(null);
  const [restockQuantity, setRestockQuantity] = useState(10);
  const [isRestocking, setIsRestocking] = useState(false);

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

  useEffect(() => {
    fetchProducts();

    // 2. Hubungkan ke WebSocket Server
    const socket = io(SOCKET_SERVER_URL);

    socket.on('connect', () => {
      setIsConnected(true);
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

    return () => socket.disconnect();
  }, []);

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

  // Hitung ringkasan stok
  const totalStock = products.reduce((acc, curr) => acc + curr.stock, 0);
  const lowStockCount = products.filter((p) => p.stock <= p.minStock).length;

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
          <div className="flex items-center gap-3 bg-slate-800/80 px-4 py-2 rounded-full border border-slate-700 w-fit">
            <span className={`w-3 h-3 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            <span className="text-xs font-medium text-slate-300">
              {isConnected ? 'WebSocket: Connected' : 'WebSocket: Disconnected'}
            </span>
          </div>
        </div>

        {/* METRICS CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              Stok Kritis / Menipis
            </div>
            <div className="text-3xl font-bold mt-2 text-amber-400">{lowStockCount} SKU</div>
          </div>
        </div>

        {/* MAIN CONTENT: TABLE & LIVE FEED */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* TABEL STOK LIVE (2 KOLOM) */}
          <div className="lg:col-span-2 bg-slate-800/60 rounded-2xl border border-slate-700/60 p-6 shadow-xl">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Package className="w-5 h-5 text-blue-400" />
              Daftar Stok Gudang (Real-time)
            </h2>
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
                    const isLow = item.stock <= item.minStock;
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
                          <span className={`text-xl font-black ${isLow ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {item.stock}
                          </span>
                        </td>
                        <td className="py-4 px-4 text-center">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                            item.stock === 0
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : isLow
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          }`}>
                            {item.stock === 0 ? 'Habis' : isLow ? 'Menipis' : 'Aman'}
                          </span>
                        </td>
                        <td className="py-4 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleSimulateScan(item.barcode)}
                            className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition active:scale-95"
                            title="Simulasi Scan Keluar"
                          >
                            <Scan className="w-3.5 h-3.5" />
                            -1 Unit
                          </button>
                          <button
                            onClick={() => {
                              setRestockModalItem(item);
                              setRestockQuantity(10);
                            }}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition active:scale-95"
                            title="Restock Barang Masuk">
                            + Restock
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

          {/* LIVE ACTIVITY FEED (1 KOLOM) */}
          <div className="bg-slate-800/60 rounded-2xl border border-slate-700/60 p-6 shadow-xl flex flex-col">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-400" />
              Live Activity Log
            </h2>
            <div className="space-y-3 flex-1 overflow-y-auto max-h-[400px]">
              {logs.length === 0 ? (
                <div className="text-slate-500 text-center py-10 text-sm">
                  Belum ada aktivitas scan...
                </div>
              ) : (
                logs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 bg-slate-900/60 border border-slate-700/40 rounded-xl flex items-start gap-3"
                  >
                    <ArrowDownRight className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="text-xs text-slate-400 flex justify-between">
                        <span>{log.sku}</span>
                        <span>{log.time}</span>
                      </div>
                      <div className="text-sm font-medium text-slate-200 mt-0.5">
                        {log.text}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
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
    </div>
  );
}