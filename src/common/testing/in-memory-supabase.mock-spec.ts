/**
 * Cliente de Supabase en memoria para pruebas: aplica de verdad los filtros (eq, in, gte, lte, is), así una prueba
 * comprueba qué filas devuelve cada consulta y no solo qué filtros se pidieron. Solo para pruebas (el build lo excluye).
 */
export type Row = Record<string, any>;

export interface InMemorySupabase {
  client: { from: (table: string) => any };
  tables: Record<string, Row[]>;
  /** Filas insertadas por tabla */
  inserted: Record<string, Row[]>;
}

export const createInMemorySupabase = (
  tables: Record<string, Row[]>,
  options: { failInsertsOn?: string[] } = {},
): InMemorySupabase => {
  const inserted: Record<string, Row[]> = {};

  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let limit: number | null = null;
    const rows = () => {
      const found = (tables[table] ?? []).filter((row) =>
        filters.every((f) => f(row)),
      );
      return limit === null ? found : found.slice(0, limit);
    };

    const builder: any = {
      select: () => builder,
      order: () => builder,
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

  return { client: { from }, tables, inserted };
};
