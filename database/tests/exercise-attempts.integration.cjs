/**
 * Prueba de integración de las migraciones 20261031_exercise_attempts_and_xp.sql y 20261101_import_completed_exercises.sql contra un PostgreSQL REAL
 * (embebido, temporal: no toca Supabase). Cubre lo que los tests de Jest no pueden: la función SQL, los índices
 * únicos y la concurrencia.
 *
 * Cómo ejecutarla (las dependencias se instalan fuera del proyecto, no se agregan a package.json):
 *   mkdir %TEMP%\pgtest && cd %TEMP%\pgtest && npm init -y && npm i embedded-postgres pg
 *   node <ruta>\backend\database\tests\exercise-attempts.integration.cjs
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

const PORT = 54329;
const MIGRATIONS = path.join(__dirname, '..', 'migrations');
const sql = (file) => fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');

const connect = async (database) => {
  const client = new Client({ host: 'localhost', port: PORT, user: 'postgres', password: 'pw', database });
  await client.connect();
  return client;
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-pg-'));
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
      CREATE TABLE public.students (id uuid primary key default gen_random_uuid());`);
    await db.query(sql('20261001_unity_telemetry_cognitive_dashboards.sql'));
    await db.query(sql('20261031_exercise_attempts_and_xp.sql'));
    await db.query(sql('20261031_exercise_attempts_and_xp.sql')); // idempotente
    await db.query(sql('20261101_import_completed_exercises.sql'));
    await db.query(sql('20261101_import_completed_exercises.sql')); // idempotente

    const one = async (q, p) => (await db.query(q, p)).rows[0];
    const user = (await one('INSERT INTO profiles DEFAULT VALUES RETURNING id')).id;
    const newStudent = async () => (await one('INSERT INTO students DEFAULT VALUES RETURNING id')).id;
    const call = async (client, student, exercise, attempt, coverage, accuracy) =>
      (await client.query('SELECT record_exercise_attempt($1,$2,$3,$4,$5) r', [user, student, exercise, attempt, JSON.stringify({ coverage, accuracy })])).rows[0].r;

    // Catálogo
    const counts = Object.fromEntries((await db.query(`SELECT route_id || ':' || is_active AS k, COUNT(*)::int n FROM exercise_catalog GROUP BY 1`)).rows.map((r) => [r.k, r.n]));
    assert.deepEqual(counts, { 'matematicas:true': 10, 'escritura:true': 10, 'escritura:false': 44 });

    // Reglas de aprobación y XP
    const s1 = await newStudent();
    let r = await call(db, s1, 'escritura.lo_a', crypto.randomUUID(), 0.9, 0.5);
    assert.deepEqual([r.passed, r.awarded, r.xpAwarded, r.totalXp], [false, false, 0, 0], 'un intento no aprobado no da XP');

    const retry = crypto.randomUUID();
    r = await call(db, s1, 'escritura.lo_a', retry, 0.9, 0.99);
    assert.deepEqual([r.passed, r.awarded, r.xpAwarded, r.totalXp, r.attemptNumber], [true, true, 10, 10, 2]);

    r = await call(db, s1, 'escritura.lo_a', retry, 0.9, 0.99);
    assert.deepEqual([r.duplicate, r.xpAwarded, r.totalXp], [true, 10, 10], 'el reenvío devuelve lo mismo y no suma');

    r = await call(db, s1, 'escritura.lo_a', crypto.randomUUID(), 0.95, 0.99);
    assert.deepEqual([r.alreadyCompleted, r.awarded, r.xpAwarded, r.totalXp], [true, false, 0, 10], 'un reintento aprobado no suma');

    r = await call(db, s1, 'matematicas.d_8', crypto.randomUUID(), 0.85, 0.97);
    assert.equal(r.passed, true, 'los umbrales exactos aprueban');
    r = await call(db, s1, 'matematicas.d_9', crypto.randomUUID(), 0.849, 0.99);
    assert.equal(r.passed, false, 'justo debajo del umbral no aprueba');

    for (const bad of ['escritura.up_B', 'inexistente.x_1']) {
      await assert.rejects(() => call(db, s1, bad, null, 0.9, 0.99), /EXERCISE_NOT_FOUND/);
    }

    // El mismo ejercicio en otro estudiante sí da XP (es por estudiante)
    const s2 = await newStudent();
    r = await call(db, s2, 'escritura.lo_a', crypto.randomUUID(), 0.9, 0.99);
    assert.equal(r.xpAwarded, 10);

    // Concurrencia: 20 conexiones, mismo ejercicio, intentos distintos aprobados a la vez
    const clients = await Promise.all(Array.from({ length: 20 }, () => connect('t')));
    const s3 = await newStudent();
    const parallel = await Promise.all(clients.map((c) => call(c, s3, 'escritura.up_E', crypto.randomUUID(), 0.95, 0.99)));
    assert.equal(parallel.filter((x) => x.awarded).length, 1, 'solo una petición recibe el XP');
    assert.equal(Math.max(...parallel.map((x) => x.totalXp)), 10);
    assert.equal(new Set(parallel.map((x) => x.attemptNumber)).size, 20, 'los números de intento no se repiten');

    // Concurrencia: la misma petición (mismo clientAttemptId) 20 veces a la vez
    const s4 = await newStudent();
    const same = crypto.randomUUID();
    await Promise.all(clients.map((c) => call(c, s4, 'matematicas.d_1', same, 0.95, 0.99)));
    assert.equal((await one('SELECT COUNT(*)::int n FROM trazos WHERE estudiante_id = $1', [s4])).n, 1, 'un solo intento guardado');
    assert.equal((await one('SELECT COALESCE(SUM(xp_amount),0)::int s FROM xp_ledger WHERE estudiante_id = $1', [s4])).s, 10, 'un solo XP');

    // Integridad: ningún aprobado sin su XP, ni XP sin aprobado
    assert.equal((await one('SELECT COUNT(*)::int n FROM exercise_completions c LEFT JOIN xp_ledger l ON l.completion_id = c.id WHERE l.id IS NULL')).n, 0);
    assert.equal((await one('SELECT COUNT(*)::int n FROM xp_ledger WHERE completion_id IS NULL')).n, 0);

    // Un adulto (sin estudiante) acumula en su propia cuenta
    r = await call(db, null, 'matematicas.d_0', crypto.randomUUID(), 0.9, 0.99);
    assert.deepEqual([r.xpAwarded, r.totalXp], [10, 10]);

    // Reglas configurables: cambiar el XP no obliga a tocar código
    await db.query(`UPDATE reward_rules SET xp_amount = 25 WHERE rule_key = 'exercise_approved'`);
    r = await call(db, s2, 'matematicas.d_3', crypto.randomUUID(), 0.9, 0.99);
    assert.equal(r.xpAwarded, 25);

    // ---- Importar lo que el dispositivo ya tenía completado ----
    const importIds = async (client, student, ids) =>
      (await client.query('SELECT import_completed_exercises($1,$2,$3) r', [user, student, ids])).rows[0].r;
    await db.query(`UPDATE reward_rules SET xp_amount = 10 WHERE rule_key = 'exercise_approved'`); // la prueba anterior la dejó en 25
    const s5 = await newStudent();
    await call(db, s5, 'matematicas.d_1', crypto.randomUUID(), 0.9, 0.99); // ya aprobado con un intento real (10 XP)
    r = await importIds(db, s5, ['matematicas.d_1', 'matematicas.d_2', 'escritura.lo_a', 'escritura.up_B', 'matematicas.d_2']);
    assert.deepEqual([r.imported, r.skipped, r.unknown, r.xpAwarded, r.totalXp], [2, 1, 1, 20, 30], 'importa lo nuevo, omite lo aprobado y lo desconocido');
    r = await importIds(db, s5, ['matematicas.d_1', 'matematicas.d_2', 'escritura.lo_a']);
    assert.deepEqual([r.imported, r.skipped, r.xpAwarded, r.totalXp], [0, 3, 0, 30], 'importar de nuevo no duplica nada');
    r = await call(db, s5, 'escritura.lo_a', crypto.randomUUID(), 0.95, 0.99);
    assert.deepEqual([r.passed, r.alreadyCompleted, r.xpAwarded, r.totalXp], [true, true, 0, 30], 'un intento real tras importar no da XP otra vez');
    const imported = await one(`SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE coverage_pct IS NULL AND accuracy_pct IS NULL AND precision_pct IS NULL)::int sin_metricas FROM trazos WHERE estudiante_id = $1 AND source = 'import'`, [s5]);
    assert.deepEqual([imported.n, imported.sin_metricas], [2, 2], 'lo importado se distingue y no inventa métricas');

    // Concurrencia: 20 importaciones simultáneas de los mismos ejercicios
    const s6 = await newStudent();
    const bulk = await Promise.all(clients.map((c) => importIds(c, s6, ['matematicas.d_4', 'matematicas.d_5', 'escritura.up_I'])));
    assert.equal(bulk.reduce((n, x) => n + x.imported, 0), 3, 'cada ejercicio se importa una sola vez');
    assert.equal((await one('SELECT COALESCE(SUM(xp_amount),0)::int s FROM xp_ledger WHERE estudiante_id = $1', [s6])).s, 30);

    // Importación y un intento real a la vez: un solo XP por ejercicio
    const s7 = await newStudent();
    const mixed = await Promise.all([
      importIds(clients[0], s7, ['matematicas.d_6']),
      call(clients[1], s7, 'matematicas.d_6', crypto.randomUUID(), 0.95, 0.99),
      importIds(clients[2], s7, ['matematicas.d_6']),
      call(clients[3], s7, 'matematicas.d_6', crypto.randomUUID(), 0.95, 0.99),
    ]);
    assert.equal((await one('SELECT COALESCE(SUM(xp_amount),0)::int s FROM xp_ledger WHERE estudiante_id = $1', [s7])).s, 10, 'un solo XP aunque se mezclen importación e intentos');
    assert.equal(mixed.length, 4);

    // La regla de importación se puede apagar sin tocar código: se importa, pero sin XP
    await db.query(`UPDATE reward_rules SET is_active = FALSE WHERE rule_key = 'exercise_imported'`);
    const s8 = await newStudent();
    r = await importIds(db, s8, ['matematicas.d_7']);
    assert.deepEqual([r.imported, r.xpAwarded, r.totalXp], [1, 0, 0], 'con la regla apagada se importa sin XP');

    // Integridad: todo aprobado sigue teniendo su registro de intento
    assert.equal((await one('SELECT COUNT(*)::int n FROM exercise_completions c LEFT JOIN trazos t ON t.id = c.attempt_id WHERE t.id IS NULL')).n, 0);

    for (const c of clients) await c.end();
    await db.end();
    console.log('OK: migraciones idempotentes, reglas, importación, idempotencia, concurrencia e integridad verificadas');
  } catch (error) {
    failed = true;
    console.error(error);
  } finally {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
})();
