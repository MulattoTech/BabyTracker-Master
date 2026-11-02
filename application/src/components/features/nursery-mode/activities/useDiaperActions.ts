'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useLocalization } from '@/src/context/localization';
import { ActivityHookArgs, ActivityView } from './types';
import { readNurseryUndo } from '@/src/utils/nursery/undo';
import { useNurseryOwner } from './useNurseryOwner';
import { conditionalUndo } from './conditionalUndo';

/**
 * Diaper activity — transplanted 1:1 from DiaperTile.tsx.
 * Instant POST /api/diaper-log with one-tap undo support.
 */
export function useDiaperActions({ babyId, toUTCString, onLog, onUndoable }: ActivityHookArgs): ActivityView {
  const { t } = useLocalization();
  const [submitting, setSubmitting] = useState(false);
  const owner = useNurseryOwner(babyId), busy = useRef(false), requestId = useRef(0);
  useEffect(() => { requestId.current++; busy.current = false; setSubmitting(false); }, [owner.scope, owner.epoch]);

  const submitDiaper = useCallback(async (type: string) => {
    const captured = owner.capture();
    if (busy.current || !owner.isCurrent(captured)) return;
    const request = ++requestId.current;
    busy.current = true;
    setSubmitting(true);
    try {
      const authToken = localStorage.getItem('authToken');
      const now = toUTCString(new Date());
      const res = await fetch('/api/diaper-log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authToken ? `Bearer ${authToken}` : '',
        },
        body: JSON.stringify({ babyId, time: now, type, nurseryScope: captured!.scope }),
      });
      const data = await res.json();
      if (!owner.isCurrent(captured) || request !== requestId.current) return;
      if (res.ok && data.success && data.data?.id) {
        const labels: Record<string, string> = { WET: t('Wet'), DIRTY: t('Dirty'), BOTH: t('Both'), DRY: t('Dry') };
        onLog('diaper', labels[type] || type, data.data.time);
        const undo = readNurseryUndo(data.undo);
        if (undo?.kind === 'diaper' && undo.scope === captured!.scope && undo.records[0].id === data.data.id) {
          const messages: Record<string, string> = {
            WET: t('Wet diaper logged'),
            DIRTY: t('Dirty diaper logged'),
            BOTH: t('Diaper logged'),
            DRY: t('Dry diaper logged'),
          };
          onUndoable(conditionalUndo(undo, messages[type] || t('Diaper logged'), owner.scopeNow, () => owner.isCurrent(captured)));
        }
      }
    } catch (err) {
      console.error('Error logging diaper:', err);
    } finally {
      if (owner.isCurrent(captured) && request === requestId.current) { busy.current = false; setSubmitting(false); }
    }
  }, [babyId, toUTCString, onLog, onUndoable, owner.capture, owner.isCurrent, owner.scopeNow, t]);

  return {
    id: 'diaper',
    icon: 'diaper',
    label: t('Diaper'),
    statusText: null,
    active: false,
    question: false,
    // Four buttons (Wet/Dirty/Both/Dry) no longer fit one nowrap row at narrow widths
    // in longer-label locales (e.g. Italian, Dutch); wrap instead of silently
    // overflowing past the card with no scroll affordance.
    buttonsWrap: true,
    buttons: [
      { key: 'wet', label: t('Wet'), onClick: () => submitDiaper('WET'), disabled: submitting },
      { key: 'dirty', label: t('Dirty'), onClick: () => submitDiaper('DIRTY'), disabled: submitting },
      { key: 'both', label: t('Both'), onClick: () => submitDiaper('BOTH'), disabled: submitting },
      { key: 'dry', label: t('Dry'), onClick: () => submitDiaper('DRY'), disabled: submitting },
    ],
  };
}
