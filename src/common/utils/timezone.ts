// Zona horaria del proyecto: los meses y los días de las estadísticas se cuentan en hora de Colombia
export const APP_TIME_ZONE = 'America/Bogota';

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string) => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

/** Año, mes (1-12), día, hora, minuto y segundo que marca el reloj de la zona en ese instante */
export const zonedParts = (date: Date, timeZone = APP_TIME_ZONE) => {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
};

/** Diferencia entre el reloj de la zona y UTC en ese instante (negativa al oeste de Greenwich) */
export const zoneOffsetMs = (date: Date, timeZone = APP_TIME_ZONE) => {
  const p = zonedParts(date, timeZone);
  const wallAsUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return wallAsUtc - Math.floor(date.getTime() / 1000) * 1000;
};

/**
 * Instante UTC en que empieza el día `day` del mes `monthIndex` (0-11, admite -1 y 12 para el mes anterior y el
 * siguiente) según el reloj de la zona. Se recalcula el desfase para ser correcto también en zonas con horario de verano.
 */
export const zonedStartOfDay = (
  year: number,
  monthIndex: number,
  day: number,
  timeZone = APP_TIME_ZONE,
) => {
  const wall = Date.UTC(year, monthIndex, day);
  const firstGuess = wall - zoneOffsetMs(new Date(wall), timeZone);
  return new Date(wall - zoneOffsetMs(new Date(firstGuess), timeZone));
};
