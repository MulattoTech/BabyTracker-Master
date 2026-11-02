'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFamily } from '@/src/context/family';
import type { BottlePayload, BottleRow, JournalData, JournalRequest } from './types';

export function useBottleJournal(babyId: string | undefined, day: string, timeZone: string) {
  const { authenticatedFetch } = useFamily();
  const [data, setData] = useState<JournalData | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false), [refreshing, setRefreshing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const etag = useRef(''), inFlight = useRef(false), generation = useRef(0);
  const identity = `${babyId}:${day}:${timeZone}`;
  const identityRef = useRef(identity); identityRef.current = identity;
  const refresh = useCallback(async (force = false) => {
    if (!babyId || inFlight.current) return;
    const current = identityRef.current, ticket = generation.current;
    inFlight.current = true; setRefreshing(true);
    try {
      const query = new URLSearchParams({ babyId, day, timeZone });
      const response = await authenticatedFetch('/api/bottle-journal?' + query, { cache: 'no-store', headers: !force && etag.current ? { 'If-None-Match': etag.current } : {} });
      if (ticket !== generation.current || current !== identityRef.current) return;
      if (response.status !== 304) {
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'The journal could not refresh.');
        setData(result.data); etag.current = response.headers.get('etag') || '';
      }
      setLastSynced(new Date()); setError('');
    } catch (error) {
      if (current === identityRef.current) setError(error instanceof Error ? error.message : 'The journal could not refresh.');
    } finally { inFlight.current = false; if (current === identityRef.current) setRefreshing(false); }
  }, [babyId, day, timeZone, authenticatedFetch]);
  useEffect(() => {
    generation.current++; etag.current = ''; setData(null); setError(''); setNotice(''); setLastSynced(null);
    // A previous child/day request may still be finishing; retry on the next tick.
    const start = setTimeout(() => void refresh(true), 0);
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15_000);
    const foreground = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', foreground); window.addEventListener('online', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => { clearTimeout(start); clearInterval(interval); window.removeEventListener('focus', foreground); window.removeEventListener('online', foreground); document.removeEventListener('visibilitychange', foreground); };
  }, [identity, refresh]);
  const request: JournalRequest = async <T,>(url: string, body: unknown, method = 'POST') => {
    const response = await authenticatedFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'The journal request failed.');
    return result.data as T;
  };
  async function save(bottle: BottlePayload, requestId: string, editing?: BottleRow) {
    if (!babyId || saving) return false;
    const current = identityRef.current;
    setSaving(true); setError(''); setNotice('');
    try {
      await request('/api/bottle-journal', { babyId, bottle, requestId, ...(editing ? { expectedUpdatedAt: editing.updatedAt } : {}) });
      if (current === identityRef.current) { setNotice('Bottle saved.'); etag.current = ''; await refresh(true); }
      return true;
    } catch (error) { if (current === identityRef.current) setError(error instanceof Error ? error.message : 'The bottle was not confirmed saved. Keep the form open and retry.'); return false; }
    finally { setSaving(false); }
  }
  async function setTarget(targetMl: number | null) {
    if (!babyId) return;
    setSaving(true); setError('');
    try { await request('/api/bottle-journal', { babyId, targetMl }, 'PATCH'); setNotice('Intake target saved.'); etag.current = ''; await refresh(true); }
    catch (error) { setError(error instanceof Error ? error.message : 'The intake target could not be saved.'); }
    finally { setSaving(false); }
  }
  return { data: data?.babyId === babyId ? data : null, error, notice, saving, refreshing, lastSynced, refresh, save, setTarget, request };
}
