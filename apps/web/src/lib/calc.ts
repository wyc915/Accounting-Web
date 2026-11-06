/** Safe arithmetic evaluator for the keypad: digits, ".", + − × ÷ with precedence. */
export const OPS = ['+', '−', '×', '÷'] as const;

export function evaluate(expr: string): number | null {
  const tokens = expr.match(/\d+(?:\.\d*)?|\.\d+|[+−×÷]/g);
  if (!tokens) return null;
  // drop dangling operator
  if (OPS.includes(tokens[tokens.length - 1] as never)) tokens.pop();
  if (!tokens.length) return null;

  const out: number[] = [];
  const ops: string[] = [];
  const prec = (o: string) => (o === '×' || o === '÷' ? 2 : 1);
  const apply = () => {
    const b = out.pop()!;
    const a = out.pop()!;
    const o = ops.pop()!;
    out.push(o === '+' ? a + b : o === '−' ? a - b : o === '×' ? a * b : b === 0 ? NaN : a / b);
  };
  for (const t of tokens) {
    if (OPS.includes(t as never)) {
      while (ops.length && prec(ops[ops.length - 1]) >= prec(t)) apply();
      ops.push(t);
    } else out.push(parseFloat(t));
  }
  while (ops.length) apply();
  const v = out[0];
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

export const hasOperator = (expr: string) => /[+−×÷]/.test(expr.replace(/^−/, ''));
