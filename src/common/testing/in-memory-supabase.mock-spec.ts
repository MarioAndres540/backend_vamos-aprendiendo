/**
 * Cliente de Supabase en memoria para pruebas: aplica de verdad los filtros (eq, in, gte, lte, is, not is), así una prueba
 * comprueba qué filas devuelve cada consulta y no solo qué filtros se pidieron. Solo para pruebas (el build lo excluye).
 */
export type Row = Record<string, any>;

export interface InMemorySupabase {
  client: {
    from: (table: string) => any;
    rpc: (fn: string, params: Row) => Promise<{ data: unknown; error: unknown }>;
  };
  tables: Record<string, Row[]>;
  /** Filas insertadas por tabla */
  inserted: Record<string, Row[]>;
  /** Filas actualizadas (ya con los cambios) y borradas, por tabla */
  updated: Record<string, Row[]>;
  deleted: Record<string, Row[]>;
  /** Llamadas a funciones RPC */
  rpcCalls: { fn: string; params: Row }[];
}

export const createInMemorySupabase = (
  tables: Record<string, Row[]>,
  options: {
    failInsertsOn?: string[];
    /** Respuesta de cada función RPC; por defecto { data: null, error: null } */
    rpc?: Record<string, (params: Row) => { data: unknown; error: unknown }>;
  } = {},
): InMemorySupabase => {
  const inserted: Record<string, Row[]> = {};
  const updated: Record<string, Row[]> = {};
  const deleted: Record<string, Row[]> = {};
  const rpcCalls: { fn: string; params: Row }[] = [];

  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let limit: number | null = null;
    // update(...) o delete(): se aplica una sola vez, al resolver la consulta, sobre las filas filtradas
    let pending: { kind: 'update'; values: Row } | { kind: 'delete' } | null = null;
    let applied: Row[] | null = null;
    const matching = () =>
      (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
    const apply = () => {
      if (!pending || applied) return;
      const found = matching();
      if (pending.kind === 'update') {
        const values = pending.values;
        found.forEach((row) => Object.assign(row, values));
        updated[table] = [...(updated[table] ?? []), ...found];
      } else {
        tables[table] = (tables[table] ?? []).filter((row) => !found.includes(row));
        deleted[table] = [...(deleted[table] ?? []), ...found];
      }
      applied = found;
    };
    const rows = () => {
      apply();
      const found = applied ?? matching();
      return limit === null ? found : found.slice(0, limit);
    };

    const builder: any = {
      select: () => builder,
      order: () => builder,
      update: (values: Row) => {
        pending = { kind: 'update', values };
        return builder;
      },
      delete: () => {
        pending = { kind: 'delete' };
        return builder;
      },
      limit: (n: number) => {
        limit = n;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return builder;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      gte: (column: string, value: string) => {
        filters.push((row) => row[column] != null && row[column] >= value);
        return builder;
      },
      lte: (column: string, value: string) => {
        filters.push((row) => row[column] != null && row[column] <= value);
        return builder;
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => (row[column] ?? null) === value);
        return builder;
      },
      // not(columna, 'is', valor): excluye las filas cuyo valor coincide (p. ej. not('claimed_at', 'is', null))
      not: (column: string, operator: string, value: unknown) => {
        filters.push((row) =>
          operator === 'is' ? (row[column] ?? null) !== value : true,
        );
        return builder;
      },
      single: async () => {
        const [row] = rows();
        return row
          ? { data: row, error: null }
          : { data: null, error: { message: 'no rows' } };
      },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      insert: (value: Row | Row[]) => {
        const list = Array.isArray(value) ? value : [value];
        const error = options.failInsertsOn?.includes(table)
          ? { message: `insert en ${table} falló` }
          : null;
        if (!error) {
          inserted[table] = [...(inserted[table] ?? []), ...list];
          tables[table] = [...(tables[table] ?? []), ...list];
        }
        const result = { data: error ? null : list, error };
        return {
          select: () => ({ single: async () => ({ ...result, data: result.data?.[0] ?? null }) }),
          then: (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject),
        };
      },
      then: (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
    };
    return builder;
  };

  const rpc = (fn: string, params: Row) => {
    rpcCalls.push({ fn, params });
    return Promise.resolve(options.rpc?.[fn]?.(params) ?? { data: null, error: null });
  };

  return { client: { from, rpc }, tables, inserted, updated, deleted, rpcCalls };
};
