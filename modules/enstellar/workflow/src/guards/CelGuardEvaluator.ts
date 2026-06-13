/**
 * Lightweight CEL guard evaluator for Phase 1.
 * Supports only equality checks: "a.b.c == value"
 * where value is: true, false, a number, or a "quoted string".
 *
 * This module has NO imports and NO I/O — it is safe to import
 * from inside the @temporalio/workflow sandbox.
 */

export interface CelContext {
  [key: string]: unknown;
}

/**
 * Evaluates a CEL equality expression against a context object.
 * @throws Error if the expression is not a supported "lhs == rhs" form.
 */
export function evaluateGuard(expression: string, context: CelContext): boolean {
  const trimmed = expression.trim();
  const eqIdx = trimmed.indexOf(' == ');
  if (eqIdx === -1) {
    throw new Error(`Unsupported CEL expression: ${expression}`);
  }

  const lhs = trimmed.slice(0, eqIdx).trim();
  const rhs = trimmed.slice(eqIdx + 4).trim();

  const lhsValue = resolvePath(context, lhs.split('.'));
  const rhsValue = parseRhsLiteral(rhs);

  return lhsValue === rhsValue;
}

function resolvePath(obj: unknown, parts: string[]): unknown {
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function parseRhsLiteral(rhs: string): unknown {
  if (rhs === 'true') return true;
  if (rhs === 'false') return false;
  if (rhs === 'null') return null;

  // Quoted string: "value" or 'value'
  if (
    (rhs.startsWith('"') && rhs.endsWith('"')) ||
    (rhs.startsWith("'") && rhs.endsWith("'"))
  ) {
    return rhs.slice(1, -1);
  }

  // Number
  const num = Number(rhs);
  if (!isNaN(num)) return num;

  // Unquoted string fallback
  return rhs;
}
