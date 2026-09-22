import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import prisma from '@/services/prisma';
import * as XLSX from 'xlsx';

const DEFAULT_PASSWORD = '12345678';

type SeedStudent = {
  name: string;
  regNo: string;
  gender?: string | null;
  className?: string | null;
  walletBalance: number;
  category: 'regular' | 'sponsored';
};

type SeedParentLink = {
  parentName: string;
  phone: string;
  email?: string | null;
  relationship?: string | null;
  isPrimary: boolean;
  receiveSms: boolean;
  receiveEmail: boolean;
  studentName?: string | null;
  admissionNo: string;
  className?: string | null;
};

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

function parseWallet(raw: string): number {
  const cleaned = raw.replace(/\*\*/g, '').replace(/KSh\s*/gi, '').replace(/,/g, '').trim();
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : 0;
}

function parseCategory(raw: string): 'regular' | 'sponsored' {
  return raw.trim().toLowerCase() === 'sponsored' ? 'sponsored' : 'regular';
}

function normalizeRegNo(raw: unknown): string {
  return String(raw || '').trim().toUpperCase();
}

function normalizeName(raw: unknown): string {
  return String(raw || '').trim();
}

function normalizePhone(raw: unknown): string {
  return String(raw || '').trim().replace(/\s+/g, '');
}

function parseYesNo(raw: unknown, fallback: boolean): boolean {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return fallback;
  if (v === 'yes' || v === 'y' || v === 'true' || v === '1') return true;
  if (v === 'no' || v === 'n' || v === 'false' || v === '0') return false;
  return fallback;
}

function loadStudentsFromCsv(): SeedStudent[] {
  const csvPath = path.join(__dirname, '..', 'student.csv');
  const content = fs.readFileSync(csvPath, 'utf8');
  const students: SeedStudent[] = [];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Rank,')) continue;

    const cols = parseCsvLine(trimmed);
    if (cols.length < 4) continue;

    const [, name, regNo, walletRaw, categoryRaw] = cols;
    if (!name || !regNo) continue;

    const n = normalizeName(name);
    const r = normalizeRegNo(regNo);
    if (!n || !r) continue;

    students.push({ name: n, regNo: r, walletBalance: parseWallet(walletRaw), category: parseCategory(categoryRaw) });
  }

  return students;
}

function toHeaderKey(v: any): string {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '');
}

function loadStudentsFromXlsx(): SeedStudent[] {
  const xlsxPath = path.join(__dirname, '..', 'student(updated).xlsx');
  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`Missing Excel file: ${xlsxPath}`);
  }

  const workbook = XLSX.readFile(xlsxPath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];

  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });

  const students: SeedStudent[] = [];
  for (const row of rows) {
    const keyMap: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) keyMap[toHeaderKey(k)] = v;

    const name =
      keyMap['name'] ??
      keyMap['student name'] ??
      keyMap['student'] ??
      keyMap['full name'] ??
      keyMap['fullname'];

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

    const genderRaw =
      keyMap['gender'] ??
      keyMap['sex'];

    const classRaw =
      keyMap['class'] ??
      keyMap['classname'] ??
      keyMap['class name'];

    const categoryRaw =
      keyMap['category'] ??
      keyMap['type'] ??
      keyMap['student type'] ??
      keyMap['sponsorship'] ??
      keyMap['sponsored'];

    const n = normalizeName(name);
    const r = normalizeRegNo(regNo);
    if (!n || !r) continue;

    const walletBalance = parseWallet(String(walletRaw ?? '').trim());
    const category = parseCategory(String(categoryRaw ?? 'regular'));
    const gender = String(genderRaw || '').trim().toLowerCase() || null;
    const className = String(classRaw || '').trim() || null;

    students.push({ name: n, regNo: r, gender, className, walletBalance, category });
  }

  return students;
}

function loadParentLinksFromCsv(): SeedParentLink[] {
  const csvPath = path.join(__dirname, '..', 'parents-(updated).csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Missing parents CSV file: ${csvPath}`);
  }
  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length <= 1) return [];

  const headerCols = parseCsvLine(lines[0]);
  const idx: Record<string, number> = {};
  for (let i = 0; i < headerCols.length; i++) {
    idx[toHeaderKey(headerCols[i])] = i;
  }
  const col = (cols: string[], key: string) => cols[idx[key]] ?? '';

  const results: SeedParentLink[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const parentName = normalizeName(col(cols, 'parent'));
    const phone = normalizePhone(col(cols, 'phone'));
    const admissionNo = normalizeRegNo(col(cols, 'admission no'));
    if (!parentName || !phone || !admissionNo) continue;

    results.push({
      parentName,
      phone,
      email: normalizeName(col(cols, 'email')) || null,
      relationship: normalizeName(col(cols, 'relationship')) || null,
      isPrimary: parseYesNo(col(cols, 'primary'), false),
      receiveSms: parseYesNo(col(cols, 'sms'), true),
      receiveEmail: parseYesNo(col(cols, 'email optin'), true),
      studentName: normalizeName(col(cols, 'student')) || null,
      admissionNo,
      className: normalizeName(col(cols, 'class')) || null,
    });
  }

  return results;
}

async function seed() {
  console.log('──Seeding database──');
  await prisma.$connect();

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  // ── Default admin ──────────────────────────────────────────────────────────
  console.log('Seeding admin…');
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@smartpos.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || DEFAULT_PASSWORD;
  const adminName = process.env.SEED_ADMIN_NAME || 'System Admin';

  const existingAdmin = await prisma.admin.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    const hashed = await bcrypt.hash(adminPassword, 10);
    await prisma.admin.create({ data: { name: adminName, email: adminEmail, password: hashed } });
    console.log(`Admin created - email: ${adminEmail}  password: ${adminPassword}`);
  } else {
    console.log(`Admin already exists: ${adminEmail}`);
  }

  // ── Default menu categories ─────────────────────────────────────────────────
  console.log('Seeding menu categories…');
  const defaultCategories = ['Breakfast', 'Lunch', 'Snack', 'Drink'];
  for (let i = 0; i < defaultCategories.length; i++) {
    const name = defaultCategories[i];
    await prisma.menuCategory.upsert({
      where: { name },
      update: { sortOrder: i },
      create: { name, sortOrder: i },
    });
  }
  console.log('Menu categories seeded');

  // ── Sample Menu Items ─────────────────────────────────────────────────────
  console.log('Seeding sample menu items…');
  const menuCount = await prisma.menuItem.count();
  if (menuCount === 0) {
    await prisma.menuItem.createMany({
      data: [
        { name: 'Ugali Beef', description: 'Ugali with beef stew and vegetables', price: 150, category: 'Lunch' },
        { name: 'Chapati Beans', description: 'Two chapatis with bean stew', price: 100, category: 'Lunch' },
        { name: 'Tea & Mandazi', description: 'Hot tea with two mandazis', price: 50, category: 'Breakfast' },
      ],
    });
    console.log('Sample menu items seeded');
  }

  // ── Sample staff accounts (finance & restaurant) ───────────────────────────
  console.log('Seeding staff accounts…');
  const staffAccounts = [
    { email: 'finance@smartpos.com', name: 'Finance Officer', role: 'finance' },
    { email: 'restaurant@smartpos.com', name: 'Cafeteria Staff', role: 'restaurant' },
  ];

  for (const acct of staffAccounts) {
    const exists = await prisma.user.findUnique({ where: { email: acct.email } });
    if (!exists) {
      await prisma.user.create({
        data: {
          name: acct.name,
          email: acct.email,
          password: passwordHash,
          role: acct.role,
          status: 'approved',
        },
      });
      console.log(`${acct.role} user created - email: ${acct.email}  password: ${DEFAULT_PASSWORD}`);
    }
  }

  // ── Default parent (for demos / manual linking) ───────────────────────────
  console.log('Seeding default parent…');
  const parentPhone = '0712345678';
  let parent = await prisma.parent.findUnique({ where: { phone: parentPhone } });
  if (!parent) {
    parent = await prisma.parent.create({
      data: {
        name: 'Jane Parent',
        email: 'parent@smartpos.com',
        phone: parentPhone,
        password: passwordHash,
      },
    });
    console.log(`Parent created - phone: ${parentPhone}  password: ${DEFAULT_PASSWORD}`);
  }

  // ── Students from student(updated).xlsx (fallback: student.csv) ────────────
  console.log('Loading students from seed file…');
  let seedStudents: SeedStudent[] = [];
  let seedSource = 'student(updated).xlsx';
  try {
    seedStudents = loadStudentsFromXlsx();
  } catch (err: any) {
    seedSource = 'student.csv';
    seedStudents = loadStudentsFromCsv();
    console.warn(`XLSX seed load failed (${err?.message || err}). Falling back to student.csv`);
  }
  console.log(`Loaded ${seedStudents.length} rows from ${seedSource}. Seeding students…`);

  let created = 0;
  let updated = 0;

  for (let i = 0; i < seedStudents.length; i++) {
    const row = seedStudents[i];
    if (i % 10 === 0) {
      console.log(`  students: ${i}/${seedStudents.length}`);
    }

    const upserted = await prisma.student.upsert({
      where: { regNo: row.regNo },
      update: {
        name: row.name,
        gender: row.gender || undefined,
        className: row.className ?? null,
        walletBalance: row.walletBalance,
        category: row.category,
        password: passwordHash,
      },
      create: {
        name: row.name,
        regNo: row.regNo,
        gender: row.gender || 'male',
        className: row.className ?? null,
        password: passwordHash,
        walletBalance: row.walletBalance,
        category: row.category,
      },
      select: { id: true, createdAt: true },
    });

    // Cheap heuristic: if createdAt is within last minute, count as created
    if (Date.now() - new Date(upserted.createdAt).getTime() < 60_000) created++;
    else updated++;
  }

  const regularCount = seedStudents.filter((s) => s.category === 'regular').length;
  const sponsoredCount = seedStudents.filter((s) => s.category === 'sponsored').length;
  console.log(
    `Students seeded from ${seedSource}: ${seedStudents.length} total (${regularCount} regular, ${sponsoredCount} sponsored)`,
  );
  console.log(`  created: ${created}, updated: ${updated}, password: ${DEFAULT_PASSWORD}`);

  // ── Parents from parents-(updated).csv + link students ──────────────────────
  console.log('Loading parents links from parents-(updated).csv…');
  const parentLinks = loadParentLinksFromCsv();
  console.log(`Loaded ${parentLinks.length} parent/student link rows. Seeding parents & linking students…`);

  const primaryByAdmission = new Map<string, SeedParentLink>();
  for (const row of parentLinks) {
    const current = primaryByAdmission.get(row.admissionNo);
    if (!current) {
      primaryByAdmission.set(row.admissionNo, row);
      continue;
    }
    // Prefer explicitly primary rows; otherwise keep first seen.
    if (!current.isPrimary && row.isPrimary) {
      primaryByAdmission.set(row.admissionNo, row);
    }
  }

  let parentsUpserted = 0;
  let studentsLinked = 0;
  let missingStudents = 0;

  const primaryLinks = Array.from(primaryByAdmission.values());
  for (let i = 0; i < primaryLinks.length; i++) {
    const link = primaryLinks[i];
    if (i % 25 === 0) {
      console.log(`  parent links: ${i}/${primaryLinks.length}`);
    }
    const parent = await prisma.parent.upsert({
      where: { phone: link.phone },
      update: {
        name: link.parentName,
        email: link.email || null,
        receiveSms: link.receiveSms,
        receiveEmail: link.receiveEmail,
        password: passwordHash, // enforce default password for parent logins
      },
      create: {
        name: link.parentName,
        phone: link.phone,
        email: link.email || null,
        receiveSms: link.receiveSms,
        receiveEmail: link.receiveEmail,
        password: passwordHash,
      },
      select: { id: true, phone: true },
    });
    parentsUpserted++;

    try {
      await prisma.student.update({
        where: { regNo: link.admissionNo },
        data: {
          parentId: parent.id,
          parentRelationship: link.relationship || null,
          className: link.className || undefined,
        },
      });
      studentsLinked++;
    } catch {
      missingStudents++;
    }
  }

  console.log(`Parents upserted: ${parentsUpserted}`);
  console.log(`Students linked to parents: ${studentsLinked} (missing students: ${missingStudents})`);

  console.log('\nSeed complete!\n');
  await prisma.$disconnect();
}

seed().catch(async (err) => {
  console.error('Seed failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
