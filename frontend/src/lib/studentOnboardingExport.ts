import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

/** Fixed registration fee for students onboarded on/after 8 Sep 2026. */
export const REGISTRATION_FEE_KES = 500;

/** Must match backend `REGISTRATION_FEE_EFFECTIVE_FROM` (Africa/Nairobi). */
export const REGISTRATION_FEE_EFFECTIVE_FROM = new Date("2026-09-08T00:00:00+03:00");

export function isRegistrationFeeEligible(createdAt?: string | Date | null): boolean {
  if (!createdAt) return false;
  return new Date(createdAt).getTime() >= REGISTRATION_FEE_EFFECTIVE_FROM.getTime();
}

export type StudentExportRow = {
  name: string;
  regNo: string;
  course?: string | null;
  gender?: string | null;
  createdAt?: string | Date | null;
  walletBalance?: number | null;
  parent?: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  parentRelationship?: string | null;
};

function sameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Students created on the given local calendar day (default: today). */
export function filterOnboardedOnDay(students: StudentExportRow[], day = new Date()) {
  return students.filter((s) => {
    if (!s.createdAt) return false;
    return sameLocalDay(new Date(s.createdAt), day);
  });
}

/** Parse `YYYY-MM-DD` as a local calendar date (avoids UTC shift). */
export function parseLocalDateInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toLocalDateInput(day = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** Whether `createdAt` falls on the given local calendar day (default: today). */
export function isCreatedOnLocalDay(createdAt?: string | Date | null, day = new Date()) {
  if (!createdAt) return false;
  return toLocalDateInput(new Date(createdAt)) === toLocalDateInput(day);
}

export function formatMoney(amount: number) {
  return Number(amount || 0).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function buildTableRows(students: StudentExportRow[]) {
  return students.map((s, i) => {
    const wallet = Number(s.walletBalance || 0);
    const hasFee = isRegistrationFeeEligible(s.createdAt);
    return {
      no: i + 1,
      studentName: s.name || "-",
      admissionNo: s.regNo || "-",
      course: s.course || "-",
      gender: s.gender || "-",
      onboardedAt: formatDateTime(s.createdAt),
      parentName: s.parent?.name || "-",
      parentPhone: s.parent?.phone || "-",
      parentEmail: s.parent?.email || "-",
      relationship: s.parentRelationship || "-",
      registrationFee: hasFee ? formatMoney(REGISTRATION_FEE_KES) : "N/A",
      walletBalance: formatMoney(wallet),
    };
  });
}

function stamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function downloadStudentsExcel(
  students: StudentExportRow[],
  opts?: {
    title?: string;
    filenamePrefix?: string;
    totals?: {
      walletTotal: number;
      registrationFeesTotal: number;
      collectedTotal: number;
    };
  },
) {
  const title = opts?.title || "Students list";
  const rows = buildTableRows(students);

  const headers = [
    "No",
    "Student Name",
    "Admission No",
    "Course",
    "Gender",
    "Onboarded At",
    "Parent Name",
    "Parent Phone",
    "Parent Email",
    "Relationship",
    "Registration Fee (KES)",
    "Wallet Balance (KES)",
  ];

  const sheetData: (string | number)[][] = [
    [title],
    [`Generated: ${new Date().toLocaleString()}`],
    [`Total students: ${rows.length}`],
    [
      `Registration fee: KES ${formatMoney(REGISTRATION_FEE_KES)} for students onboarded on/after ${REGISTRATION_FEE_EFFECTIVE_FROM.toLocaleDateString()} · N/A otherwise`,
    ],
  ];

  if (opts?.totals) {
    sheetData.push(
      [`Total registration fees: KES ${formatMoney(opts.totals.registrationFeesTotal)}`],
      [`Total wallet balances: KES ${formatMoney(opts.totals.walletTotal)}`],
      [`Total collected (wallets + fees): KES ${formatMoney(opts.totals.collectedTotal)}`],
    );
  }

  sheetData.push(
    [],
    headers,
    ...rows.map((r) => [
      r.no,
      r.studentName,
      r.admissionNo,
      r.course,
      r.gender,
      r.onboardedAt,
      r.parentName,
      r.parentPhone,
      r.parentEmail,
      r.relationship,
      r.registrationFee,
      r.walletBalance,
    ]),
  );

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws["!cols"] = [
    { wch: 5 },
    { wch: 24 },
    { wch: 14 },
    { wch: 28 },
    { wch: 10 },
    { wch: 20 },
    { wch: 22 },
    { wch: 14 },
    { wch: 26 },
    { wch: 12 },
    { wch: 18 },
    { wch: 18 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Students");
  const prefix = opts?.filenamePrefix || "students-list";
  XLSX.writeFile(wb, `${prefix}-${stamp()}.xlsx`);
}

export function downloadStudentsPdf(
  students: StudentExportRow[],
  opts?: {
    title?: string;
    filenamePrefix?: string;
    totals?: {
      walletTotal: number;
      registrationFeesTotal: number;
      collectedTotal: number;
    };
  },
) {
  const title = opts?.title || "Students list";
  const rows = buildTableRows(students);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  doc.setFontSize(14);
  doc.setTextColor(10, 31, 68);
  doc.text(title, 14, 16);
  doc.setFontSize(9);
  doc.setTextColor(100);
  let y = 22;
  doc.text(
    `Generated: ${new Date().toLocaleString()}  ·  Total students: ${rows.length}  ·  Reg. fee KES ${formatMoney(REGISTRATION_FEE_KES)} (from ${REGISTRATION_FEE_EFFECTIVE_FROM.toLocaleDateString()})`,
    14,
    y,
  );
  if (opts?.totals) {
    y += 5;
    doc.text(
      `Registration fees: KES ${formatMoney(opts.totals.registrationFeesTotal)}  ·  Wallets: KES ${formatMoney(opts.totals.walletTotal)}  ·  Total collected: KES ${formatMoney(opts.totals.collectedTotal)}`,
      14,
      y,
    );
  }

  autoTable(doc, {
    startY: y + 4,
    head: [[
      "No",
      "Student",
      "Admission",
      "Course",
      "Parent",
      "Parent Phone",
      "Reg. Fee",
      "Wallet (KES)",
      "Onboarded",
    ]],
    body: rows.map((r) => [
      r.no,
      r.studentName,
      r.admissionNo,
      r.course,
      r.parentName,
      r.parentPhone,
      r.registrationFee,
      r.walletBalance,
      r.onboardedAt,
    ]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [10, 31, 68], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  });

  const prefix = opts?.filenamePrefix || "students-list";
  doc.save(`${prefix}-${stamp()}.pdf`);
}

