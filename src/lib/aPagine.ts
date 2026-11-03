/**
 * TUTTE LE RIGHE, NON LE PRIME MILLE (audit 3/11/2026).
 *
 * PostgREST rende al massimo 1000 righe per lettura e TACE sul resto: un
 * buono con la milleunesima ricarica mostrava un saldo sbagliato, senza un
 * errore da nessuna parte. Qui si legge a pagine finche' ne arrivano.
 *
 * `pagina(da, a)` costruisce la stessa lettura con `.range(da, a)` — e
 * con un `.order(...)` stabile, se no due pagine possono sovrapporsi.
 */
export async function aPagine<T>(
  pagina: (da: number, a: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  passo = 1000,
): Promise<{ data: T[]; error: unknown }> {
  const tutte: T[] = [];
  for (let da = 0; ; da += passo) {
    const { data, error } = await pagina(da, da + passo - 1);
    if (error) return { data: tutte, error };
    tutte.push(...(data ?? []));
    if (!data || data.length < passo) return { data: tutte, error: null };
  }
}
