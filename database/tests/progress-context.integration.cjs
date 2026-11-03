/**
 * Spec 0001 — CTX-05: un mismo ejercicio se aprueba y entrega XP una vez por estudiante EN CADA contexto (hogar y
 * escolar). Prueba de integración de 20261102_progress_context.sql contra un PostgreSQL REAL (embebido, temporal: no
 * toca Supabase). Cubre las funciones SQL, las claves únicas por contexto y la concurrencia.
 *
 * Cómo ejecutarla (las dependencias se instalan fuera del proyecto, no se agregan a package.json):
 *   mkdir %TEMP%\pgtest && cd %TEMP%\pgtest && npm init -y && npm i embedded-postgres pg
 *   node <ruta>\backend\database\tests\progress-context.integration.cjs
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

// Los paquetes se buscan desde el directorio de trabajo
const req = createRequire(path.join(process.cwd(), 'noop.js'));
const EmbeddedPostgres = req('embedded-postgres').default ?? req('embedded-postgres');
const { Client } = req('pg');

const MIGRATIONS = path.join(__dirname, '..', 'migrations');
const sql = (file) => fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');

// Puerto libre en cada ejecución: un servidor que quedó abierto en una corrida anterior no la bloquea
const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = require('node:net').createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

let PORT;
const connect = async (database) => {
  const client = new Client({ host: 'localhost', port: PORT, user: 'postgres', password: 'pw', database });
  await client.connect();
  return client;
};

(async () => {
  PORT = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-pg-ctx-'));
  const server = new EmbeddedPostgres({ databaseDir: path.join(dir, 'data'), user: 'postgres', password: 'pw', port: PORT, persistent: false });
  await server.initialise();
  await server.start();
  let failed = false;
  try {
    const admin = await connect('postgres');
    // UTF8 como en Supabase (en Windows el clúster temporal nace en WIN1252)
    await admin.query(`CREATE DATABASE t ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
    await admin.end();
    const db = await connect('t');

    // Tablas mínimas de las que dependen las migraciones (en Supabase ya existen)
    await db.query(`CREATE ROLE service_role; CREATE ROLE anon;
      CREATE TABLE public.profiles (id uuid primary key default gen_random_uuid());
      CREATE TABLE public.students (id uuid primary key default gen_random_uuid());
      CREATE TABLE public.institutions (id uuid primary key default gen_random_uuid());`);
    await db.query(sql('20261001_unity_telemetry_cognitive_dashboards.sql'));
    await db.query(sql('20261008_app_sessions.sql'));
    await db.query(sql('20261031_exercise_attempts_and_xp.sql'));
    await db.query(sql('20261101_import_completed_exercises.sql'));
    await db.query(sql('20261102_progress_context.sql'));
    await db.query(sql('20261102_progress_context.sql')); // idempotente

    const one = async (q, p) => (await db.query(q, p)).rows[0];
    const tutor = (await one('INSERT INTO profiles DEFAULT VALUES RETURNING id')).id;
    const studentAccount = (await one('INSERT INTO profiles DEFAULT VALUES RETURNING id')).id;
    const school = (await one('INSERT INTO institutions DEFAULT VALUES RETURNING id')).id;
    const newStudent = async () => (await one('INSERT INTO students DEFAULT VALUES RETURNING id')).id;

    const home = (client, student, exercise, attempt, coverage = 0.9, accuracy = 0.99) =>
      client
        .query('SELECT record_exercise_attempt($1,$2,$3,$4,$5,$6,$7) r', [
          tutor, student, exercise, attempt, JSON.stringify({ coverage, accuracy }), 'hogar', null,
        ])
        .then((res) => res.rows[0].r);
    const atSchool = (client, student, exercise, attempt, coverage = 0.9, accuracy = 0.99) =>
      client
        .query('SELECT record_exercise_attempt($1,$2,$3,$4,$5,$6,$7) r', [
          studentAccount, student, exercise, attempt, JSON.stringify({ coverage, accuracy }), 'escolar', school,
        ])
        .then((res) => res.rows[0].r);

    // Las firmas anteriores ya no existen: una sola versión de cada función
    const signatures = (await db.query(
      `SELECT proname, pg_get_function_identity_arguments(oid) args FROM pg_proc
       WHERE proname IN ('record_exercise_attempt', 'import_completed_exercises') ORDER BY 1`,
    )).rows;
    assert.equal(signatures.length, 2, 'una sola versión de cada función');

    // CTX-05: aprobar en casa no aprueba en el colegio, y cada contexto entrega su propio XP
    const kid = await newStudent();
    let r = await home(db, kid, 'escritura.lo_a', crypto.randomUUID());
    assert.deepEqual([r.passed, r.awarded, r.xpAwarded, r.totalXp, r.attemptNumber], [true, true, 10, 10, 1], 'hogar: aprueba y da XP');

    r = await atSchool(db, kid, 'escritura.lo_a', crypto.randomUUID());
    assert.deepEqual(
      [r.passed, r.alreadyCompleted, r.awarded, r.xpAwarded, r.totalXp, r.attemptNumber],
      [true, false, true, 10, 10, 1],
      'colegio: el mismo ejercicio se aprueba de nuevo, con su propio XP y su propio conteo de intentos',
    );

    r = await atSchool(db, kid, 'escritura.lo_a', crypto.randomUUID());
    assert.deepEqual([r.alreadyCompleted, r.xpAwarded, r.totalXp, r.attemptNumber], [true, 0, 10, 2], 'dentro del colegio no se repite el XP');

    r = await home(db, kid, 'escritura.lo_a', crypto.randomUUID());
    assert.deepEqual([r.alreadyCompleted, r.xpAwarded, r.totalXp, r.attemptNumber], [true, 0, 10, 2], 'en casa tampoco');

    const byContext = (await db.query(
      `SELECT context, COUNT(*)::int completions,
              (SELECT COALESCE(SUM(xp_amount), 0)::int FROM xp_ledger l WHERE l.estudiante_id = $1 AND l.context = c.context) xp
       FROM exercise_completions c WHERE estudiante_id = $1 GROUP BY context ORDER BY context`,
      [kid],
    )).rows;
    assert.deepEqual(byContext, [
      { context: 'escolar', completions: 1, xp: 10 },
      { context: 'hogar', completions: 1, xp: 10 },
    ]);

    // Los registros escolares guardan el colegio; los del hogar no
    const schoolRows = await one(
      `SELECT COUNT(*) FILTER (WHERE context = 'escolar' AND institution_id = $2)::int escolar,
              COUNT(*) FILTER (WHERE context = 'hogar' AND institution_id IS NULL)::int hogar
       FROM trazos WHERE estudiante_id = $1`,
      [kid, school],
    );
    assert.deepEqual([schoolRows.escolar, schoolRows.hogar], [2, 2]);

    // Sin contexto (firma corta) sigue registrando en el hogar
    const legacy = await newStudent();
    r = (await db.query('SELECT record_exercise_attempt($1,$2,$3,$4,$5) r', [
      tutor, legacy, 'matematicas.d_1', crypto.randomUUID(), JSON.stringify({ coverage: 0.9, accuracy: 0.99 }),
    ])).rows[0].r;
    assert.equal(r.xpAwarded, 10);
    assert.equal((await one('SELECT context FROM exercise_completions WHERE estudiante_id = $1', [legacy])).context, 'hogar');

    // Un contexto inválido se rechaza
    await assert.rejects(
      () => db.query('SELECT record_exercise_attempt($1,$2,$3,$4,$5,$6,$7)', [
        tutor, kid, 'matematicas.d_2', crypto.randomUUID(), JSON.stringify({ coverage: 0.9, accuracy: 0.99 }), 'otro', null,
      ]),
      /INVALID_CONTEXT/,
    );

    // Importar: cada contexto importa por separado
    const importIds = (account, student, ids, context, institution) =>
      db.query('SELECT import_completed_exercises($1,$2,$3,$4,$5) r', [account, student, ids, context, institution])
        .then((res) => res.rows[0].r);
    const imported = await newStudent();
    r = await importIds(tutor, imported, ['matematicas.d_3', 'matematicas.d_4'], 'hogar', null);
    assert.deepEqual([r.imported, r.xpAwarded, r.totalXp], [2, 20, 20]);
    r = await importIds(studentAccount, imported, ['matematicas.d_3'], 'escolar', school);
    assert.deepEqual([r.imported, r.skipped, r.xpAwarded, r.totalXp], [1, 0, 10, 10], 'el colegio importa aparte del hogar');
    r = await importIds(studentAccount, imported, ['matematicas.d_3'], 'escolar', school);
    assert.deepEqual([r.imported, r.skipped, r.totalXp], [0, 1, 10], 'importar de nuevo no duplica');

    // Concurrencia: 20 intentos aprobados a la vez en cada contexto → exactamente un XP por contexto
    const clients = await Promise.all(Array.from({ length: 20 }, () => connect('t')));
    const busy = await newStudent();
    const results = await Promise.all(
      clients.flatMap((c) => [
        home(c, busy, 'escritura.up_E', crypto.randomUUID()),
        atSchool(c, busy, 'escritura.up_E', crypto.randomUUID()),
      ]),
    );
    assert.equal(results.filter((x) => x.awarded).length, 2, 'un XP en casa y uno en el colegio');
    assert.equal(
      (await one('SELECT COALESCE(SUM(xp_amount),0)::int s FROM xp_ledger WHERE estudiante_id = $1', [busy])).s,
      20,
    );

    // Integridad: ningún aprobado sin su XP, ni XP sin aprobado
    assert.equal((await one('SELECT COUNT(*)::int n FROM exercise_completions c LEFT JOIN xp_ledger l ON l.completion_id = c.id WHERE l.id IS NULL')).n, 0);
    assert.equal((await one('SELECT COUNT(*)::int n FROM xp_ledger WHERE completion_id IS NULL')).n, 0);

    await Promise.all(clients.map((c) => c.end()));
    await db.end();
    console.log('OK: CTX-05 — progreso, aprobados y XP separados por contexto (hogar / escolar)');
  } catch (err) {
    failed = true;
    console.error('FALLÓ:', err.message);
  } finally {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
})();
