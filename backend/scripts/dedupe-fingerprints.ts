/**
 * Backfill fingerprintTemplateHash and remove duplicate enrollments.
 * Run: npx ts-node -r tsconfig-paths/register scripts/dedupe-fingerprints.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import prisma from '@/services/prisma';
import { hashFingerprintTemplate } from '@/services/fingerprint';

async function main() {
  const students = await prisma.student.findMany({
    where: { fingerprintTemplate: { not: null } },
    orderBy: { fingerprintEnrolledAt: 'asc' },
    select: {
      id: true,
      name: true,
      regNo: true,
      fingerprintTemplate: true,
      fingerprintTemplateHash: true,
    },
  });

  const seenHashes = new Map<string, string>();
  const seenTemplates = new Map<string, string>();
  let backfilled = 0;
  let cleared = 0;

  for (const student of students) {
    const template = student.fingerprintTemplate!;
    const hash = student.fingerprintTemplateHash || hashFingerprintTemplate(template);

    const hashOwner = seenHashes.get(hash);
    const templateOwner = seenTemplates.get(template);

    if (hashOwner || templateOwner) {
      const ownerId = hashOwner || templateOwner!;
      const owner = students.find((s) => s.id === ownerId);
      console.log(
        `Removing duplicate fingerprint from ${student.name} (${student.regNo}) - already enrolled for ${owner?.name} (${owner?.regNo})`,
      );
      await prisma.student.update({
        where: { id: student.id },
        data: {
          fingerprintTemplate: null,
          fingerprintTemplateHash: null,
          fingerprintEnrolledAt: null,
        },
      });
      cleared++;
      continue;
    }

    seenHashes.set(hash, student.id);
    seenTemplates.set(template, student.id);

    if (!student.fingerprintTemplateHash) {
      await prisma.student.update({
        where: { id: student.id },
        data: { fingerprintTemplateHash: hash },
      });
      backfilled++;
    }
  }

  console.log(`Done. Backfilled ${backfilled}, cleared ${cleared} duplicate(s).`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
