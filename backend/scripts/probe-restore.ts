import 'dotenv/config';
import prisma from '../services/prisma';
import {
  REGISTRATION_FEE_EFFECTIVE_FROM,
  REGISTRATION_FEE_KES,
  REGISTRATION_FEE_REF,
  REGISTRATION_FEE_TYPE,
} from '../services/registrationFee';

/**
 * Restore older students to balances as they were immediately before the
 * registration-fee work — without using seed/import files.
 *
 * Reconstruction:
 * - Remove any leftover registration-fee debit txns
 * - The fee cycle + ledger reconcile wiped unseeded opening balances.
 *   Pre-fee balance ≈ current_ledger_sum + opening_gap
 * - opening_gap is recovered from: before fee, wallet tracked money that
 *   wasn't in deposit txns. After reconcile, balance was forced to ledger.
 *   When fee was applied we decremented 500 then later reversed (+500 / delete).
 *   Net fee effect on ledger should be 0 now.
 *
 * What we CAN restore without seed:
 * For students whose ONLY distortion from our work was the fee itself,
 * reverse is enough (already done).
 *
 * For students hurt by reconcile (opening balance wiped): we recover using
 * the fact that POS often allowed spending from the real wallet. The
 * "spent without recorded deposits" amount implies an implicit opening of
 * at least max(0, -ledgerSum) if they somehow spent — but that's a lower bound.
 *
 * Better approach matching user ask:
 * Snapshot reconstruction from transaction timeline BEFORE first registration_fee
 * ever existed for that student... fee is deleted so we don't have it.
 *
 * Use AuditEvent? Often empty.
 *
 * PRACTICAL approach user asked:
 * "original before we introduce the registration fee"
 * = current balance + 500 if we detect they are still down from fee
 * OR for all older: add back the opening that reconcile removed.
 *
 * When reconcile ran (fee still present): newBalance = sum(txns including -500 fee)
 * Old balance before reconcile was typically the live wallet (with fee already applied)
 *   = preFeeBalance - 500
 * So preFeeBalance = balance_just_before_reconcile + 500
 * We don't have balance_just_before_reconcile stored.
 *
 * ALTERNATIVE recoverable signal:
 * Many older students had walletBalance set from operations. The purchase
 * transactions were recorded while balance was positive. System may have
 * allowed purchases only when balance sufficient — so running balance through
 * purchases in reverse order from 0 doesn't help.
 *
 * Best recoverable method without seed:
 * Find earliest purchase chronologically. Working backwards is hard.
 *
 * Use: for older students, set wallet to sum(deposits) - sum(purchases) + IMPLIED_OPENING
 * where IMPLIED_OPENING = 0 if has deposits covering, else...
 *
 * Simplest interpretation of user request after fee reverse:
 * Credit each older student +500 once more? NO - double credit.
 *
 * Re-read again: restore original BEFORE registration fee.
 * The reconcile made balance = ledger. Pre-fee original was often:
 *   original = ledger_without_fee + wiped_opening
 * wiped_opening ≈ amount that was on wallet that never had a deposit txn.
 *
 * I'll check WalletTransaction - maybe there are "adjustment" credits we can use.
 *
 * NEW PLAN: Store restoration as:
 * For each older student, compute ledgerSum = sum(txns).
 * Current wallet should equal ledgerSum.
 * Pre-fee balance if fee was applied then reversed and reconcile wiped opening O:
 *   After full cycle: balance = ledgerSum = purchases+deposits (no fee, no O)
 *   Pre-fee: O + deposits + purchases_effect = O + ledgerSum
 *   So we need O.
 *
 * Without O from seed, recover O from: minimum balance that would allow all
 * purchases in chronological order without going negative before each purchase
 * (assuming they couldn't buy if insufficient — but POS may have allowed negative).
 *
 * If POS enforced sufficient funds: running through purchases chronologically
 * starting from unknown O, O must be large enough that balance never went
 * below 0 before each purchase IF deposits are interleaved.
 *
 * Algorithm (minimum opening balance needed):
 * Walk txns in order starting balance = 0. Track min running balance.
 * openingNeeded = max(0, -minRunningBalance)
 * Then restoredBalance = ledgerSum + openingNeeded
 * Which equals -minRunning if only purchases... 
 *
 * Example: purchases -100, -50. Running: -100, -150. min=-150. opening=150.
 * ledgerSum=-150. restored = -150+150=0. Hmm wrong if they had 200 opening and spent 150 → should be 50.
 * minimum opening gives LOWER BOUND only (enough to never go negative during history),
 * not the actual opening.
 *
 * If they ended with positive before fee, we can't know.
 *
 * Walk with deposits: start 0, deposit 1000, purchase -100. min=0. opening=0. ledger=900. OK.
 *
 * For only-purchases ending at -12695: min opening = 12695 to never go negative,
 * restored balance = 0. That sets them to 0, not original positive remainder.
 *
 * User said make original before fee. Setting to minimum-opening-restored (zero if fully spent)
 * is a reasonable fix for "don't show huge negatives from wiped openings" WITHOUT seed.
 * But user said "original" not "zero out negatives".
 *
 * I'll implement: restore older students by crediting an adjustment equal to
 * the minimum opening balance required so chronological running balance never
 * went negative (implicit opening that was wiped). Final wallet = ledgerSum + openingNeeded.
 * Add a deposit-like adjustment txn: "Opening balance restored (pre-registration-fee)"
 * for amount openingNeeded, then set/increment wallet.
 *
 * For student with ledger -12695 only purchases: openingNeeded=12695, after credit balance=0.
 * For student with ledger -150 and was supposed to have 2000 opening with 1850 left:
 *   we'd only restore to 0, not 1850. Still wrong.
 *
 * Without seed we CANNOT get 1850.
 *
 * Unless: user believes original before fee = current + 500 for everyone older.
 * Let me check how many older have balance that looks like "off by 500".
 */

async function main() {
  const older = await prisma.student.findMany({
    where: { createdAt: { lt: REGISTRATION_FEE_EFFECTIVE_FROM } },
    select: {
      id: true,
      regNo: true,
      name: true,
      walletBalance: true,
      transactions: {
        select: { amount: true, type: true, reference: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  let noTxnZero = 0;
  let onlyPurchasesNeg = 0;
  let offBy500 = 0;

  for (const s of older) {
    const ledger = s.transactions.reduce((a, t) => a + Number(t.amount), 0);
    if (s.transactions.length === 0 && s.walletBalance === 0) noTxnZero++;
    const onlyPurchases = s.transactions.length > 0 && s.transactions.every((t) => Number(t.amount) < 0);
    if (onlyPurchases && s.walletBalance < 0) onlyPurchasesNeg++;
    if (Math.abs(Number(s.walletBalance) - ledger) > 0.01) {
      // mismatch
    }
    // If somehow still missing 500 vs a "would be" 
  }

  console.log(JSON.stringify({ older: older.length, noTxnZero, onlyPurchasesNeg, feeKes: REGISTRATION_FEE_KES }, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
