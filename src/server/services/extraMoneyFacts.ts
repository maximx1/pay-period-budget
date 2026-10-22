import type { AdvicePlan, ExtraMoneyFacts } from "../../shared/advice.ts";
import { formatApr } from "../../shared/balances.ts";
import { formatDateRange } from "../../shared/dates.ts";
import { formatCents, parseMoneyInput } from "../../shared/money.ts";
import { describeMonths, makePlan, PLAN_STRATEGIES, type PlanLine, safeToSpare, STRATEGY_LABELS } from "../../shared/paydown.ts";

// The extra-money part of the facts a model gets for a Smart Question about extra money
// (phase 29), and the one line of its answer that names payments. Items are numbered in
// the facts, "[1] Visa", so a model never has to copy an id.

const money = formatCents;

/** The amount the plans use: what was asked, but never so much a coming period ends below zero. */
export const usableAmount = (amountCents: number, extra: ExtraMoneyFacts) =>
  Math.min(amountCents, safeToSpare(extra.periods, extra.lowBalanceCents).zeroCents);

/** Every tracked item in the order the facts number them: debts, then savings. */
const numbered = (extra: ExtraMoneyFacts) => [...extra.debts, ...extra.savings];

export function extraMoneyText(amountCents: number, extra: ExtraMoneyFacts): string {
  const { safeCents, zeroCents, limiting } = safeToSpare(extra.periods, extra.lowBalanceCents);
  const usable = usableAmount(amountCents, extra);
  const number = new Map(numbered(extra).map((item, index) => [item.billIncomeId, index + 1]));
  const lines: string[] = [`EXTRA MONEY: ${money(amountCents)} to put somewhere now.`];
  const lowest = extra.periods[limiting];
  if (lowest) {
    lines.push(
      `- Paying it now lowers today's pay period and every later one by the same amount. The lowest is ` +
        `${formatDateRange(lowest.startDate, lowest.endDate)}, set to end with ${money(lowest.projectedCents)}.`,
      `- Safe to spare: ${money(safeCents)} keeps every pay period at or above the ${money(extra.lowBalanceCents)} warning amount; ` +
        `${money(zeroCents)} at most keeps them above zero.`,
    );
  }
  if (usable < amountCents) lines.push(`- The plans use ${money(usable)}, not ${money(amountCents)}: more would take a pay period below zero.`);
  else if (amountCents > safeCents) lines.push(`- This is more than the safe amount: a pay period would end below ${money(extra.lowBalanceCents)}.`);

  if (extra.debts.length > 0) {
    lines.push("DEBTS (tracked balances owed):");
    for (const debt of extra.debts) {
      const parts = [
        `owes ${money(debt.owedCents)}`,
        debt.aprBps === null ? "no APR given" : `APR ${formatApr(debt.aprBps)}`,
        debt.monthlyPaymentCents ? `usual payment about ${money(debt.monthlyPaymentCents)} a month` : "no scheduled payment",
      ];
      lines.push(`- [${number.get(debt.billIncomeId)}] ${debt.name}: ${parts.join("; ")}`);
    }
  } else {
    lines.push("DEBTS: none tracked.");
  }
  if (extra.savings.length > 0) {
    lines.push("SAVINGS (tracked balances held):");
    for (const saving of extra.savings) {
      lines.push(
        `- [${number.get(saving.billIncomeId)}] ${saving.name}: holds ${money(saving.heldCents)}${saving.aprBps === null ? "" : `; earns ${formatApr(saving.aprBps)}`}`,
      );
    }
  } else {
    lines.push("SAVINGS: none tracked.");
  }
  const held = extra.savings.reduce((sum, saving) => sum + saving.heldCents, 0);
  if (extra.monthlySpendCents > 0) {
    lines.push(
      `- Usual spending is about ${money(extra.monthlySpendCents)} a month; the savings cover about ` +
        `${(held / extra.monthlySpendCents).toFixed(1)} months of it.`,
    );
  }

  if (usable > 0 && (extra.debts.length > 0 || extra.savings.length > 0)) {
    lines.push(`PLANS FOR ${money(usable)}, worked out by the app:`);
    for (const strategy of PLAN_STRATEGIES) {
      const plan = makePlan(strategy, usable, extra.debts, extra.savings, extra.monthlySpendCents);
      const described = plan.lines.map((line) => `[${number.get(line.billIncomeId)}] ${line.name} ${money(line.amountCents)} (${lineReason(line)})`);
      if (plan.unplacedCents > 0) described.push(`${money(plan.unplacedCents)} not needed by any of them`);
      lines.push(`- ${STRATEGY_LABELS[strategy]}: ${described.length > 0 ? described.join("; ") : "nothing to put it in"}`);
    }
  }
  return lines.join("\n");
}

function lineReason(line: PlanLine): string {
  const payoff = line.payoff;
  if (!payoff || payoff.monthsBefore === payoff.monthsAfter) return line.reason;
  const saved = payoff.interestSavedCents ? `, about ${money(payoff.interestSavedCents)} less interest` : "";
  return `${line.reason}; paid off ${describeMonths(payoff.monthsAfter)} instead of ${describeMonths(payoff.monthsBefore).replace("in about ", "")}${saved}`;
}

/** What the model is told about the line that names payments: after every answer, or (in a conversation) after one that suggests payments. */
export function planLineRule(amountCents: number, extra: ExtraMoneyFacts, when: "always" | "when-suggesting" = "always"): string {
  return (
    (when === "always" ? "After the answer, end" : "When a message suggests payments with amounts, end it") +
    ' with one line on its own: "PLAN: " and the payments you suggest by their numbers in brackets, ' +
    `as "PLAN: [1] $250.00; [3] $100.00", adding up to no more than ${money(usableAmount(amountCents, extra))}. ` +
    "Use only the numbered items in the facts." +
    (when === "always" ? ' Write "PLAN: none" if you suggest none.' : "") +
    " This line does not count toward the word limit."
  );
}

/**
 * The payments the answer's PLAN line names, when they are all numbered items, positive,
 * and add up to no more than the usable amount; null otherwise. Also the answer without
 * that line, which is never shown.
 */
export function readPlanLine(answer: string, amountCents: number, extra: ExtraMoneyFacts): { text: string; plan: AdvicePlan | null } {
  const lines = answer.split("\n");
  const at = lines.findLastIndex((line) => /^\s*PLAN\s*:/i.test(line));
  // The item numbers are for the PLAN line; a model uses them in its prose too ("[1] Visa").
  const shown = (rest: string[]) => rest.join("\n").replace(/\s*\[\d+\]/g, "").trim();
  if (at === -1) return { text: shown(lines), plan: null };
  const text = shown(lines.filter((_, index) => index !== at));
  const items = numbered(extra);
  const amounts = new Map<string, number>();
  for (const match of lines[at]!.matchAll(/\[(\d+)\]\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/g)) {
    const item = items[Number(match[1]) - 1];
    const cents = parseMoneyInput(match[2]!.replaceAll(",", ""));
    if (!item || cents === null || cents <= 0) return { text, plan: null };
    amounts.set(item.billIncomeId, (amounts.get(item.billIncomeId) ?? 0) + cents);
  }
  const total = [...amounts.values()].reduce((sum, cents) => sum + cents, 0);
  if (amounts.size === 0 || total > usableAmount(amountCents, extra)) return { text, plan: null };
  return {
    text,
    plan: { items: items.filter((item) => amounts.has(item.billIncomeId)).map((item) => ({ billIncomeId: item.billIncomeId, name: item.name, amountCents: amounts.get(item.billIncomeId)! })) },
  };
}
