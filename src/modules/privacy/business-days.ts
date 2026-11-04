// Colombia no tiene horario de verano: la hora local es siempre UTC-5
const COLOMBIA_OFFSET_MS = -5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Suma días hábiles (lunes a viernes, según el día en Colombia) a una fecha, conservando la hora.
 * Los festivos no se descuentan (spec 0004, fuera de alcance): el plazo queda igual o más corto que el legal, nunca más largo.
 */
export const addBusinessDays = (start: Date, businessDays: number): Date => {
  let current = start.getTime();
  let added = 0;
  while (added < businessDays) {
    current += DAY_MS;
    const weekday = new Date(current + COLOMBIA_OFFSET_MS).getUTCDay();
    if (weekday !== 0 && weekday !== 6) added++;
  }
  return new Date(current);
};
