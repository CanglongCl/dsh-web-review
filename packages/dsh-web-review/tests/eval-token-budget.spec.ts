import { describe, expect, it } from 'vitest'
import { loadTasks } from '../../../eval/tasks/register.ts'
import { budgetedTokens, tokenBudgetExceeded } from '../../../eval/token-budget.ts'

describe('eval token budgets', () => {
  it('assigns a valid expectation and warning threshold to every task', async () => {
    const tasks = await loadTasks()
    expect(tasks.length).toBeGreaterThan(0)
    for (const task of tasks) {
      expect(task.tokenBudget.expected, task.id).toBeGreaterThan(0)
      expect(task.tokenBudget.warnAbove, task.id).toBeGreaterThan(task.tokenBudget.expected)
    }
  })

  it('warns only when uncached input plus output strictly exceeds the threshold', () => {
    const budget = { expected: 20_000, warnAbove: 30_000 }
    expect(budgetedTokens({ input: 18_000, output: 12_000 })).toBe(30_000)
    expect(tokenBudgetExceeded({ input: 18_000, output: 12_000 }, budget)).toBe(false)
    expect(tokenBudgetExceeded({ input: 18_001, output: 12_000 }, budget)).toBe(true)
  })
})
