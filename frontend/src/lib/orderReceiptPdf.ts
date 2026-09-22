import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { OrderReceiptData } from "@/lib/orderReceiptTypes";

const formatMoney = (amount: number) => `KES ${amount.toLocaleString()}`;

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

async function loadImageDataUrl(src: string): Promise<string | null> {
  try {
    const response = await fetch(src);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function safeFilename(receiptNo: string) {
  return `receipt-${receiptNo.replace(/[^a-z0-9-]/gi, "_")}.pdf`;
}

export async function buildReceiptPdf(data: OrderReceiptData, logoUrl?: string): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "mm", format: [80, 220], orientation: "portrait" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const centerX = pageWidth / 2;
  let y = 10;

  if (logoUrl) {
    const img = await loadImageDataUrl(logoUrl);
    if (img) {
      const logoSize = 28;
      // Soft white plate behind logo for better contrast on thermal print
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(centerX - logoSize / 2 - 1.5, y - 1.5, logoSize + 3, logoSize + 3, 2, 2, "F");
      doc.addImage(img, "PNG", centerX - logoSize / 2, y, logoSize, logoSize);
      y += logoSize + 5;
    }
  }

  doc.setTextColor(10, 31, 68);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Cafeteria Receipt", centerX, y, { align: "center" });
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(107, 114, 128);
  doc.text("Better Fork Restaurant Limited", centerX, y, { align: "center" });
  y += 8;

  doc.setFillColor(232, 244, 253);
  doc.roundedRect(8, y - 4, pageWidth - 16, 10, 2, 2, "F");
  doc.setTextColor(10, 31, 68);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(data.receiptNo, centerX, y + 2.5, { align: "center" });
  y += 12;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(55, 65, 81);
  doc.text(data.studentName, centerX, y, { align: "center" });
  y += 4;
  doc.text(data.regNo, centerX, y, { align: "center" });
  y += 4;
  doc.text(formatDateTime(data.paidAt), centerX, y, { align: "center" });
  y += 6;

  autoTable(doc, {
    startY: y,
    margin: { left: 6, right: 6 },
    head: [["Item", "Qty", "Amount"]],
    body: data.items.map((item) => [
      item.name,
      String(item.quantity),
      formatMoney(item.price * item.quantity),
    ]),
    theme: "plain",
    styles: { fontSize: 8, cellPadding: 1.5, textColor: [10, 31, 68] },
    headStyles: { fontStyle: "bold", textColor: [107, 114, 128], fillColor: [249, 250, 251] },
    columnStyles: {
      0: { cellWidth: 38 },
      1: { halign: "center", cellWidth: 10 },
      2: { halign: "right", cellWidth: 22 },
    },
  });

  const tableEnd = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 20;
  y = tableEnd + 6;

  doc.setDrawColor(10, 31, 68);
  doc.setLineWidth(0.4);
  doc.line(8, y, pageWidth - 8, y);
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(5, 150, 105);
  doc.text(`Total paid: ${formatMoney(data.total)}`, centerX, y, { align: "center" });
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(107, 114, 128);
  doc.text(`Payment: ${data.paymentMethod || "Wallet"}`, centerX, y, { align: "center" });
  y += 5;

  if (data.servedBy) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(55, 65, 81);
    doc.text(`Served by: ${data.servedBy}`, centerX, y, { align: "center" });
    y += 6;
  } else {
    y += 3;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(107, 114, 128);
  doc.text("Thank you for your order.", centerX, y, { align: "center" });
  doc.text("Keep this receipt for your records.", centerX, y + 3.5, { align: "center" });

  return doc;
}

export async function downloadOrderReceipt(data: OrderReceiptData, logoUrl?: string) {
  const doc = await buildReceiptPdf(data, logoUrl);
  doc.save(safeFilename(data.receiptNo));
}

export async function printOrderReceipt(data: OrderReceiptData, logoUrl?: string) {
  const doc = await buildReceiptPdf(data, logoUrl);
  doc.autoPrint();
  const blob = doc.output("bloburl");
  const win = window.open(blob, "_blank");
  if (!win) {
    throw new Error("Pop-up blocked. Allow pop-ups to print your receipt.");
  }
}
