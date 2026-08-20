/**
 * Serialized browser-to-host snapshot upload. Requests are queued in change
 * order, identical queued/acknowledged payloads are deduplicated, and a
 * server-side 'disabled' receipt latches all later uploads off. The returned
 * promise settles after the host has durably archived the snapshot.
 */
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  PAGE_SNAPSHOTS_PATH,
  pageSnapshotReceiptOf,
  type PageSnapshotDraft,
  type PageSnapshotReceipt,
} from '../snapshot-contract.ts'
import {
  PREVIEW_CLIENT_HEADER,
  PREVIEW_CLIENT_HEADER_VALUE,
} from '../preview-contract.ts'

/**
 * Build one per-session snapshot upload face. The injected closure carries the
 * session id, so the view never assembles or forwards it.
 */
export function makeUploadSnapshot(sessionId: SessionId): (payload: PageSnapshotDraft) => Promise<PageSnapshotReceipt> {
  let tail: Promise<void> = Promise.resolve()
  let lastAcknowledged: { body: string; receipt: PageSnapshotReceipt } | undefined
  let lastScheduledBody: string | undefined
  let lastScheduledTask: Promise<PageSnapshotReceipt> | undefined
  let disabled = false
  return (payload) => {
    if (disabled) return Promise.resolve({ kind: 'disabled' } as const)
    const body = JSON.stringify({ sessionId, ...payload })
    if (lastScheduledTask === undefined && body === lastAcknowledged?.body) {
      return Promise.resolve(lastAcknowledged.receipt)
    }
    if (body === lastScheduledBody && lastScheduledTask !== undefined) return lastScheduledTask
    const task = tail.catch(() => undefined).then(async () => {
      if (disabled) return { kind: 'disabled' } as const
      if (body === lastAcknowledged?.body) return lastAcknowledged.receipt
      const response = await fetch(PAGE_SNAPSHOTS_PATH, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [PREVIEW_CLIENT_HEADER]: PREVIEW_CLIENT_HEADER_VALUE,
        },
        body,
      })
      if (!response.ok) throw new Error('page snapshot archive failed (' + String(response.status) + ')')
      const receipt = pageSnapshotReceiptOf(await response.json() as unknown)
      if (receipt === undefined) throw new Error('page snapshot archive returned an invalid receipt')
      if (receipt.kind === 'disabled') disabled = true
      lastAcknowledged = { body, receipt }
      return receipt
    })
    tail = task.then(() => undefined, () => undefined)
    lastScheduledBody = body
    lastScheduledTask = task
    task.then(
      () => {
        if (lastScheduledTask === task) {
          lastScheduledBody = undefined
          lastScheduledTask = undefined
        }
      },
      () => {
        if (lastScheduledTask === task) {
          lastScheduledBody = undefined
          lastScheduledTask = undefined
        }
      },
    )
    return task
  }
}
