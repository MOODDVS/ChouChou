/**
 * UN VALORE ESATTO DENTRO UN `ilike` (audit 3/11/2026).
 *
 * `ilike` serve qui per ignorare le maiuscole di un'email, non per cercare:
 * ma `%` e `_` restano jolly. Un'email «%» trovava qualunque cliente, e i
 * limiti dei coupon («una volta per cliente») si aggiravano cosi'. Con
 * l'escape il valore vale solo per se stesso.
 */
export function likeEsatto(v: string): string {
  return String(v ?? "").replace(/[\\%_]/g, (c) => "\\" + c);
}
