import { NextResponse } from 'next/server';
import prisma from '@/app/api/db';
import { redactOcrDocument } from '@/src/lib/ocr/documents';
import { ocrDocumentId, ocrRoute, readOcrJson } from '@/src/lib/ocr/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = ocrRoute(async (request, actor) => {
  let options = { redactNotes: true, purgeSource: true };
  try {
    const body = (await readOcrJson(request)) as Record<string, unknown>;
    if (body && typeof body === 'object') {
      options = {
        redactNotes: body.redactNotes !== false,
        purgeSource: body.purgeSource !== false,
      };
    }
  } catch {
    // Default options on empty body
  }
  return NextResponse.json({
    success: true,
    data: await redactOcrDocument(prisma, actor, ocrDocumentId(request), options),
  });
});
