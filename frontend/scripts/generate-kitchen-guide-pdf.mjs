import { jsPDF } from "jspdf";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const logoPath = path.join(root, "src/assets/LOGO.png");
const outDir = path.join(root, "..", "docs");
const outPath = path.join(outDir, "BetterFork-Kitchen-Inventory-Guide.pdf");

const BRAND = { r: 10, g: 31, b: 68 };
const TEAL = { r: 45, g: 140, b: 130 };
const MUTED = { r: 100, g: 116, b: 139 };
const BODY = { r: 51, g: 65, b: 85 };

const PAGE_W = 210;
const MARGIN = 18;
const CONTENT_W = PAGE_W - MARGIN * 2;

function loadLogoDataUrl() {
  if (!fs.existsSync(logoPath)) return null;
  const buf = fs.readFileSync(logoPath);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function setColor(doc, c) {
  doc.setTextColor(c.r, c.g, c.b);
}

function addFooter(doc, pageNum, totalPages) {
  const h = doc.internal.pageSize.getHeight();
  doc.setDrawColor(BRAND.r, BRAND.g, BRAND.b);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, h - 14, PAGE_W - MARGIN, h - 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, MUTED);
  doc.text("Better Fork Restaurant Limited · SmartPOS", MARGIN, h - 8);
  doc.text(`Page ${pageNum} of ${totalPages}`, PAGE_W - MARGIN, h - 8, { align: "right" });
}

function ensureSpace(doc, y, needed, state) {
  const h = doc.internal.pageSize.getHeight();
  if (y + needed > h - 20) {
    doc.addPage();
    state.pageNum += 1;
    return 22;
  }
  return y;
}

function heading(doc, text, y, state, level = 1) {
  y = ensureSpace(doc, y, level === 1 ? 14 : 10, state);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(level === 1 ? 14 : level === 2 ? 11 : 10);
  setColor(doc, level === 1 ? BRAND : TEAL);
  doc.text(text, MARGIN, y);
  return y + (level === 1 ? 8 : 6);
}

function paragraph(doc, text, y, state, opts = {}) {
  const { size = 9, indent = 0, bold = false, color = BODY } = opts;
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(size);
  setColor(doc, color);
  const lines = doc.splitTextToSize(text, CONTENT_W - indent);
  for (const line of lines) {
    y = ensureSpace(doc, y, 5, state);
    doc.text(line, MARGIN + indent, y);
    y += 4.5;
  }
  return y + 2;
}

function bullet(doc, text, y, state, indent = 4) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setColor(doc, BODY);
  const lines = doc.splitTextToSize(text, CONTENT_W - indent - 4);
  y = ensureSpace(doc, y, 5 * lines.length, state);
  doc.text("•", MARGIN + indent - 3, y);
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) y = ensureSpace(doc, y, 5, state);
    doc.text(lines[i], MARGIN + indent + 2, y);
    y += 4.5;
  }
  return y + 1;
}

function table(doc, headers, rows, y, state) {
  y = ensureSpace(doc, y, 12 + rows.length * 6, state);
  const colW = CONTENT_W / headers.length;
  doc.setFillColor(232, 244, 253);
  doc.rect(MARGIN, y - 4, CONTENT_W, 7, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  setColor(doc, BRAND);
  headers.forEach((h, i) => doc.text(h, MARGIN + i * colW + 1, y));
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setColor(doc, BODY);
  rows.forEach((row, ri) => {
    y = ensureSpace(doc, y, 6, state);
    if (ri % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(MARGIN, y - 3.5, CONTENT_W, 6, "F");
    }
    row.forEach((cell, i) => doc.text(String(cell), MARGIN + i * colW + 1, y));
    y += 5.5;
  });
  return y + 4;
}

function drawCover(doc, logoDataUrl) {
  const h = doc.internal.pageSize.getHeight();
  doc.setFillColor(232, 244, 253);
  doc.rect(0, 0, PAGE_W, h, "F");

  if (logoDataUrl) {
    const logoW = 55;
    const logoH = 55;
    doc.addImage(logoDataUrl, "PNG", (PAGE_W - logoW) / 2, 35, logoW, logoH);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  setColor(doc, BRAND);
  doc.text("Kitchen & Inventory", PAGE_W / 2, 105, { align: "center" });
  doc.text("User Guide", PAGE_W / 2, 116, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  setColor(doc, TEAL);
  doc.text("Better Fork Restaurant Limited", PAGE_W / 2, 130, { align: "center" });
  doc.setFontSize(10);
  setColor(doc, MUTED);
  doc.text("SmartPOS · Menu · Recipes · Raw Stock · Kitchen Production · POS", PAGE_W / 2, 140, {
    align: "center",
  });

  doc.setDrawColor(BRAND.r, BRAND.g, BRAND.b);
  doc.setLineWidth(0.5);
  doc.line(MARGIN + 20, 152, PAGE_W - MARGIN - 20, 152);

  doc.setFontSize(9);
  setColor(doc, BODY);
  const intro =
    "A practical guide for cafeteria staff on managing food items, ingredients, cooking batches, and sales.";
  const introLines = doc.splitTextToSize(intro, CONTENT_W - 20);
  doc.text(introLines, PAGE_W / 2, 162, { align: "center" });

  doc.setFontSize(8);
  setColor(doc, MUTED);
  doc.text(`Generated ${new Date().toLocaleDateString("en-KE", { dateStyle: "long" })}`, PAGE_W / 2, h - 20, {
    align: "center",
  });
}

function buildGuide() {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const logoDataUrl = loadLogoDataUrl();
  const state = { pageNum: 1 };

  drawCover(doc);
  doc.addPage();
  state.pageNum = 2;

  let y = 22;

  // Role access
  y = heading(doc, "1. Who Can Do What?", y, state);
  y = table(
    doc,
    ["Role", "Menu & Recipes", "Inventory", "Suppliers", "POS"],
    [
      ["Restaurant staff", "Full access", "Full access", "Full access", "Yes"],
      ["Finance", "View only", "View only", "View only", "No"],
      ["Admin", "No*", "View + suppliers", "Full access", "No"],
    ],
    y,
    state,
  );
  y = paragraph(doc, "* Use a restaurant staff account for daily menu and kitchen work.", y, state, {
    size: 8,
    color: MUTED,
  });

  // Flow
  y = heading(doc, "2. How It All Connects", y, state);
  y = bullet(doc, "Add suppliers → Record raw stock deliveries", y, state);
  y = bullet(doc, "Create menu items → Link recipes with batch size", y, state);
  y = bullet(doc, "Cook batches on Kitchen tab → Sell on POS", y, state);
  y = bullet(doc, "Stock and sales are tracked automatically", y, state);
  y = paragraph(
    doc,
    "Example — Mandazi: Add flour to raw stock → Create Mandazi at KES 50 → Recipe: 1 kg flour makes 60 mandazis → Cook 1 batch → Sell on POS.",
    y,
    state,
  );

  // Suppliers
  y = heading(doc, "3. Suppliers (Start Here)", y, state);
  y = paragraph(doc, "Go to: Sidebar → Suppliers", y, state, { bold: true, color: BRAND });
  y = bullet(doc, "Click Add Supplier and enter business name (required), contact, phone, email, address.", y, state);
  y = bullet(
    doc,
    "When recording deliveries, pick the supplier under Inventory → Raw Stock → Stock IN (purchase).",
    y,
    state,
  );

  // Raw stock
  y = heading(doc, "4. Raw Stock (Ingredients)", y, state);
  y = paragraph(doc, "Go to: Inventory & Kitchen → Raw Stock tab", y, state, { bold: true, color: BRAND });
  y = heading(doc, "Add a new ingredient", y, state, 2);
  y = bullet(doc, "Item Name — e.g. Baking Flour", y, state);
  y = bullet(doc, "Category — Grains, Vegetables, Meat, Dairy, Spices, Other", y, state);
  y = bullet(doc, "Unit — kg, liters, pieces, bags", y, state);
  y = bullet(doc, "Reorder Level Alert — triggers low-stock warning", y, state);
  y = bullet(doc, "Unit Cost (KES) — for stock valuation. Click Add Inventory Item.", y, state);

  y = heading(doc, "Record a delivery (Stock IN)", y, state, 2);
  y = bullet(doc, "Adjustment Type → Stock IN (+)", y, state);
  y = bullet(doc, "Reason → purchase", y, state);
  y = bullet(doc, "Select supplier and optional invoice number. Click Record Stock Movement.", y, state);

  y = heading(doc, "Record usage or spoilage (Stock OUT)", y, state, 2);
  y = bullet(doc, "Adjustment Type → Stock OUT (-). Reason: usage, spoilage, or adjustment.", y, state);
  y = paragraph(doc, "Watch for the amber Low Stock Warning banner and restock before cooking.", y, state);

  // Menu
  y = heading(doc, "5. Menu Management", y, state);
  y = paragraph(doc, "Go to: Sidebar → Menu Items / Categories / Add Menu Item", y, state, {
    bold: true,
    color: BRAND,
  });
  y = heading(doc, "Create categories first", y, state, 2);
  y = bullet(doc, "Menu Categories tab → enter name (Breakfast, Lunch, Snacks) → Add Category.", y, state);
  y = heading(doc, "Add a menu item", y, state, 2);
  y = bullet(doc, "Item Name, Price (KES), Category (required). Image and description optional.", y, state);
  y = bullet(doc, "Stock (portions): leave blank for unlimited, or set a fixed count.", y, state);
  y = heading(doc, "Manage items (All Items tab)", y, state, 2);
  y = bullet(doc, "Available / Unavailable — toggle POS visibility", y, state);
  y = bullet(doc, "Edit, Recipe, or Delete as needed", y, state);

  // Recipes
  y = heading(doc, "6. Recipes & Batch Cooking", y, state);
  y = paragraph(doc, "Go to: Sidebar → Menu Recipes", y, state, { bold: true, color: BRAND });
  y = bullet(doc, "Select Dish → set Batch yield (portions per cook), e.g. 60 mandazis.", y, state);
  y = bullet(doc, "Add ingredients per batch — pick from raw stock with quantity.", y, state);
  y = bullet(doc, "Save Recipe. Item starts at 0 portions until you cook a batch.", y, state);

  // Kitchen
  y = heading(doc, "7. Kitchen — Cook & Track Sales", y, state);
  y = paragraph(doc, "Go to: Inventory & Kitchen → Cook & Track Sales tab", y, state, {
    bold: true,
    color: BRAND,
  });
  y = table(
    doc,
    ["Label", "Meaning"],
    [
      ["Raw stock", "How many batches you can cook now"],
      ["Ready (POS)", "Portions ready to sell"],
      ["Sales made", "KES sold from current batch"],
      ["Still expected", "KES left to hit batch target"],
    ],
    y,
    state,
  );
  y = bullet(doc, "Click Cook 1 batch when ingredients are available.", y, state);
  y = bullet(doc, "Success: portions added to POS. Failure: restock ingredients first.", y, state);
  y = bullet(doc, "Use Refresh to update the board during service.", y, state);

  // POS
  y = heading(doc, "8. Selling on POS", y, state);
  y = paragraph(doc, "Go to: Sidebar → POS Terminal", y, state, { bold: true, color: BRAND });
  y = heading(doc, "How stock deducts", y, state, 2);
  y = bullet(
    doc,
    "Batch items: ingredients used when cooking; POS sales reduce Ready (POS) count.",
    y,
    state,
  );
  y = bullet(doc, "Pre-packaged items: stock decreases by 1 per sale; update manually when restocking.", y, state);
  y = bullet(doc, "Unlimited items: leave stock blank — always available.", y, state);
  y = heading(doc, "Checkout flow", y, state, 2);
  y = bullet(doc, "Filter by category or search → tap items to add to cart.", y, state);
  y = bullet(doc, "Students: search by name/reg no → Complete Sale (Wallet).", y, state);
  y = bullet(doc, "Guests: Cash (Guest) or M-Pesa STK (Guest).", y, state);

  // Daily workflow
  y = heading(doc, "9. Daily Workflow", y, state);
  y = heading(doc, "Morning", y, state, 2);
  y = bullet(doc, "Confirm suppliers exist. Record deliveries (Stock IN / purchase). Check low stock.", y, state);
  y = heading(doc, "Before service", y, state, 2);
  y = bullet(doc, "Confirm recipes. Cook 1 batch for each dish. Set items to Available.", y, state);
  y = heading(doc, "During service", y, state, 2);
  y = bullet(doc, "Serve on POS. Watch X left / Out badges. Cook more batches when low.", y, state);
  y = heading(doc, "End of day", y, state, 2);
  y = bullet(doc, "Review Sales Tracker. Record spoilage/adjustments. Check supplier purchase history.", y, state);

  // Quick reference
  y = heading(doc, "10. Quick Reference", y, state);
  y = table(
    doc,
    ["Task", "Where to go"],
    [
      ["Add ingredient", "Inventory → Raw Stock → Add Inventory Item"],
      ["Record delivery", "Inventory → Raw Stock → Stock IN (+)"],
      ["Add menu dish", "Menu → Add Menu Item"],
      ["Link recipe", "Menu → Menu Recipes"],
      ["Cook food", "Inventory → Cook & Track Sales → Cook 1 batch"],
      ["Sell food", "POS Terminal"],
      ["Check sales", "POS → Sales Tracker"],
      ["Add supplier", "Suppliers → Add Supplier"],
    ],
    y,
    state,
  );

  // Troubleshooting
  y = heading(doc, "11. Common Issues", y, state);
  y = table(
    doc,
    ["Problem", "Fix"],
    [
      ["Item shows Out on POS", "Cook a batch or increase stock on menu item"],
      ["Not enough ingredients", "Record delivery under Raw Stock (Stock IN)"],
      ["Unavailable after recipe", "Cook 1 batch first — starts at 0 portions"],
      ["Low stock warning", "Restock via Stock IN (+) / purchase"],
      ["No supplier on purchase", "Add supplier under Suppliers first"],
    ],
    y,
    state,
  );

  const totalPages = doc.getNumberOfPages();
  for (let p = 2; p <= totalPages; p++) {
    doc.setPage(p);
    if (p === 2 && logoDataUrl) {
      doc.addImage(logoDataUrl, "PNG", PAGE_W - MARGIN - 18, 8, 16, 16);
    }
    addFooter(doc, p, totalPages);
  }

  return doc;
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const doc = buildGuide();
const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
fs.writeFileSync(outPath, pdfBuffer);
console.log(`PDF saved to: ${outPath}`);
