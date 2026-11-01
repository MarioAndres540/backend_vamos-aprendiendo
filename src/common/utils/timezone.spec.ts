import { zonedParts, zonedStartOfDay, zoneOffsetMs } from './timezone';

describe('timezone (America/Bogota y zonas con horario de verano)', () => {
  it('Bogotá está 5 horas detrás de UTC todo el año', () => {
    expect(zoneOffsetMs(new Date('2026-01-15T12:00:00Z'))).toBe(-5 * 3600_000);
    expect(zoneOffsetMs(new Date('2026-07-15T12:00:00Z'))).toBe(-5 * 3600_000);
  });

  it('el reloj de Bogotá a las 04:59:59Z del 1 de octubre sigue en el 30 de septiembre', () => {
    expect(zonedParts(new Date('2026-10-01T04:59:59Z'))).toEqual({
      year: 2026,
      month: 9,
      day: 30,
      hour: 23,
      minute: 59,
      second: 59,
    });
  });

  it('el 1 de octubre empieza en Bogotá a las 05:00Z', () => {
    expect(zonedStartOfDay(2026, 9, 1).toISOString()).toBe(
      '2026-10-01T05:00:00.000Z',
    );
  });

  it('admite el mes anterior de enero (diciembre del año anterior)', () => {
    expect(zonedStartOfDay(2027, -1, 1).toISOString()).toBe(
      '2026-12-01T05:00:00.000Z',
    );
  });

  it('admite el mes siguiente de diciembre (enero del año siguiente)', () => {
    expect(zonedStartOfDay(2026, 12, 1).toISOString()).toBe(
      '2027-01-01T05:00:00.000Z',
    );
  });

  it('con horario de verano usa el desfase de cada día (Nueva York, cambio el 8 de marzo de 2026)', () => {
    expect(zonedStartOfDay(2026, 2, 7, 'America/New_York').toISOString()).toBe(
      '2026-03-07T05:00:00.000Z',
    );
    expect(zonedStartOfDay(2026, 2, 9, 'America/New_York').toISOString()).toBe(
      '2026-03-09T04:00:00.000Z',
    );
  });
});
