/**
 * Apply registration fees only to students onboarded on/after 8 Sep 2026,
 * and reverse fees wrongly charged to older students.
 *
 * Usage (from backend/):
 *   npx tsx scripts/apply-registration-fees.ts
 */
import 'dotenv/config';
import {
  backfillMissingRegistrationFees,
  REGISTRATION_FEE_DESCRIPTION,
  REGISTRATION_FEE_EFFECTIVE_FROM,
  REGISTRATION_FEE_KES,
} from '../services/registrationFee';
import prisma from '../services/prisma';

async function main() {
  console.log(
    `${REGISTRATION_FEE_DESCRIPTION} (KES ${REGISTRATION_FEE_KES}) only for onboardings on/after ${REGISTRATION_FEE_EFFECTIVE_FROM.toISOString()}`,
  );
  const result = await backfillMissingRegistrationFees();
  console.log(JSON.stringify(result, null, 2));
  if (result.missingAfter > 0) {
    console.error(`WARNING: ${result.missingAfter} eligible student(s) still missing the fee`);
    process.exitCode = 1;
  } else {
    console.log(
      `Done. Reversed (old students): ${result.reversed}. Applied (new): ${result.applied}. Balances synced: ${result.balancesSynced}.`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
