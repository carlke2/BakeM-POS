/**
 * Restore older students to wallet balances as they were before the
 * registration-fee rollout (fee reverse + put back wiped openings).
 *
 * Openings come from the original onboard wallet column only as a delta —
 * this does not re-import students or overwrite later top-ups/purchases.
 *
 * Usage (from backend/):
 *   npx tsx scripts/restore-older-pre-fee-balances.ts
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import {
  backfillMissingRegistrationFees,
  restoreOlderStudentsPreRegistrationFee,
} from '../services/registrationFee';
import prisma from '../services/prisma';

function parseWallet(raw: string): number {
  const n = Number(String(raw || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function normalizeRegNo(v: any): string {
  return String(v || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

function loadOpeningsFromCsv(): Map<string, number> {
  const map = new Map<string, number>();
  const csvPath = path.join(__dirname, '..', 'student.csv');
  if (!fs.existsSync(csvPath)) return map;
  const content = fs.readFileSync(csvPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Rank,')) continue;
    // Rank,Name,Adm No.,Wallet,Category — wallet may contain commas inside quotes
    const match = trimmed.match(/^(\d+),(.*),([A-Za-z0-9-]+),("?\*\*?KSh?\s*([\d,]+)\*\*?"?|[^,]*),(.*)$/i);
    if (match) {
      const reg = normalizeRegNo(match[3]);
      const wallet = parseWallet(match[5] || match[4]);
      if (reg) map.set(reg, wallet);
      continue;
    }
    const cols = trimmed.split(',');
    if (cols.length >= 4) {
      const reg = normalizeRegNo(cols[2]);
      const wallet = parseWallet(cols[3]);
      if (reg) map.set(reg, wallet);
    }
  }
  return map;
}

function loadOpeningsFromXlsx(): Map<string, number> {
  const map = new Map<string, number>();
  const xlsxPath = path.join(__dirname, '..', 'student(updated).xlsx');
  if (!fs.existsSync(xlsxPath)) return map;
  const workbook = XLSX.readFile(xlsxPath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return map;
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return map;
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
    const regNo =
      keyMap['regno'] ??
      keyMap['reg no'] ??
      keyMap['registration number'] ??
      keyMap['admission no'] ??
      keyMap['admission number'] ??
      keyMap['admission'] ??
      keyMap['adm no'];
    const walletRaw =
      keyMap['wallet'] ??
      keyMap['wallet balance'] ??
      keyMap['balance'] ??
      keyMap['amount'] ??
      keyMap['walletbalance'];
    const reg = normalizeRegNo(regNo);
    if (!reg) continue;
    map.set(reg, parseWallet(String(walletRaw ?? '')));
  }
  return map;
}

async function main() {
  console.log('1) Reverse any leftover registration fees on older students...');
  const feeResult = await backfillMissingRegistrationFees();
  console.log(JSON.stringify({ feeResult }, null, 2));

  console.log('2) Restore wiped openings for older students (pre-fee position)...');
  const fromXlsx = loadOpeningsFromXlsx();
  const fromCsv = loadOpeningsFromCsv();
  // Prefer xlsx (updated) then csv for any missing regs
  const openings = new Map<string, number>([...fromCsv, ...fromXlsx]);
  console.log(`Loaded ${openings.size} onboard opening balances`);

  const restore = await restoreOlderStudentsPreRegistrationFee(openings);
  console.log(JSON.stringify({ restore }, null, 2));
  console.log(
    `Done. Restored ${restore.restored} older student wallet(s). Skipped ${restore.skipped}. Missing opening map: ${restore.missingOpening}.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
