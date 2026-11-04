import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrivacyService } from './privacy.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import {
  createInMemorySupabase,
  InMemorySupabase,
  Row,
} from '../../common/testing/in-memory-supabase.mock-spec';
import {
  ConsentType,
  DataRequestStatus,
  DataRequestType,
  PRIVACY_POLICY_VERSION,
} from './privacy.constants';

// Spec 0004: Ley 1581 de 2012
describe('PrivacyService', () => {
  let db: InMemorySupabase;
  let auth: { admin: { updateUserById: jest.Mock } };
  let audit: { log: jest.Mock };
  let service: PrivacyService;

  const build = (
    tables: Record<string, Row[]>,
    options: Parameters<typeof createInMemorySupabase>[1] = {},
  ) => {
    db = createInMemorySupabase(tables, options);
    auth = {
      admin: {
        updateUserById: jest.fn().mockResolvedValue({ data: {}, error: null }),
      },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    const client = { ...db.client, auth };
    service = new PrivacyService(
      { getClient: () => client } as unknown as SupabaseService,
      audit as unknown as AuditService,
    );
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const consent = (type: ConsentType, granted: boolean, extra: Row = {}) => ({
    profile_id: 'tutor-1',
    consent_type: type,
    granted,
    policy_version: PRIVACY_POLICY_VERSION,
    student_id: null,
    ...extra,
  });

  describe('autorizaciones', () => {
    it('PD-CONS-05: el estado vigente es la última fila de cada tipo y de cada menor', async () => {
      build({
        privacy_consents: [
          consent(ConsentType.DATA_PROCESSING, true),
          consent(ConsentType.SENSITIVE_DATA, true),
          consent(ConsentType.MINORS_DATA, true, { student_id: 'kid-1' }),
          consent(ConsentType.SENSITIVE_DATA, false),
          consent(ConsentType.MINORS_DATA, true, { student_id: 'kid-2' }),
          // De otro titular: no cuenta
          { ...consent(ConsentType.SENSITIVE_DATA, true), profile_id: 'otro' },
        ],
      });

      const result = await service.getCurrentConsents('tutor-1');

      expect(result.dataProcessing?.granted).toBe(true);
      expect(result.sensitiveData?.granted).toBe(false);
      expect(result.minorsData.map((m) => m.studentId)).toEqual([
        'kid-1',
        'kid-2',
      ]);
      await expect(service.hasSensitiveDataConsent('tutor-1')).resolves.toBe(
        false,
      );
    });

    it('PD-SENS-01: sin ninguna fila de datos sensibles no hay autorización', async () => {
      build({ privacy_consents: [consent(ConsentType.DATA_PROCESSING, true)] });
      await expect(service.hasSensitiveDataConsent('tutor-1')).resolves.toBe(
        false,
      );
    });

    it('PD-SENS-03: revocar los datos sensibles agrega una fila y borra solo las evaluaciones del titular', async () => {
      build({
        privacy_consents: [consent(ConsentType.SENSITIVE_DATA, true)],
        initial_assessments: [
          { id: 'a1', evaluator_profile_id: 'tutor-1', student_id: 'kid-1' },
          { id: 'a2', evaluator_profile_id: 'tutor-1', student_id: null },
          { id: 'a3', evaluator_profile_id: 'tutor-2', student_id: 'kid-1' },
        ],
      });

      const result = await service.updateConsent(
        'tutor-1',
        { type: ConsentType.SENSITIVE_DATA, granted: false },
        { ip: '203.0.113.7' },
      );

      expect(result.sensitiveData?.granted).toBe(false);
      expect(result.deletedAssessments).toBe(2);
      // El ecosistema de otro tutor con el mismo menor no se toca (spec 0003, D-7)
      expect(db.tables.initial_assessments.map((a) => a.id as string)).toEqual([
        'a3',
      ]);
      expect(db.inserted.privacy_consents[0]).toMatchObject({
        consent_type: 'datos_sensibles',
        granted: false,
        ip_address: '203.0.113.7',
      });
    });

    it('otorgar los datos sensibles no borra nada', async () => {
      build({
        privacy_consents: [],
        initial_assessments: [{ id: 'a1', evaluator_profile_id: 'tutor-1' }],
      });

      await service.updateConsent('tutor-1', {
        type: ConsentType.SENSITIVE_DATA,
        granted: true,
      });

      expect(db.tables.initial_assessments).toHaveLength(1);
      await expect(service.hasSensitiveDataConsent('tutor-1')).resolves.toBe(
        true,
      );
    });

    it('las autorizaciones obligatorias no se revocan desde la cuenta (se radica una solicitud)', async () => {
      build({ privacy_consents: [] });

      await expect(
        service.updateConsent('tutor-1', {
          type: ConsentType.DATA_PROCESSING,
          granted: false,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.inserted.privacy_consents).toBeUndefined();
    });

    it('PD-POL-03: rechaza una versión de la política que no es la vigente', () => {
      build({});
      expect(() => service.assertCurrentPolicyVersion('2020-01-01')).toThrow(
        BadRequestException,
      );
      expect(() =>
        service.assertCurrentPolicyVersion(PRIVACY_POLICY_VERSION),
      ).not.toThrow();
    });
  });

  describe('solicitudes del titular', () => {
    // Lunes 2 de noviembre de 2026, 10:00 en Colombia
    const monday = new Date('2026-11-02T15:00:00Z');

    it('PD-ARCO-03: una consulta vence en 10 días hábiles', async () => {
      build({ data_requests: [] });

      const request = await service.createRequest(
        'tutor-1',
        { type: DataRequestType.QUERY, description: 'Qué datos tienen de mí' },
        monday,
      );

      expect(request).toMatchObject({
        profile_id: 'tutor-1',
        request_type: 'consulta',
        status: 'radicada',
        due_at: '2026-11-16T15:00:00.000Z',
      });
    });

    it('PD-ARCO-03: un reclamo (supresión) vence en 15 días hábiles', async () => {
      build({
        data_requests: [],
        tutor_students: [
          { id: 'l1', tutor_profile_id: 'tutor-1', student_id: 'kid-1' },
        ],
      });

      const request = await service.createRequest(
        'tutor-1',
        {
          type: DataRequestType.SUPPRESSION,
          studentId: 'kid-1',
          description: 'Borren los datos de mi hijo',
        },
        monday,
      );

      expect(request).toMatchObject({
        student_id: 'kid-1',
        due_at: '2026-11-23T15:00:00.000Z',
      });
    });

    it('PD-ARCO-02: un menor que no es del titular responde 404 y no radica nada', async () => {
      build({
        data_requests: [],
        tutor_students: [{ tutor_profile_id: 'tutor-2', student_id: 'kid-1' }],
      });

      await expect(
        service.createRequest('tutor-1', {
          type: DataRequestType.SUPPRESSION,
          studentId: 'kid-1',
          description: 'Borren los datos de este menor',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(db.inserted.data_requests).toBeUndefined();
    });

    it('PD-ARCO-05: una solicitud igual en trámite (índice único) responde 409', async () => {
      build({});
      const insert = jest.fn().mockReturnValue({
        select: () => ({
          single: () =>
            Promise.resolve({
              data: null,
              error: { code: '23505', message: 'duplicate key' },
            }),
        }),
      });
      service = new PrivacyService(
        {
          getClient: () => ({ from: () => ({ insert }) }),
        } as unknown as SupabaseService,
        audit as unknown as AuditService,
      );

      await expect(
        service.createRequest('tutor-1', {
          type: DataRequestType.QUERY,
          description: 'Otra consulta igual',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('gestión del super administrador', () => {
    const request = (extra: Row = {}): Row => ({
      id: 'req-1',
      profile_id: 'tutor-1',
      student_id: null,
      request_type: DataRequestType.SUPPRESSION,
      status: DataRequestStatus.FILED,
      due_at: '2026-11-23T15:00:00.000Z',
      ...extra,
    });

    it('PD-ADM-01: marca como vencidas solo las abiertas fuera de plazo', async () => {
      build({
        data_requests: [
          request({ id: 'r1', due_at: '2026-11-01T00:00:00Z' }),
          request({ id: 'r2', due_at: '2026-12-01T00:00:00Z' }),
          request({
            id: 'r3',
            due_at: '2026-11-01T00:00:00Z',
            status: DataRequestStatus.RESOLVED,
          }),
        ],
      });

      const list = await service.listRequests(
        undefined,
        new Date('2026-11-10T00:00:00Z'),
      );

      expect(list.map((r) => [r.id, r.overdue])).toEqual([
        ['r1', true],
        ['r2', false],
        ['r3', false],
      ]);
    });

    it('PD-ADM-02: resolver sin respuesta al titular responde 400', async () => {
      build({ data_requests: [request()] });

      await expect(
        service.updateRequest('admin-1', 'req-1', {
          status: DataRequestStatus.RESOLVED,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.tables.data_requests[0].status).toBe('radicada');
    });

    it('PD-ADM-02 y 04: resolver guarda quién y cuándo, y queda en la auditoría', async () => {
      build({
        data_requests: [request({ request_type: DataRequestType.QUERY })],
      });

      await service.updateRequest('admin-1', 'req-1', {
        status: DataRequestStatus.RESOLVED,
        response: 'Adjuntamos tus datos.',
      });

      expect(db.tables.data_requests[0]).toMatchObject({
        status: 'resuelta',
        response: 'Adjuntamos tus datos.',
        resolved_by: 'admin-1',
      });
      expect(audit.log).toHaveBeenCalledWith(
        'admin-1',
        'resolve',
        'data_request',
        'req-1',
        {
          status: 'resuelta',
        },
      );
    });

    it('PD-ADM-03: suprime la cuenta completa, cierra el acceso de Auth y resuelve la solicitud', async () => {
      build(
        { data_requests: [request()] },
        {
          rpc: {
            suppress_titular_data: () => ({
              data: {
                deletedStudents: ['kid-1'],
                unlinkedStudents: ['kid-2'],
                anonymized: true,
              },
              error: null,
            }),
          },
        },
      );

      const result = await service.executeSuppression('admin-1', 'req-1');

      expect(db.rpcCalls).toEqual([
        {
          fn: 'suppress_titular_data',
          params: { p_profile_id: 'tutor-1', p_student_id: null },
        },
      ]);
      expect(auth.admin.updateUserById).toHaveBeenCalledWith(
        'tutor-1',
        expect.objectContaining({
          email: 'suprimido-tutor-1@supresion.invalid',
          ban_duration: expect.any(String) as unknown,
          password: expect.any(String) as unknown,
        }),
      );
      expect(result.authClosed).toBe(true);
      expect(db.tables.data_requests[0]).toMatchObject({
        status: 'resuelta',
        resolved_by: 'admin-1',
      });
      expect(db.tables.data_requests[0].response).toMatch(
        /otro tutor o con su colegio/,
      );
      expect(audit.log).toHaveBeenCalledWith(
        'admin-1',
        'suppress',
        'data_request',
        'req-1',
        expect.objectContaining({
          anonymized: true,
          deletedStudents: 1,
          unlinkedStudents: 1,
        }),
      );
    });

    it('PD-ADM-03: la supresión de un solo menor no toca el usuario de Auth del titular', async () => {
      build(
        { data_requests: [request({ student_id: 'kid-1' })] },
        {
          rpc: {
            suppress_titular_data: () => ({
              data: {
                deletedStudents: [],
                unlinkedStudents: ['kid-1'],
                anonymized: false,
              },
              error: null,
            }),
          },
        },
      );

      await service.executeSuppression('admin-1', 'req-1');

      expect(db.rpcCalls[0].params).toEqual({
        p_profile_id: 'tutor-1',
        p_student_id: 'kid-1',
      });
      expect(auth.admin.updateUserById).not.toHaveBeenCalled();
    });

    it('PD-D5: una cuenta escolar o administrativa responde 409 y la solicitud sigue abierta', async () => {
      build(
        { data_requests: [request()] },
        {
          rpc: {
            suppress_titular_data: () => ({
              data: null,
              error: { message: 'TITULAR_NOT_SUPPORTED' },
            }),
          },
        },
      );

      await expect(
        service.executeSuppression('admin-1', 'req-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(db.tables.data_requests[0].status).toBe('radicada');
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('solo las solicitudes de supresión o revocatoria ejecutan una supresión', async () => {
      build({
        data_requests: [request({ request_type: DataRequestType.QUERY })],
      });

      await expect(
        service.executeSuppression('admin-1', 'req-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.rpcCalls).toHaveLength(0);
    });

    it('una solicitud ya cerrada no se vuelve a ejecutar', async () => {
      build({
        data_requests: [request({ status: DataRequestStatus.RESOLVED })],
      });

      await expect(
        service.executeSuppression('admin-1', 'req-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(db.rpcCalls).toHaveLength(0);
    });
  });

  describe('PD-ARCO-01: exportar mis datos', () => {
    it('incluye solo el progreso registrado con la cuenta del titular (su ecosistema)', async () => {
      build({
        profiles: [
          { id: 'tutor-1', email: 'papa@ejemplo.com', first_name: 'Papá' },
        ],
        tutor_students: [
          {
            tutor_profile_id: 'tutor-1',
            student_id: 'kid-1',
            relationship: 'hijo',
          },
        ],
        students: [{ id: 'kid-1', first_name: 'Sara' }],
        privacy_consents: [consent(ConsentType.DATA_PROCESSING, true)],
        data_requests: [],
        initial_assessments: [],
        exercise_completions: [
          { usuario_id: 'tutor-1', estudiante_id: 'kid-1', exercise_id: 'e1' },
          // Mismo menor en el espacio de la mamá: no se entrega al papá
          { usuario_id: 'tutor-2', estudiante_id: 'kid-1', exercise_id: 'e2' },
        ],
        xp_ledger: [
          { usuario_id: 'tutor-1', xp_amount: 10 },
          { usuario_id: 'tutor-2', xp_amount: 50 },
        ],
      });

      const data = await service.exportMyData('tutor-1');

      expect(data.profile).toMatchObject({ email: 'papa@ejemplo.com' });
      expect(data.minors).toEqual([
        expect.objectContaining({ id: 'kid-1', relationship: 'hijo' }),
      ]);
      expect(data.progress.completedExercises).toEqual([
        expect.objectContaining({ exercise_id: 'e1' }),
      ]);
      expect(data.progress.totalXp).toBe(10);
    });
  });
});
