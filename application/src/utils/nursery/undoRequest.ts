import { nurseryUndoEndpoint, readNurseryUndo, type NurseryUndo } from './undo';

export const undoUnconfirmed = 'Undo was not confirmed. Keep this action and retry or review the care log.';
export const undoConflict = 'This entry changed or was removed. Undo could not be confirmed. Review the care log.';
export const undoScopeChanged = 'The caregiver or child changed. Return to the original caregiver and child to review this action.';
export const undoSignIn = 'Sign in again as the original caregiver before retrying Undo.';

export class NurseryUndoFailure extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

/** Retry only the immutable original descriptor. A 404 or unreadable response
 * is never evidence that this request deleted the entry. */
export async function requestNurseryUndo(undo: NurseryUndo, scopeNow: () => string | null,
  fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!readNurseryUndo(undo)) throw new NurseryUndoFailure(undoConflict, false);
  if (scopeNow() !== undo.scope) throw new NurseryUndoFailure(undoScopeChanged, false);
  try {
    const token = localStorage.getItem('authToken');
    const response = await fetcher(nurseryUndoEndpoint(undo), {
      method: 'DELETE', cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
      body: JSON.stringify({ nurseryUndo: undo }), signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json();
    if (scopeNow() !== undo.scope) return false;
    if (response.ok && body.success === true) return true;
    if (response.status === 401 || response.status === 403) throw new NurseryUndoFailure(undoSignIn, true);
    if (body.code === 'NURSERY_UNDO_SCOPE_CHANGED') throw new NurseryUndoFailure(undoScopeChanged, false);
    if ([400, 404, 409].includes(response.status) && body.code !== 'NURSERY_UNDO_BUSY') throw new NurseryUndoFailure(undoConflict, false);
    throw new NurseryUndoFailure(undoUnconfirmed, true);
  } catch (error) {
    if (error instanceof NurseryUndoFailure) throw error;
    if (scopeNow() !== undo.scope) return false;
    throw new NurseryUndoFailure(undoUnconfirmed, true);
  }
}
