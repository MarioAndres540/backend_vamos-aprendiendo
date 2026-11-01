import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { RecordExerciseDto } from './record-exercise.dto';

// Misma configuración que main.ts: whitelist + forbidNonWhitelisted + transform
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: RecordExerciseDto,
};

const valid = {
  exerciseId: 'escritura.lo_a',
  clientAttemptId: '22222222-2222-4222-8222-222222222222',
  coverage: 0.9,
  accuracy: 0.99,
};

const messagesFor = async (body: unknown): Promise<string[]> => {
  try {
    await pipe.transform(body, metadata);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    const response = (error as BadRequestException).getResponse() as {
      message: string[];
    };
    return response.message;
  }
};

describe('RecordExerciseDto (POST /telemetry/exercises)', () => {
  it('acepta un intento mínimo: ejercicio, id de intento, cobertura y exactitud', async () => {
    expect(await messagesFor(valid)).toEqual([]);
  });

  it('acepta las métricas geométricas opcionales cuando Unity las envíe', async () => {
    const stroke = {
      points: [
        { x: 0.1, y: 0.2, t: 0 },
        { x: 0.3, y: 0.4, t: 0.2 },
      ],
    };
    expect(
      await messagesFor({
        ...valid,
        durationSeconds: 8.4,
        precisionPct: 88.5,
        startPointOk: true,
        orderOk: false,
        direction: 'arriba_abajo',
        rotationDegrees: 0,
        offPathCount: 2,
        expectedPath: [stroke],
        userStrokes: [stroke],
        deviations: {
          alerta: 'Empezó fuera del punto 1',
          patronAtipico: false,
        },
      }),
    ).toEqual([]);
  });

  it.each([
    ['sin cobertura', { coverage: undefined }],
    ['cobertura mayor a 1 (por ejemplo, 90 en vez de 0.9)', { coverage: 90 }],
    ['exactitud negativa', { accuracy: -0.1 }],
    ['clientAttemptId que no es UUID', { clientAttemptId: 'abc' }],
    [
      'sin clientAttemptId (no habría protección contra duplicados)',
      { clientAttemptId: undefined },
    ],
    ['ejercicio con formato inválido', { exerciseId: 'a; drop table trazos' }],
    ['ejercicio sin ruta', { exerciseId: 'lo_a' }],
    ['studentId que no es UUID', { studentId: 'no-es-uuid' }],
    ['dirección fuera del enum', { direction: 'diagonal' }],
    ['precisión mayor a 100', { precisionPct: 120 }],
    ['duración excesiva', { durationSeconds: 99999 }],
  ])('rechaza %s', async (_name, override) => {
    expect(
      (await messagesFor({ ...valid, ...override })).length,
    ).toBeGreaterThan(0);
  });

  it('rechaza un campo que el cliente no debe enviar, como passed o xp', async () => {
    expect((await messagesFor({ ...valid, passed: true })).join(' ')).toMatch(
      /passed/,
    );
    expect((await messagesFor({ ...valid, xp: 1000 })).join(' ')).toMatch(/xp/);
  });

  it('rechaza un trazo con demasiados puntos y puntos fuera del cuadrado de la letra', async () => {
    const tooMany = {
      points: Array.from({ length: 401 }, () => ({ x: 0.5, y: 0.5 })),
    };
    expect(
      (await messagesFor({ ...valid, userStrokes: [tooMany] })).join(' '),
    ).toMatch(/400 puntos/);
    expect(
      (
        await messagesFor({
          ...valid,
          userStrokes: [{ points: [{ x: 9, y: 0.5 }] }],
        })
      ).length,
    ).toBeGreaterThan(0);
  });
});
