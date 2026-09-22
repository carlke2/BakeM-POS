import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import prisma from '../services/prisma';
import {
  PRE_FEE_OPENING_RESTORE_REF,
  REGISTRATION_FEE_EFFECTIVE_FROM,
  restoreOlderStudentsPreRegistrationFee,
} from '../services/registrationFee';

function parseWallet(raw: string): number {
  const n = Number(String(raw || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function normalizeRegNo(v: any): string {
  return String(v || '').trim().toUpperCase().replace(/\s+/g, '');
}

function loadOpenings(): Map<string, number> {
  const map = new Map<string, number>();

  const csvPath = path.join(__dirname, '..', 'student.csv');
  if (fs.existsSync(csvPath)) {
    const content = fs.readFileSync(csvPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || /^rank,/i.test(trimmed)) continue;
      // Prefer quoted wallet field
      const m = trimmed.match(
        /^\d+,(?:\"[^\"]*\"|[^,]*),([^,]+),(?:\"([^\"]*)\"|([^,]*))/,
      );
      if (m) {
        const reg = normalizeRegNo(m[1]);
        const wallet = parseWallet(m[2] || m[3] || '');
        if (reg) map.set(reg, wallet);
      }
    }
  }

  const xlsxPath = path.join(__dirname, '..', 'student(updated).xlsx');
  if (fs.existsSync(xlsxPath)) {
    const workbook = XLSX.readFile(xlsxPath, { cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
    for (const row of rows) {
      const keyMap: Record<string, any> = {};
      for (const [k, v] of Object.entries(row)) {
        keyMap[
          String(k || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[^a-z0-9 ]/g, '')
        ] = v;
      }
      const reg = normalizeRegNo(
        keyMap['regno'] ??
          keyMap['reg no'] ??
          keyMap['admission no'] ??
          keyMap['admission number'] ??
          keyMap['adm no'] ??
          keyMap['admission'],
      );
      const wallet = parseWallet(
        String(
          keyMap['wallet'] ??
            keyMap['wallet balance'] ??
            keyMap['balance'] ??
            keyMap['amount'] ??
            '',
        ),
      );
      if (reg) map.set(reg, wallet);
    }
  }

  return map;
}

async function main() {
  const openings = loadOpenings();
  console.log('openings loaded', openings.size);

  const older = await prisma.student.findMany({
    where: { createdAt: { lt: REGISTRATION_FEE_EFFECTIVE_FROM } },
    select: {
      regNo: true,
      walletBalance: true,
      transactions: { select: { reference: true } },
    },
  });

  const missing = older.filter((s) => !openings.has(s.regNo.toUpperCase()));
  const zeroNeeding = older.filter((s) => {
    const hasRestore = s.transactions.some((t) => t.reference === PRE_FEE_OPENING_RESTORE_REF);
    const open = openings.get(s.regNo.toUpperCase()) || 0;
    return !hasRestore && open > 0;
  });

  console.log(
    JSON.stringify(
      {
        older: older.length,
        missingRegs: missing.map((s) => s.regNo),
        stillNeedRestore: zeroNeeding.length,
        sampleNeed: zeroNeeding.slice(0, 10).map((s) => ({
          reg: s.regNo,
          bal: s.walletBalance,
          open: openings.get(s.regNo.toUpperCase()),
        })),
      },
      null,
      2,
    ),
  );

  const restore = await restoreOlderStudentsPreRegistrationFee(openings);
  console.log(JSON.stringify({ restore }, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
