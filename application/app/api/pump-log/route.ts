import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import prisma from '../db';
import { ApiResponse, PumpLogCreate, PumpLogResponse } from '../types';
import { withAuthContext, AuthResult } from '../utils/auth';
import { toUTC, formatForResponse } from '../utils/timezone';
import { checkWritePermission } from '../utils/writeProtection';
import { notifyActivityCreated } from '@/src/lib/notifications/activityHook';
import {
  autoPumpFeedNotes,
  AUTO_PUMP_FEED_PREFIX,
  planAutoFeedSync,
  shouldHaveAutoPumpFeed,
} from '@/src/utils/breastMilkInventory';
import { normalizeVolumeUnit } from '@/src/utils/unit-conversion';
import { isPumpAction } from '@/src/utils/pumpAction';
import { preparePumpFields } from './fields';

class PumpUpdateConflictError extends Error {
  constructor() {
    super('This pumping record changed while you were saving. Reopen it, review the latest values, and try again.');
  }
}

async function handlePost(req: NextRequest, authContext: AuthResult) {
  // Check write permissions for expired accounts
  const writeCheck = checkWritePermission(authContext);
  if (!writeCheck.allowed) {
    return writeCheck.response!;
  }

  try {
    const { familyId: userFamilyId, caretakerId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
    }

    const body: PumpLogCreate = await req.json().catch(() => null);
    const prepared = preparePumpFields(body);
    if ('error' in prepared) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: prepared.error }, { status: 400 });
    }

    const baby = await prisma.baby.findFirst({
      where: { id: body.babyId, familyId: userFamilyId },
    });

    if (!baby) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Baby not found in this family.' }, { status: 404 });
    }
    
    const { startTime: startTimeUTC, totalAmount } = prepared;
    
    // Validate pumpAction
    const pumpAction = body.pumpAction === undefined ? 'STORED' : body.pumpAction;
    if (!isPumpAction(pumpAction)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid pump action. Must be STORED, FED, DISCARDED, or UNKNOWN.' }, { status: 400 });
    }

    // Validate/normalize the volume unit — an unknown unit silently corrupts
    // breast-milk balances (convertVolume no-ops on units it can't convert).
    let unitAbbr = body.unitAbbr;
    if (unitAbbr !== undefined) {
      const normalizedUnit = normalizeVolumeUnit(unitAbbr);
      if (!normalizedUnit) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid unit. Supported units are OZ and ML.' }, { status: 400 });
      }
      unitAbbr = normalizedUnit;
    }

    const familySettings = await prisma.settings.findFirst({
      where: { familyId: userFamilyId },
      select: { enableBreastMilkTracking: true },
    });
    const trackingEnabled = familySettings?.enableBreastMilkTracking !== false;

    const pumpLog = await prisma.$transaction(async (tx) => {
      const createdPumpLog = await tx.pumpLog.create({
        data: {
          ...prepared.data,
          babyId: body.babyId,
          startTime: startTimeUTC,
          unitAbbr,
          pumpAction,
          notes: body.notes,
          caretakerId: caretakerId,
          familyId: userFamilyId,
        },
      });

      // Keep the feeding record for reports, but link it to the pump so it can
      // be synchronized and excluded from stored-inventory consumption.
      if (shouldHaveAutoPumpFeed({ trackingEnabled, pumpAction, totalAmount })) {
        await tx.feedLog.create({
          data: {
            time: startTimeUTC,
            type: 'BOTTLE',
            amount: totalAmount,
            unitAbbr: unitAbbr || 'OZ',
            bottleType: 'Breast Milk',
            notes: autoPumpFeedNotes(body.notes),
            sourcePumpId: createdPumpLog.id,
            babyId: body.babyId,
            caretakerId: caretakerId,
            familyId: userFamilyId,
          },
        });
      }

      return createdPumpLog;
    });

    // Format dates as ISO strings for response
    const response: PumpLogResponse = {
      ...pumpLog,
      startTime: formatForResponse(pumpLog.startTime) || '',
      endTime: formatForResponse(pumpLog.endTime) || null,
      createdAt: formatForResponse(pumpLog.createdAt) || '',
      updatedAt: formatForResponse(pumpLog.updatedAt) || '',
      deletedAt: formatForResponse(pumpLog.deletedAt),
    };

    // Notify subscribers about activity creation (non-blocking)
    notifyActivityCreated(pumpLog.babyId, 'pump', { accountId: authContext.accountId, caretakerId: authContext.caretakerId }, { totalAmount, unitAbbr }).catch(console.error);

    return NextResponse.json<ApiResponse<PumpLogResponse>>({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error('Error creating pump log:', error);
    return NextResponse.json<ApiResponse<PumpLogResponse>>(
      {
        success: false,
        error: 'Failed to create pump log',
      },
      { status: 500 }
    );
  }
}

async function handlePut(req: NextRequest, authContext: AuthResult) {
  // Check write permissions for expired accounts
  const writeCheck = checkWritePermission(authContext);
  if (!writeCheck.allowed) {
    return writeCheck.response!;
  }

  try {
    const { familyId: userFamilyId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const body: Partial<PumpLogCreate> = await req.json().catch(() => null);

    if (!id) {
      return NextResponse.json<ApiResponse<PumpLogResponse>>(
        {
          success: false,
          error: 'Pump log ID is required',
        },
        { status: 400 }
      );
    }

    const existingPumpLog = await prisma.pumpLog.findFirst({
      where: { id, familyId: userFamilyId },
    });

    if (!existingPumpLog) {
      return NextResponse.json<ApiResponse<PumpLogResponse>>(
        {
          success: false,
          error: 'Pump log not found or access denied',
        },
        { status: 404 }
      );
    }
    const prepared = preparePumpFields(body, existingPumpLog);
    if ('error' in prepared) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: prepared.error }, { status: 400 });
    }

    // If the caller is reassigning the pump to a baby, that baby must belong to
    // their family — never trust a client-sent babyId across families.
    if (body.babyId !== undefined && body.babyId !== existingPumpLog.babyId) {
      const targetBaby = await prisma.baby.findFirst({
        where: { id: body.babyId, familyId: userFamilyId },
      });
      if (!targetBaby) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Baby not found in this family.' }, { status: 404 });
      }
    }

    // Validate/normalize the volume unit before it reaches the balance math.
    if (body.unitAbbr !== undefined) {
      const normalizedUnit = normalizeVolumeUnit(body.unitAbbr);
      if (!normalizedUnit) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid unit. Supported units are OZ and ML.' }, { status: 400 });
      }
      body.unitAbbr = normalizedUnit;
    }

    const data: any = { ...prepared.data };
    
    // Add other fields
    if (body.unitAbbr !== undefined) data.unitAbbr = body.unitAbbr;
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.babyId !== undefined) data.babyId = body.babyId;
    if (body.pumpAction !== undefined) {
      if (!isPumpAction(body.pumpAction)) {
        return NextResponse.json<ApiResponse<null>>({ success: false, error: 'Invalid pump action. Must be STORED, FED, DISCARDED, or UNKNOWN.' }, { status: 400 });
      }
      data.pumpAction = body.pumpAction;
    }

    const finalStartTime = prepared.startTime;
    const finalTotalAmount = prepared.totalAmount;
    const finalPumpAction = body.pumpAction ?? existingPumpLog.pumpAction;
    const finalUnitAbbr = body.unitAbbr !== undefined ? body.unitAbbr : existingPumpLog.unitAbbr;
    const finalNotes = body.notes !== undefined ? body.notes : existingPumpLog.notes;
    const finalBabyId = body.babyId !== undefined ? body.babyId : existingPumpLog.babyId;

    const familySettings = await prisma.settings.findFirst({
      where: { familyId: userFamilyId },
      select: { enableBreastMilkTracking: true },
    });
    const trackingEnabled = familySettings?.enableBreastMilkTracking !== false;

    const pumpLog = await prisma.$transaction(async (tx) => {
      // Validation and derived fields use the snapshot read above. Claim that
      // exact state before reading or changing its owned feed. updatedAt alone
      // is insufficient because another writer can share its millisecond value.
      const claimed = await tx.pumpLog.updateMany({
        where: {
          id,
          familyId: userFamilyId,
          babyId: existingPumpLog.babyId,
          caretakerId: existingPumpLog.caretakerId,
          startTime: existingPumpLog.startTime,
          endTime: existingPumpLog.endTime,
          duration: existingPumpLog.duration,
          leftAmount: existingPumpLog.leftAmount,
          rightAmount: existingPumpLog.rightAmount,
          totalAmount: existingPumpLog.totalAmount,
          unitAbbr: existingPumpLog.unitAbbr,
          pumpAction: existingPumpLog.pumpAction,
          notes: existingPumpLog.notes,
          createdAt: existingPumpLog.createdAt,
          updatedAt: existingPumpLog.updatedAt,
          deletedAt: existingPumpLog.deletedAt,
        } satisfies Prisma.PumpLogWhereInput,
        data: {
          ...data,
          // Even an unchanged form must claim the snapshot before feed sync.
          updatedAt: new Date(Math.max(Date.now(), existingPumpLog.updatedAt.getTime() + 1)),
        },
      });
      if (claimed.count !== 1) throw new PumpUpdateConflictError();
      const updatedPumpLog = await tx.pumpLog.findFirstOrThrow({ where: { id, familyId: userFamilyId } });

      const linkedAutoFeed = await tx.feedLog.findFirst({
        where: {
          sourcePumpId: id,
          familyId: userFamilyId,
          babyId: existingPumpLog.babyId,
        },
      });
      // Only a previously FED pump can own an unlinked legacy automatic feed.
      const legacyAutoFeed = linkedAutoFeed || existingPumpLog.pumpAction !== 'FED' ? null : await tx.feedLog.findFirst({
        where: {
          sourcePumpId: null,
          babyId: existingPumpLog.babyId,
          familyId: userFamilyId,
          time: existingPumpLog.startTime,
          type: 'BOTTLE',
          bottleType: 'Breast Milk',
          ...(existingPumpLog.totalAmount != null ? { amount: existingPumpLog.totalAmount } : {}),
          notes: { startsWith: AUTO_PUMP_FEED_PREFIX },
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      });

      const plan = planAutoFeedSync({
        shouldHaveAutoFeed: shouldHaveAutoPumpFeed({
          trackingEnabled,
          pumpAction: finalPumpAction,
          totalAmount: finalTotalAmount,
        }),
        linkedAutoFeedId: linkedAutoFeed?.id,
        legacyAutoFeedId: legacyAutoFeed?.id,
      });

      if (plan.action === 'upsert') {
        const feedData = {
          time: finalStartTime,
          type: 'BOTTLE' as const,
          amount: finalTotalAmount,
          unitAbbr: finalUnitAbbr || 'OZ',
          bottleType: 'Breast Milk',
          notes: autoPumpFeedNotes(finalNotes),
          sourcePumpId: id,
          deletedAt: null,
          babyId: finalBabyId,
          caretakerId: existingPumpLog.caretakerId,
          familyId: userFamilyId,
        };

        if (plan.updateId) {
          await tx.feedLog.update({ where: { id: plan.updateId }, data: feedData });
        } else {
          await tx.feedLog.create({ data: feedData });
        }
      } else if (plan.action === 'delete') {
        for (const feedId of plan.deleteIds) {
          await tx.feedLog.delete({ where: { id: feedId } });
        }
      }

      return updatedPumpLog;
    });

    // Format dates as ISO strings for response
    const response: PumpLogResponse = {
      ...pumpLog,
      startTime: formatForResponse(pumpLog.startTime) || '',
      endTime: formatForResponse(pumpLog.endTime) || null,
      createdAt: formatForResponse(pumpLog.createdAt) || '',
      updatedAt: formatForResponse(pumpLog.updatedAt) || '',
      deletedAt: formatForResponse(pumpLog.deletedAt),
    };

    return NextResponse.json<ApiResponse<PumpLogResponse>>({
      success: true,
      data: response,
    });
  } catch (error) {
    if (error instanceof PumpUpdateConflictError) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: error.message }, { status: 409 });
    }
    console.error('Error updating pump log:', error);
    return NextResponse.json<ApiResponse<PumpLogResponse>>(
      {
        success: false,
        error: 'Failed to update pump log',
      },
      { status: 500 }
    );
  }
}

async function handleGet(req: NextRequest, authContext: AuthResult) {
  try {
    const { familyId: userFamilyId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const babyId = searchParams.get('babyId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    
    const queryParams: any = {
      familyId: userFamilyId,
      ...(babyId && { babyId }),
    };
    
    // Add date range filter if both start and end dates are provided
    if (startDate && endDate) {
      queryParams.startTime = {
        gte: toUTC(startDate),
        lte: toUTC(endDate),
      };
    }

    // If ID is provided, fetch a single pump log
    if (id) {
      const pumpLog = await prisma.pumpLog.findFirst({
        where: { 
          id,
          familyId: userFamilyId,
        },
      });

      if (!pumpLog) {
        return NextResponse.json<ApiResponse<PumpLogResponse>>(
          {
            success: false,
            error: 'Pump log not found or access denied',
          },
          { status: 404 }
        );
      }

      // Format dates as ISO strings for response
      const response: PumpLogResponse = {
        ...pumpLog,
        startTime: formatForResponse(pumpLog.startTime) || '',
        endTime: formatForResponse(pumpLog.endTime) || null,
        createdAt: formatForResponse(pumpLog.createdAt) || '',
        updatedAt: formatForResponse(pumpLog.updatedAt) || '',
        deletedAt: formatForResponse(pumpLog.deletedAt),
      };

      return NextResponse.json<ApiResponse<PumpLogResponse>>({
        success: true,
        data: response,
      });
    }

    // Otherwise, fetch multiple pump logs based on query parameters
    const pumpLogs = await prisma.pumpLog.findMany({
      where: queryParams,
      orderBy: {
        startTime: 'desc',
      },
    });

    // Format dates as ISO strings for response
    const response: PumpLogResponse[] = pumpLogs.map(pumpLog => ({
      ...pumpLog,
      startTime: formatForResponse(pumpLog.startTime) || '',
      endTime: formatForResponse(pumpLog.endTime) || null,
      createdAt: formatForResponse(pumpLog.createdAt) || '',
      updatedAt: formatForResponse(pumpLog.updatedAt) || '',
      deletedAt: formatForResponse(pumpLog.deletedAt),
    }));

    return NextResponse.json<ApiResponse<PumpLogResponse[]>>({
      success: true,
      data: response,
    });
  } catch (error) {
    console.error('Error fetching pump logs:', error);
    return NextResponse.json<ApiResponse<PumpLogResponse[]>>(
      {
        success: false,
        error: 'Failed to fetch pump logs',
      },
      { status: 500 }
    );
  }
}

async function handleDelete(req: NextRequest, authContext: AuthResult) {
  // Check write permissions for expired accounts
  const writeCheck = checkWritePermission(authContext);
  if (!writeCheck.allowed) {
    return writeCheck.response!;
  }

  try {
    const { familyId: userFamilyId } = authContext;
    if (!userFamilyId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, error: 'User is not associated with a family.' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json<ApiResponse<void>>(
        {
          success: false,
          error: 'Pump log ID is required',
        },
        { status: 400 }
      );
    }

    const existingPumpLog = await prisma.pumpLog.findFirst({
      where: { id, familyId: userFamilyId },
    });

    if (!existingPumpLog) {
      return NextResponse.json<ApiResponse<void>>(
        {
          success: false,
          error: 'Pump log not found or access denied',
        },
        { status: 404 }
      );
    }

    await prisma.$transaction(async (tx) => {
      const linkedAutoFeed = await tx.feedLog.findFirst({
        where: {
          sourcePumpId: id,
          familyId: userFamilyId,
          babyId: existingPumpLog.babyId,
        },
      });
      // UNKNOWN imports must never delete a matching feed from another session.
      const legacyAutoFeed = linkedAutoFeed || existingPumpLog.pumpAction !== 'FED' ? null : await tx.feedLog.findFirst({
        where: {
          sourcePumpId: null,
          babyId: existingPumpLog.babyId,
          familyId: userFamilyId,
          time: existingPumpLog.startTime,
          type: 'BOTTLE',
          bottleType: 'Breast Milk',
          ...(existingPumpLog.totalAmount != null ? { amount: existingPumpLog.totalAmount } : {}),
          notes: { startsWith: AUTO_PUMP_FEED_PREFIX },
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      });

      const plan = planAutoFeedSync({
        shouldHaveAutoFeed: false,
        linkedAutoFeedId: linkedAutoFeed?.id,
        legacyAutoFeedId: legacyAutoFeed?.id,
      });

      if (plan.action === 'delete') {
        for (const feedId of plan.deleteIds) {
          await tx.feedLog.delete({ where: { id: feedId } });
        }
      }

      await tx.pumpLog.delete({ where: { id } });
    });

    return NextResponse.json<ApiResponse<void>>({
      success: true,
    });
  } catch (error) {
    console.error('Error deleting pump log:', error);
    return NextResponse.json<ApiResponse<void>>(
      {
        success: false,
        error: 'Failed to delete pump log',
      },
      { status: 500 }
    );
  }
}

// Apply authentication middleware to all handlers
// Use type assertions to handle the multiple return types
export const GET = withAuthContext(handleGet as (req: NextRequest, authContext: AuthResult) => Promise<NextResponse<ApiResponse<any>>>);
export const POST = withAuthContext(handlePost as (req: NextRequest, authContext: AuthResult) => Promise<NextResponse<ApiResponse<any>>>);
export const PUT = withAuthContext(handlePut as (req: NextRequest, authContext: AuthResult) => Promise<NextResponse<ApiResponse<any>>>);
export const DELETE = withAuthContext(handleDelete as (req: NextRequest, authContext: AuthResult) => Promise<NextResponse<ApiResponse<any>>>);
