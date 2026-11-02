import type { FeedLog, Prisma, PrismaClient, PumpLog } from '@prisma/client';
import { autoPumpFeedNotes, shouldHaveAutoPumpFeed } from '@/src/utils/breastMilkInventory';
import { representablePumpAmount } from '@/src/utils/pump-validation';
import { normalizeVolumeUnit } from '@/src/utils/unit-conversion';

export class PumpReconciliationConflict extends Error {
  constructor(message = 'This pumping record changed while you were saving. Review the latest pumping and feeding records before trying again.') {
    super(message);
  }
}

// Claim every scalar, not only updatedAt: two writers may share a timestamp.
// The caller validated its patch against this exact authenticated snapshot.
function snapshotWhere(pump: PumpLog): Prisma.PumpLogWhereInput {
  return { ...pump };
}

async function ownedFeed(tx: Prisma.TransactionClient, pump: PumpLog, previous?: PumpLog): Promise<FeedLog | null> {
  const linked = await tx.feedLog.findUnique({ where: { sourcePumpId: pump.id } });
  if (linked) {
    // An inconsistent source link must never authorize a cross-child/family edit.
    if (linked.familyId !== pump.familyId || linked.babyId !== pump.babyId) throw new PumpReconciliationConflict();
    return linked;
  }
  if (!previous || previous.pumpAction !== 'FED' || !previous.totalAmount || previous.totalAmount <= 0) return null;

  // Old automatic feeds predate sourcePumpId. A note prefix alone is not
  // ownership: require the complete original signature and one possible owner.
  const candidates = await tx.feedLog.findMany({ where: {
    sourcePumpId: null, familyId: previous.familyId, babyId: previous.babyId,
    caretakerId: previous.caretakerId, time: previous.startTime,
    type: 'BOTTLE', bottleType: 'Breast Milk', amount: previous.totalAmount,
    unitAbbr: previous.unitAbbr || 'OZ', notes: autoPumpFeedNotes(previous.notes), deletedAt: null,
  }, take: 2 });
  if (!candidates.length) return null;
  if (candidates.length > 1) throw new PumpReconciliationConflict();
  const otherPossibleOwner = await tx.pumpLog.findFirst({ where: {
    id: { not: pump.id }, familyId: previous.familyId, babyId: previous.babyId,
    caretakerId: previous.caretakerId, startTime: previous.startTime,
    totalAmount: previous.totalAmount, pumpAction: 'FED', notes: previous.notes, deletedAt: null,
    // A missing historical unit means OZ, just as it does in balance math.
    ...(normalizeVolumeUnit(previous.unitAbbr) === 'OZ'
      ? { OR: [{ unitAbbr: null }, { unitAbbr: 'OZ' }] }
      : { unitAbbr: previous.unitAbbr }),
  }, select: { id: true } });
  if (otherPossibleOwner) throw new PumpReconciliationConflict();
  return candidates[0];
}

async function reconcileFeed(tx: Prisma.TransactionClient, pump: PumpLog, previous?: PumpLog, deleting = false) {
  if (!pump.familyId || pump.deletedAt) throw new PumpReconciliationConflict();
  const feed = await ownedFeed(tx, pump, previous);
  const settings = deleting ? null : await tx.settings.findFirst({
    where: { familyId: pump.familyId }, select: { enableBreastMilkTracking: true },
  });
  const shouldHaveFeed = !deleting && shouldHaveAutoPumpFeed({
    trackingEnabled: settings?.enableBreastMilkTracking !== false,
    pumpAction: pump.pumpAction, totalAmount: pump.totalAmount,
  });
  if (!shouldHaveFeed) {
    if (feed) await tx.feedLog.delete({ where: { id: feed.id, familyId: pump.familyId, babyId: pump.babyId } });
    return;
  }
  // A separate soft deletion is a conflicting caregiver action, not permission
  // to resurrect a feed during an unrelated pump correction.
  const unit = normalizeVolumeUnit(pump.unitAbbr || 'OZ');
  if (feed?.deletedAt || !unit || !representablePumpAmount(pump.totalAmount, unit)) {
    throw new PumpReconciliationConflict();
  }
  const data = {
    time: pump.startTime, type: 'BOTTLE' as const, amount: pump.totalAmount,
    unitAbbr: pump.unitAbbr || 'OZ', bottleType: 'Breast Milk',
    notes: autoPumpFeedNotes(pump.notes), sourcePumpId: pump.id,
    familyId: pump.familyId, babyId: pump.babyId, caretakerId: pump.caretakerId,
  };
  if (feed) await tx.feedLog.update({ where: { id: feed.id, familyId: pump.familyId, babyId: pump.babyId }, data });
  else await tx.feedLog.create({ data });
}

export async function createPumpWithFeed(db: PrismaClient, data: Prisma.PumpLogUncheckedCreateInput) {
  return db.$transaction(async tx => {
    const pump = await tx.pumpLog.create({ data });
    await reconcileFeed(tx, pump);
    return pump;
  });
}

export async function updatePumpWithFeed(db: PrismaClient, previous: PumpLog, data: Prisma.PumpLogUpdateManyMutationInput) {
  return db.$transaction(async tx => {
    if (previous.deletedAt) throw new PumpReconciliationConflict();
    const claimed = await tx.pumpLog.updateMany({ where: snapshotWhere(previous), data: {
      ...data, updatedAt: new Date(Math.max(Date.now(), previous.updatedAt.getTime() + 1)),
    } });
    if (claimed.count !== 1) throw new PumpReconciliationConflict();
    const pump = await tx.pumpLog.findUniqueOrThrow({ where: { id: previous.id } });
    await reconcileFeed(tx, pump, previous);
    return pump;
  });
}

export async function deletePumpWithFeed(db: PrismaClient, previous: PumpLog) {
  return db.$transaction(async tx => {
    if (previous.deletedAt) throw new PumpReconciliationConflict();
    const deleted = await tx.pumpLog.deleteMany({ where: snapshotWhere(previous) });
    if (deleted.count !== 1) throw new PumpReconciliationConflict();
    await reconcileFeed(tx, previous, previous, true);
  });
}
