import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { Camera } from 'react-native-camera-kit';

// ⚠️ GANTI DENGAN IP LAPTOP ANDA (Cek via ipconfig di terminal)
const LAPTOP_IP = 'https://warehouse-management-system-backend-q5ms.onrender.com';
const PORT = '5000';
const BACKEND_URL = `http://${LAPTOP_IP}:${PORT}/api/products/reduce-stock`;

export default function App() {
  const [isScanning, setIsScanning] = useState(true);
  const [loading, setLoading] = useState(false);
  const [scannedItem, setScannedItem] = useState<any>(null);

  // Fungsi saat barcode terbaca oleh kamera
  const onReadCode = async (event: any) => {
    // Kunci pemindai agar tidak membaca berulang kali (Anti-Spam)
    if (!isScanning || loading) return;

    const barcodeValue = event.nativeEvent.codeStringValue;
    if (!barcodeValue) return;

    setIsScanning(false);
    setLoading(true);

    try {
      console.log('Barcode Terdeteksi:', barcodeValue);

      // Kirim request pengurangan stok ke backend laptop
      const response = await fetch(BACKEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: barcodeValue, quantity: 1 }),
      });

      const result = await response.json();

      if (response.ok) {
        setScannedItem(result.data);
      } else {
        Alert.alert('Gagal', result.error || 'Barcode tidak terdaftar di database!');
      }
    } catch (error) {
      Alert.alert(
        'Koneksi Gagal',
        `Tidak bisa menghubungi backend di ${LAPTOP_IP}:${PORT}. Pastikan laptop & HP satu jaringan!`,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* HEADER */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Warehouse Scanner CLI</Text>
        <Text style={styles.headerSubtitle}>Server: {LAPTOP_IP}:{PORT}</Text>
      </View>

      {/* KAMERA NATIVE LENGKAP DENGAN KOTAK BIDIK & LASER */}
      <View style={styles.cameraWrapper}>
        <Camera
          style={StyleSheet.absoluteFill}
          scanBarcode={isScanning}
          onReadCode={onReadCode}
          showFrame={true}
          laserColor="#38bdf8"
          frameColor="#38bdf8"
        />

        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#38bdf8" />
            <Text style={styles.loadingText}>Memotong stok di database...</Text>
          </View>
        )}
      </View>

      {/* FOOTER: HASIL SCAN & TOMBOL SCAN ULANG */}
      <View style={styles.footer}>
        {scannedItem ? (
          <View style={styles.resultBox}>
            <Text style={styles.successBadge}>✅ Sukses Berkurang</Text>
            <Text style={styles.productName}>{scannedItem.name}</Text>
            <Text style={styles.stockInfo}>
              Sisa Stok Gudang: <Text style={styles.stockBold}>{scannedItem.stock} unit</Text>
            </Text>
          </View>
        ) : (
          <Text style={styles.hintText}>Arahkan barcode barang ke dalam kotak bidik</Text>
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#090d16' },
  header: {
    paddingTop: 45,
    paddingBottom: 15,
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderBottomWidth: 1,
    borderColor: '#1e293b',
  },
  headerTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700' },
  headerSubtitle: { color: '#38bdf8', fontSize: 12, marginTop: 2 },
  cameraWrapper: { flex: 1, position: 'relative' },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: { color: '#38bdf8', marginTop: 12, fontWeight: '600' },
  footer: {
    padding: 20,
    backgroundColor: '#0f172a',
    borderTopWidth: 1,
    borderColor: '#1e293b',
    alignItems: 'center',
  },
  hintText: { color: '#94a3b8', fontSize: 13 },
  resultBox: { alignItems: 'center' },
  successBadge: { color: '#4ade80', fontWeight: '700', fontSize: 14, marginBottom: 4 },
  productName: { color: '#f8fafc', fontSize: 16, fontWeight: '700' },
  stockInfo: { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  stockBold: { color: '#38bdf8', fontWeight: '700' },
  scanAgainBtn: {
    marginTop: 14,
    backgroundColor: '#0284c7',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  scanAgainBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 14 },
});