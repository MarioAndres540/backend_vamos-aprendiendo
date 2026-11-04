import { addBusinessDays } from './business-days';

// Spec 0004, PD-ARCO-03
describe('addBusinessDays', () => {
  it('desde un lunes, 10 días hábiles terminan el lunes de dos semanas después', () => {
    // Lunes 2 de noviembre de 2026, 10:00 en Colombia (15:00 UTC)
    const due = addBusinessDays(new Date('2026-11-02T15:00:00Z'), 10);
    expect(due.toISOString()).toBe('2026-11-16T15:00:00.000Z');
  });

  it('desde un viernes, 1 día hábil es el lunes siguiente', () => {
    const due = addBusinessDays(new Date('2026-11-06T15:00:00Z'), 1);
    expect(due.toISOString()).toBe('2026-11-09T15:00:00.000Z');
  });

  it('desde un sábado, 15 días hábiles son tres semanas hábiles completas', () => {
    const due = addBusinessDays(new Date('2026-11-07T15:00:00Z'), 15);
    expect(due.toISOString()).toBe('2026-11-27T15:00:00.000Z');
  });

  it('usa el día en Colombia: el viernes 21:00 local (sábado 02:00 UTC) sigue siendo viernes', () => {
    const due = addBusinessDays(new Date('2026-11-07T02:00:00Z'), 1);
    // Lunes 9 de noviembre a las 21:00 en Colombia
    expect(due.toISOString()).toBe('2026-11-10T02:00:00.000Z');
  });
});
