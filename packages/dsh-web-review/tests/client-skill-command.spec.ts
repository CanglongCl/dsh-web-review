import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it, vi } from 'vitest'
import { setUiSkillDraft } from '../src/client/index.ts'

describe('/skills draft selection', () => {
  it('writes the selected Skill invocation into the scoped stock composer', () => {
    const setDraft = vi.fn()
    const scope = {
      get: (name: string) => name === 'conversation'
        ? { input: { for: () => ({ setDraft }) } }
        : undefined,
    }
    const sessions = { scope: () => scope } as unknown as ISessions
    setUiSkillDraft({ sessions } as unknown as Pick<ClientContext, 'sessions'>, 'session-1' as SessionId, 'better-layout')
    expect(setDraft).toHaveBeenCalledWith('/better-layout')
  })

  it('rejects names outside the packaged allowlist', () => {
    const sessions = { scope: vi.fn() } as unknown as ISessions
    expect(() => setUiSkillDraft(
      { sessions } as unknown as Pick<ClientContext, 'sessions'>,
      'session-1' as SessionId,
      'not-a-skill',
    )).toThrow('unknown UI optimization Skill')
    expect(sessions.scope).not.toHaveBeenCalled()
  })
})
