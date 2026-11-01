import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StatusBar,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { Camera } from 'react-native-camera-kit';

// URL Cloud Backend Render (Online 24 Jam via Kuota Data / Wi-Fi)
const API_BASE_URL = 'https://warehouse-management-system-backend-q5ms.onrender.com';

type TabType = 'scanner' | 'stock' | 'procurement';
type ScanMode = 'OUT' | 'IN';
type RoleType = 'warehouse' | 'purchasing' | 'incoming' | 'outgoing';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('scanner');
  const [scanMode, setScanMode] = useState<ScanMode>('OUT');
  const [inboundQty, setInboundQty] = useState<number>(5);
  const [activeRole, setActiveRole] = useState<RoleType>('outgoing');

  // State Kamera Scanner
  const [isScanning, setIsScanning] = useState(true);
  const [loading, setLoading] = useState(false);
  const [scannedItem, setScannedItem] = useState<any>(null);

  // State Data Stok, PR, & Notifikasi
  const [products, setProducts] = useState<any[]>([]);
  const [purchaseRequests, setPurchaseRequests] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAllData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [prodRes, prRes, notifRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/products`),
        fetch(`${API_BASE_URL}/api/purchase-requests`),
        fetch(`${API_BASE_URL}/api/notifications?role=${activeRole}`),
      ]);

      const [prodData, prData, notifData] = await Promise.all([
        prodRes.json(),
        prRes.json(),
        notifRes.json(),
      ]);

      if (Array.isArray(prodData)) setProducts(prodData);
      if (Array.isArray(prData)) setPurchaseRequests(prData);
      if (Array.isArray(notifData)) setNotifications(notifData);
    } catch (err) {
      console.log('Gagal memuat data cloud:', err);
    } finally {
      setRefreshing(false);
    }
  }, [activeRole]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData, activeTab]);

  // Fungsi saat barcode/QR terbaca oleh kamera
  const onReadCode = async (event: any) => {
    if (!isScanning || loading) return;

    const barcodeValue = event.nativeEvent?.codeStringValue;
    if (!barcodeValue) return;

    setIsScanning(false);
    setLoading(true);

    try {
      const endpoint =
        scanMode === 'OUT'
          ? `${API_BASE_URL}/api/products/reduce-stock`
          : `${API_BASE_URL}/api/products/restock`;

      const payload =
        scanMode === 'OUT'
          ? { barcode: barcodeValue, quantity: 1 }
          : { barcode: barcodeValue, quantity: inboundQty, notes: 'Restock via Mobile Scanner' };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (response.ok) {
        setScannedItem(result.data);
        fetchAllData();
      } else {
        Alert.alert('Gagal', result.error || 'Barcode tidak terdaftar di database!');
      }
    } catch (error) {
      Alert.alert(
        'Koneksi Gagal',
        `Tidak bisa menghubungi server Cloud (${API_BASE_URL}). Pastikan internet HP aktif!`,
      );
    } finally {
      setLoading(false);
    }
  };

  // Fungsi Cepat Ajukan PR dari HP saat barang Understock
  const handleQuickPr = async (item: any) => {
    const qty = Math.max(10, (item.maxStock ?? 100) - item.stock);
    try {
      const res = await fetch(`${API_BASE_URL}/api/purchase-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: item.id,
          quantity: qty,
          vendorName: 'PT Sumber Makmur',
          notes: `Dilaporkan via HP Scanner (Sisa stok ${item.stock} unit)`,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('Terkirim ke Purchasing!', `Pengajuan ${qty} unit ${item.name} berhasil dibuat.`);
        fetchAllData();
      } else {
        Alert.alert('Gagal', data.error || 'Gagal membuat PR.');
      }
    } catch (e) {
      Alert.alert('Error', 'Gagal menghubungi server.');
    }
  };

  // Fungsi Terima Barang PR oleh Divisi Incoming dari HP
  const handleReceivePrMobile = async (pr: any) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/purchase-requests/${pr.id}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receivedQuantity: pr.quantity }),
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert(
          'Barang Diterima!',
          `+${pr.quantity} unit ${pr.product?.name} resmi masuk ke stok gudang.`,
        );
        fetchAllData();
      } else {
        Alert.alert('Gagal', data.error || 'Gagal menerima barang.');
      }
    } catch (e) {
      Alert.alert('Error', 'Gagal menghubungi server.');
    }
  };

  const totalStock = products.reduce((sum, p) => sum + (p.stock || 0), 0);
  const lowCount = products.filter((p) => p.stock <= p.minStock).length;
  const overCount = products.filter((p) => p.stock > (p.maxStock ?? 100)).length;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* TOP BAR */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>WMS Mobile Live</Text>
          <Text style={styles.headerSubtitle}>
            Divisi: {activeRole.toUpperCase()} • {products.length} SKU ({totalStock} Unit)
          </Text>
        </View>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>Cloud Sync</Text>
        </View>
      </View>

      {/* ISI HALAMAN BERDASARKAN MENU TAB */}
      <View style={styles.body}>
        {activeTab === 'scanner' && (
          <View style={styles.flex1}>
            {/* Pemilih Mode Scan: Outgoing (-1) vs Incoming (+Masuk) */}
            <View style={styles.modeSwitchBar}>
              <TouchableOpacity
                style={[styles.modeBtn, scanMode === 'OUT' && styles.modeBtnOutActive]}
                onPress={() => {
                  setScanMode('OUT');
                  setActiveRole('outgoing');
                }}>
                <Text style={[styles.modeBtnText, scanMode === 'OUT' && styles.textWhite]}>
                  📤 Outgoing (-1 Unit)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeBtn, scanMode === 'IN' && styles.modeBtnInActive]}
                onPress={() => {
                  setScanMode('IN');
                  setActiveRole('incoming');
                }}>
                <Text style={[styles.modeBtnText, scanMode === 'IN' && styles.textWhite]}>
                  📥 Incoming (+{inboundQty} Unit)
                </Text>
              </TouchableOpacity>
            </View>

            {scanMode === 'IN' && (
              <View style={styles.qtyChipRow}>
                <Text style={styles.qtyLabel}>Jumlah Masuk per Scan:</Text>
                {[1, 5, 10, 25].map((n) => (
                  <TouchableOpacity
                    key={n}
                    onPress={() => setInboundQty(n)}
                    style={[styles.qtyChip, inboundQty === n && styles.qtyChipActive]}>
                    <Text style={[styles.qtyChipText, inboundQty === n && styles.textWhite]}>
                      +{n}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* KAMERA SCANNER */}
            <View style={styles.cameraWrapper}>
              <Camera
                style={StyleSheet.absoluteFill}
                scanBarcode={isScanning}
                onReadCode={onReadCode}
                showFrame={false}
              />

              {/* Bingkai Kotak QR Persegi Presisi (220x220) di Tengah Kamera */}
              <View style={styles.qrFrameOverlay} pointerEvents="none">
                <View
                  style={[
                    styles.qrSquareBox,
                    { borderColor: scanMode === 'OUT' ? 'rgba(56, 189, 248, 0.25)' : 'rgba(52, 211, 153, 0.25)' },
                  ]}>
                  <View
                    style={[
                      styles.cornerTL,
                      { borderColor: scanMode === 'OUT' ? '#38bdf8' : '#34d399' },
                    ]}
                  />
                  <View
                    style={[
                      styles.cornerTR,
                      { borderColor: scanMode === 'OUT' ? '#38bdf8' : '#34d399' },
                    ]}
                  />
                  <View
                    style={[
                      styles.cornerBL,
                      { borderColor: scanMode === 'OUT' ? '#38bdf8' : '#34d399' },
                    ]}
                  />
                  <View
                    style={[
                      styles.cornerBR,
                      { borderColor: scanMode === 'OUT' ? '#38bdf8' : '#34d399' },
                    ]}
                  />
                  <View
                    style={[
                      styles.laserLine,
                      { backgroundColor: scanMode === 'OUT' ? '#38bdf8' : '#34d399' },
                    ]}
                  />
                </View>
              </View>

              {loading && (
                <View style={styles.loadingOverlay}>
                  <ActivityIndicator size="large" color="#38bdf8" />
                  <Text style={styles.loadingText}>Menyinkronkan ke Cloud & Redis...</Text>
                </View>
              )}
            </View>

            {/* HASIL SCAN */}
            <View style={styles.scannerFooter}>
              {scannedItem ? (
                <View style={styles.resultBox}>
                  <Text
                    style={[
                      styles.successBadge,
                      scanMode === 'IN' ? { color: '#34d399' } : { color: '#38bdf8' },
                    ]}>
                    {scanMode === 'OUT'
                      ? '✅ Barang Keluar (-1 Unit)'
                      : `✅ Barang Masuk (+${inboundQty} Unit)`}
                  </Text>
                  <Text style={styles.productName}>{scannedItem.name}</Text>
                  <Text style={styles.stockInfo}>
                    Sisa Stok: <Text style={styles.stockBold}>{scannedItem.stock} unit</Text> (Min{' '}
                    {scannedItem.minStock} • Max {scannedItem.maxStock ?? 100})
                  </Text>

                  {scannedItem.stock <= scannedItem.minStock && (
                    <TouchableOpacity
                      style={styles.prAlertBtn}
                      onPress={() => handleQuickPr(scannedItem)}>
                      <Text style={styles.prAlertBtnText}>
                        ⚠️ Stok Menipis! Klik untuk Lapor ke Purchasing
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <Text style={styles.hintText}>
                  Arahkan kamera ke Barcode / QR Code barang di layar atau label rak
                </Text>
              )}

              {!isScanning && (
                <TouchableOpacity
                  style={styles.scanAgainBtn}
                  onPress={() => {
                    setScannedItem(null);
                    setIsScanning(true);
                  }}>
                  <Text style={styles.scanAgainBtnText}>Scan Barang Berikutnya</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* TAB 2: DAFTAR STOK GUDANG */}
        {activeTab === 'stock' && (
          <ScrollView
            style={styles.scrollArea}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchAllData} />}>
            {/* 3 Kartu Ringkasan */}
            <View style={styles.kpiRow}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Total Unit</Text>
                <Text style={[styles.kpiValue, { color: '#38bdf8' }]}>{totalStock}</Text>
              </View>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Understock</Text>
                <Text style={[styles.kpiValue, { color: '#fbbf24' }]}>{lowCount}</Text>
              </View>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Overstock</Text>
                <Text style={[styles.kpiValue, { color: '#c084fc' }]}>{overCount}</Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Daftar Barang Gudang</Text>
            {products.map((item) => {
              const max = item.maxStock ?? 100;
              const isLow = item.stock <= item.minStock;
              const isOver = item.stock > max;
              const statusText =
                item.stock === 0 ? 'Habis' : isLow ? 'Understock' : isOver ? 'Overstock' : 'Aman';
              const statusColor =
                item.stock === 0
                  ? '#f43f5e'
                  : isLow
                  ? '#fbbf24'
                  : isOver
                  ? '#c084fc'
                  : '#34d399';

              return (
                <View key={item.id} style={styles.itemCard}>
                  <View style={styles.itemRowTop}>
                    <View style={styles.flex1}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <Text style={styles.itemMeta}>
                        {item.sku} • Barcode: {item.barcode}
                      </Text>
                    </View>
                    <View style={[styles.statusPill, { borderColor: statusColor }]}>
                      <Text style={[styles.statusPillText, { color: statusColor }]}>
                        {statusText}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.itemRowBottom}>
                    <Text style={styles.itemStockText}>
                      Stok: <Text style={styles.itemStockNumber}>{item.stock}</Text> (Min{' '}
                      {item.minStock} / Max {max})
                    </Text>
                    <TouchableOpacity
                      style={styles.smallPrBtn}
                      onPress={() => handleQuickPr(item)}>
                      <Text style={styles.smallPrBtnText}>+ Ajukan PR</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}

        {/* TAB 3: NOTIFIKASI DIVISI & PENERIMAAN BARANG (PR) */}
        {activeTab === 'procurement' && (
          <ScrollView
            style={styles.scrollArea}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchAllData} />}>
            {/* Pemilih Divisi di HP */}
            <Text style={styles.sectionTitle}>Pilih Peran Divisi Anda:</Text>
            <View style={styles.roleRow}>
              {(['warehouse', 'purchasing', 'incoming', 'outgoing'] as RoleType[]).map((r) => (
                <TouchableOpacity
                  key={r}
                  onPress={() => setActiveRole(r)}
                  style={[styles.roleChip, activeRole === r && styles.roleChipActive]}>
                  <Text style={[styles.roleChipText, activeRole === r && styles.textWhite]}>
                    {r.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Daftar Pesanan Vendor yang Siap Diterima Incoming */}
            <Text style={styles.sectionTitle}>
              Alur Pengadaan Aktif ({purchaseRequests.length})
            </Text>
            {purchaseRequests.slice(0, 8).map((pr) => (
              <View key={pr.id} style={styles.itemCard}>
                <View style={styles.itemRowTop}>
                  <Text style={styles.itemName}>{pr.product?.name}</Text>
                  <Text style={styles.prStatusBadge}>{pr.status}</Text>
                </View>
                <Text style={styles.itemMeta}>
                  Pesanan: {pr.quantity} unit • Vendor: {pr.vendorName}
                </Text>

                {pr.status === 'PAID' && (
                  <TouchableOpacity
                    style={styles.receiveBtn}
                    onPress={() => handleReceivePrMobile(pr)}>
                    <Text style={styles.receiveBtnText}>
                      📦 Terima Barang Masuk (+{pr.quantity} Unit)
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}

            {/* Notifikasi Divisi */}
            <Text style={styles.sectionTitle}>
              Notifikasi Divisi {activeRole.toUpperCase()} ({notifications.length})
            </Text>
            {notifications.length === 0 ? (
              <Text style={styles.emptyText}>Belum ada notifikasi untuk divisi ini.</Text>
            ) : (
              notifications.slice(0, 10).map((n) => (
                <View key={n.id} style={styles.notifCard}>
                  <Text style={styles.notifTitle}>{n.title}</Text>
                  <Text style={styles.notifMsg}>{n.message}</Text>
                </View>
              ))
            )}
          </ScrollView>
        )}
      </View>

      {/* BOTTOM NAVIGATION MENU (3 TAB) */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={[styles.navItem, activeTab === 'scanner' && styles.navItemActive]}
          onPress={() => setActiveTab('scanner')}>
          <Text style={[styles.navText, activeTab === 'scanner' && styles.navTextActive]}>
            📷 Scanner
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navItem, activeTab === 'stock' && styles.navItemActive]}
          onPress={() => setActiveTab('stock')}>
          <Text style={[styles.navText, activeTab === 'stock' && styles.navTextActive]}>
            📦 Stok ({products.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navItem, activeTab === 'procurement' && styles.navItemActive]}
          onPress={() => setActiveTab('procurement')}>
          <Text style={[styles.navText, activeTab === 'procurement' && styles.navTextActive]}>
            🔔 PR & Info
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#171926' },
  flex1: { flex: 1 },
  textWhite: { color: '#ffffff' },
  header: {
    paddingTop: 42,
    paddingBottom: 14,
    paddingHorizontal: 18,
    backgroundColor: '#1e2132',
    borderBottomWidth: 1,
    borderColor: '#2d324b',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '800' },
  headerSubtitle: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#262a40',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#34d399', marginRight: 6 },
  liveText: { color: '#e2e8f0', fontSize: 11, fontWeight: '600' },
  body: { flex: 1 },
  modeSwitchBar: {
    flexDirection: 'row',
    padding: 10,
    gap: 8,
    backgroundColor: '#1e2132',
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#262a40',
    alignItems: 'center',
  },
  modeBtnOutActive: { backgroundColor: '#0284c7' },
  modeBtnInActive: { backgroundColor: '#059669' },
  modeBtnText: { color: '#94a3b8', fontSize: 12, fontWeight: '700' },
  qtyChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: '#1e2132',
    gap: 6,
  },
  qtyLabel: { color: '#94a3b8', fontSize: 11, marginRight: 4 },
  qtyChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#262a40',
  },
  qtyChipActive: { backgroundColor: '#10b981' },
  qtyChipText: { color: '#94a3b8', fontSize: 11, fontWeight: '700' },
  cameraWrapper: { flex: 1, position: 'relative' },
  qrFrameOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrSquareBox: {
    width: 220,
    height: 220,
    borderWidth: 1,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  cornerTL: {
    position: 'absolute',
    top: -2,
    left: -2,
    width: 28,
    height: 28,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 14,
  },
  cornerTR: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 28,
    height: 28,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 14,
  },
  cornerBL: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    width: 28,
    height: 28,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 14,
  },
  cornerBR: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 28,
    height: 28,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 14,
  },
  laserLine: {
    width: '86%',
    height: 2,
    opacity: 0.85,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(23, 25, 38, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: { color: '#38bdf8', marginTop: 12, fontWeight: '600' },
  scannerFooter: {
    padding: 16,
    backgroundColor: '#1e2132',
    borderTopWidth: 1,
    borderColor: '#2d324b',
    alignItems: 'center',
  },
  hintText: { color: '#94a3b8', fontSize: 12, textAlign: 'center' },
  resultBox: { alignItems: 'center', width: '100%' },
  successBadge: { fontWeight: '700', fontSize: 13, marginBottom: 3 },
  productName: { color: '#f8fafc', fontSize: 16, fontWeight: '800' },
  stockInfo: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  stockBold: { color: '#38bdf8', fontWeight: '800' },
  prAlertBtn: {
    marginTop: 10,
    backgroundColor: '#d97706',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
  },
  prAlertBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  scanAgainBtn: {
    marginTop: 12,
    backgroundColor: '#2563eb',
    paddingVertical: 11,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  scanAgainBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  scrollArea: { flex: 1, padding: 14 },
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  kpiCard: {
    flex: 1,
    backgroundColor: '#23273a',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2d324b',
  },
  kpiLabel: { color: '#94a3b8', fontSize: 11 },
  kpiValue: { fontSize: 20, fontWeight: '800', marginTop: 4 },
  sectionTitle: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 6,
  },
  itemCard: {
    backgroundColor: '#23273a',
    padding: 13,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2d324b',
  },
  itemRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemName: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  itemMeta: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusPillText: { fontSize: 10, fontWeight: '700' },
  itemRowBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: '#2d324b',
  },
  itemStockText: { color: '#cbd5e1', fontSize: 12 },
  itemStockNumber: { color: '#ffffff', fontWeight: '800' },
  smallPrBtn: {
    backgroundColor: '#d97706',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  smallPrBtnText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  roleChip: {
    backgroundColor: '#23273a',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2d324b',
  },
  roleChipActive: { backgroundColor: '#2563eb', borderColor: '#3b82f6' },
  roleChipText: { color: '#94a3b8', fontSize: 11, fontWeight: '700' },
  prStatusBadge: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: '#171926',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  receiveBtn: {
    marginTop: 10,
    backgroundColor: '#059669',
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
  },
  receiveBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  notifCard: {
    backgroundColor: '#23273a',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#38bdf8',
  },
  notifTitle: { color: '#f8fafc', fontSize: 12, fontWeight: '700' },
  notifMsg: { color: '#94a3b8', fontSize: 11, marginTop: 3 },
  emptyText: { color: '#64748b', fontSize: 12, textAlign: 'center', paddingVertical: 16 },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#1e2132',
    borderTopWidth: 1,
    borderColor: '#2d324b',
    paddingTop: 10,
    paddingBottom: 54,
    paddingHorizontal: 10,
    gap: 8,
  },
  navItem: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 12,
    alignItems: 'center',
  },
  navItemActive: { backgroundColor: '#262a40' },
  navText: { color: '#94a3b8', fontSize: 12, fontWeight: '700' },
  navTextActive: { color: '#38bdf8' },
});
