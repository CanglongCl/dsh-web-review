/** Stable, task-authored token expectations used for cost diagnostics only. */
import type { Difficulty, EvalTask, TokenBudget, TokenTotals } from './types.ts'

const DEFAULT_BUDGETS: Record<Exclude<Difficulty, 'long'>, TokenBudget> = {
  easy: { expected: 20_000, warnAbove: 25_000 },
  medium: { expected: 22_000, warnAbove: 28_000 },
  hard: { expected: 26_000, warnAbove: 34_000 },
}

const LONG_TASK_BUDGETS: Record<string, TokenBudget> = {
  'react-operations-01': { expected: 35_000, warnAbove: 50_000 },
  'static-catalog-01': { expected: 20_000, warnAbove: 30_000 },
}

/** Resolve one explicit budget for every registered task. */
export function tokenBudgetForTask(task: Pick<EvalTask, 'id' | 'difficulty' | 'tokenBudget'>): TokenBudget {
  const budget = task.tokenBudget
    ?? (task.difficulty === 'long' ? LONG_TASK_BUDGETS[task.id] : DEFAULT_BUDGETS[task.difficulty])
  if (budget === undefined) throw new Error(`long eval task ${task.id} must declare a token budget`)
  if (!Number.isInteger(budget.expected) || !Number.isInteger(budget.warnAbove) || budget.expected <= 0 || budget.warnAbove <= budget.expected) {
    throw new Error(`eval task ${task.id} has an invalid token budget`)
  }
  return budget
}

/** Budgeted usage excludes cache traffic and separately reported reasoning. */
export function budgetedTokens(tokens: Pick<TokenTotals, 'input' | 'output'>): number {
  return tokens.input + tokens.output
}

export function tokenBudgetExceeded(tokens: Pick<TokenTotals, 'input' | 'output'>, budget: TokenBudget): boolean {
  return budgetedTokens(tokens) > budget.warnAbove
}
