import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Sedang mengisi data contoh barang...');

  // Hapus data lama jika ada
  await prisma.stockMovement.deleteMany();
  await prisma.product.deleteMany();

  // Buat 3 produk baru dengan barcode
  await prisma.product.createMany({
    data: [
      {
        sku: 'BRG-001',
        name: 'Sepatu Running Nike Air',
        barcode: '899123456001',
        stock: 25,
        minStock: 5,
      },
      {
        sku: 'BRG-002',
        name: 'Kemeja Flannel Uniqlo',
        barcode: '899123456002',
        stock: 15,
        minStock: 3,
      },
      {
        sku: 'BRG-003',
        name: 'Mouse Wireless Logitech',
        barcode: '899123456003',
        stock: 8,
        minStock: 2,
      },
    ],
  });

  console.log('✅ Berhasil membuat 3 produk contoh!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });