/**
 * Política de envio: quem usa o componente decide, por verificação, o que acontece numa falha.
 *
 * - `warn` (padrão): mostra o problema e orienta, mas deixa enviar. A validação que vale
 *   é a do servidor; no navegador a pessoa pode sempre contornar qualquer bloqueio.
 * - `block`: uma falha impede o envio até ser corrigida.
 * - `off`: a verificação não aparece nem conta.
 *
 * "Atenção" (warn) nunca bloqueia: só falhas podem bloquear.
 * O mesmo código roda no servidor, para repetir a decisão sobre a foto recebida.
 */
import type { Check, CheckId, CheckResult } from './check';

export type Enforcement = 'warn' | 'block' | 'off';
export type Policy = Partial<Record<CheckId, Enforcement>>;

/** Recomendação inicial: tudo orienta, nada bloqueia. */
export const DEFAULT_POLICY: Readonly<Record<CheckId, Enforcement>> = {
  framing: 'warn',
  resolution: 'warn',
  sharpness: 'warn',
  exposure: 'warn',
  glare: 'warn',
  orientation: 'warn',
};

export interface Verdict {
  /** Pode enviar: nenhuma falha numa verificação marcada como `block`. */
  canSubmit: boolean;
  /** Falhas que bloqueiam o envio. */
  blocking: Check[];
  /** Falhas que só avisam (recomendado corrigir). */
  problems: Check[];
  /** Pontos de atenção. */
  warnings: Check[];
  /** Verificações exibidas (sem as desligadas), com a regra de cada uma. */
  visible: Array<Check & { enforcement: Enforcement }>;
}

export function enforcementOf(id: CheckId, policy: Policy = {}): Enforcement {
  return policy[id] ?? DEFAULT_POLICY[id];
}

export function applyPolicy(result: CheckResult, policy: Policy = {}): Verdict {
  const visible = result.checks.map((c) => ({ ...c, enforcement: enforcementOf(c.id, policy) })).filter((c) => c.enforcement !== 'off');
  const blocking = visible.filter((c) => c.status === 'fail' && c.enforcement === 'block');
  return {
    canSubmit: blocking.length === 0,
    blocking,
    problems: visible.filter((c) => c.status === 'fail' && c.enforcement !== 'block'),
    warnings: visible.filter((c) => c.status === 'warn'),
    visible,
  };
}
