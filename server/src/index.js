import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool, audit } from './db.js';
import { authenticate, allow, signToken } from './auth.js';
import { generateSchedule, recoverSchedule, validateSchedule, DAY_NAMES } from './ai.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet());

const origins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim());

app.use(cors({
  origin(origin, cb) {
    if (!origin || origins.includes(origin)) return cb(null, true);
    return cb(new Error('Origin not allowed'));
  },
  credentials: true
}));

app.use(express.json({ limit: '256kb' }));
app.use('/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
}));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      database: 'connected',
      service: 'CampusSync API'
    });
  } catch {
    res.status(503).json({
      status: 'error',
      database: 'unavailable'
    });
  }
});

app.post('/auth/login', async (req, res, next) => {
  try {
    const input = z.object({
      identifier: z.string().trim().min(1).max(200),
      password: z.string().min(1).max(200),
      role: z.enum(['student', 'teacher', 'admin'])
    }).safeParse(req.body);

    if (!input.success) {
      return res.status(400).json({ error: 'Invalid login request' });
    }

    const { identifier, password, role } = input.data;

    const q = await pool.query(
      `SELECT id,email,full_name,role,password_hash,active,must_change_password
       FROM app_users
       WHERE lower(email)=lower($1) OR (id=$1 AND role=$2)`,
      [identifier, role]
    );

    const user = q.rows.find(u => u.role === role);

    if (
      !user ||
      !user.active ||
      !(await bcrypt.compare(password, user.password_hash))
    ) {
      return res.status(401).json({
        error: 'Incorrect ID/email or password for this role'
      });
    }

    const token = signToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.full_name,
        role: user.role,
        mustChangePassword: Boolean(user.must_change_password)
      }
    });
  } catch (e) {
    next(e);
  }
});

app.get('/auth/me', authenticate, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.full_name,
      role: req.user.role,
      mustChangePassword: Boolean(req.user.must_change_password)
    }
  });
});

app.post('/auth/change-password', authenticate, async (req, res, next) => {
  const p = z.object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(12).max(200)
  }).safeParse(req.body);

  if (!p.success) {
    return res.status(400).json({
      error: 'New password must contain at least 12 characters.'
    });
  }

  try {
    const found = await pool.query(
      'SELECT password_hash FROM app_users WHERE id=$1',
      [req.user.id]
    );

    if (
      !found.rowCount ||
      !(await bcrypt.compare(
        p.data.currentPassword,
        found.rows[0].password_hash
      ))
    ) {
      return res.status(400).json({
        error: 'Current password is incorrect.'
      });
    }

    if (
      await bcrypt.compare(
        p.data.newPassword,
        found.rows[0].password_hash
      )
    ) {
      return res.status(400).json({
        error: 'Choose a password you have not used before.'
      });
    }

    const hash = await bcrypt.hash(p.data.newPassword, 12);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      await client.query(
        'UPDATE app_users SET password_hash=$2,must_change_password=FALSE WHERE id=$1',
        [req.user.id, hash]
      );

      await audit(
        client,
        req.user.id,
        'auth.password_changed',
        'user',
        req.user.id,
        { forced: Boolean(req.user.must_change_password) }
      );

      await client.query('COMMIT');

      res.json({
        ok: true,
        message: 'Password updated. You can continue to your dashboard.'
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    next(e);
  }
});

app.post('/auth/logout', authenticate, (_req, res) => {
  res.status(204).end();
});


// Administrator-managed student roster.
const newStudentSchema = z.object({
  id: z.string().trim().regex(/^[A-Za-z0-9_-]{2,80}$/),
  name: z.string().trim().min(2).max(200),
  email: z.string().trim().email().max(200),
  section: z.string().trim().min(1).max(20),
  classGroup: z.string().trim().min(1).max(200)
    .default('B.Tech CSE, Year 2'),
  password: z.string().min(8).max(200)
});

const updateStudentSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  email: z.string().trim().email().max(200).optional(),
  section: z.string().trim().min(1).max(20).optional(),
  classGroup: z.string().trim().min(1).max(200).optional(),
  active: z.boolean().optional()
}).refine(
  d => Object.keys(d).length > 0,
  { message: 'Provide at least one field to update' }
);

app.get('/admin/students', authenticate, allow('admin'), async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';

    const result = await pool.query(
      `SELECT u.id,u.full_name AS name,u.email,
              s.section,s.class_group AS "classGroup",
              u.active,u.created_at AS "createdAt"
       FROM students s
       JOIN app_users u ON u.id=s.id
       WHERE ($1::boolean OR u.active=TRUE)
       ORDER BY u.active DESC,u.full_name ASC`,
      [includeInactive]
    );

    res.json({ students: result.rows });
  } catch (e) {
    next(e);
  }
});

app.post('/admin/students', authenticate, allow('admin'), async (req, res, next) => {
  const parsed = newStudentSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid student details',
      details: parsed.error.issues.map(i => ({
        path: i.path,
        message: i.message
      }))
    });
  }

  const d = {
    ...parsed.data,
    id: parsed.data.id.trim(),
    email: parsed.data.email.trim().toLowerCase(),
    section: parsed.data.section.trim().toUpperCase()
  };

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const duplicate = await client.query(
      'SELECT id FROM app_users WHERE id=$1 OR lower(email)=lower($2) FOR UPDATE',
      [d.id, d.email]
    );

    if (duplicate.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'A user with this student ID or email already exists'
      });
    }

    const passwordHash = await bcrypt.hash(d.password, 12);

    await client.query(
      `INSERT INTO app_users
       (id,email,full_name,role,password_hash,active)
       VALUES($1,$2,$3,'student',$4,TRUE)`,
      [d.id, d.email, d.name, passwordHash]
    );

    await client.query(
      'INSERT INTO students(id,section,class_group) VALUES($1,$2,$3)',
      [d.id, d.section, d.classGroup]
    );

    await audit(
      client,
      req.user.id,
      'student.created',
      'student',
      d.id,
      { section: d.section, classGroup: d.classGroup }
    );

    await client.query('COMMIT');

    res.status(201).json({
      student: {
        id: d.id,
        name: d.name,
        email: d.email,
        section: d.section,
        classGroup: d.classGroup,
        active: true
      }
    });
  } catch (e) {
    await client.query('ROLLBACK');

    if (e.code === '23505') {
      return res.status(409).json({
        error: 'Student ID or email is already in use'
      });
    }

    next(e);
  } finally {
    client.release();
  }
});

app.patch('/admin/students/:id', authenticate, allow('admin'), async (req, res, next) => {
  const parsed = updateStudentSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid student update',
      details: parsed.error.issues.map(i => ({
        path: i.path,
        message: i.message
      }))
    });
  }

  const d = parsed.data;

  if (d.email !== undefined) d.email = d.email.trim().toLowerCase();
  if (d.section !== undefined) d.section = d.section.trim().toUpperCase();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const found = await client.query(
      `SELECT u.id,u.active
       FROM app_users u
       JOIN students s ON s.id=u.id
       WHERE u.id=$1
       FOR UPDATE OF u`,
      [req.params.id]
    );

    if (!found.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Student not found' });
    }

    if (d.email) {
      const emailUsed = await client.query(
        'SELECT id FROM app_users WHERE lower(email)=lower($1) AND id<>$2',
        [d.email, req.params.id]
      );

      if (emailUsed.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'That email address is already in use'
        });
      }
    }

    await client.query(
      `UPDATE app_users
       SET full_name=COALESCE($2,full_name),
           email=COALESCE($3,email),
           active=COALESCE($4,active)
       WHERE id=$1`,
      [
        req.params.id,
        d.name || null,
        d.email || null,
        d.active === undefined ? null : d.active
      ]
    );

    await client.query(
      `UPDATE students
       SET section=COALESCE($2,section),
           class_group=COALESCE($3,class_group)
       WHERE id=$1`,
      [req.params.id, d.section || null, d.classGroup || null]
    );

    await audit(
      client,
      req.user.id,
      d.active === false
        ? 'student.disabled'
        : d.active === true
          ? 'student.reactivated'
          : 'student.updated',
      'student',
      req.params.id,
      { fields: Object.keys(d) }
    );

    const result = await client.query(
      `SELECT u.id,u.full_name AS name,u.email,
              s.section,s.class_group AS "classGroup",
              u.active,u.created_at AS "createdAt"
       FROM app_users u
       JOIN students s ON s.id=u.id
       WHERE u.id=$1`,
      [req.params.id]
    );

    await client.query('COMMIT');
    res.json({ student: result.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK');

    if (e.code === '23505') {
      return res.status(409).json({
        error: 'That email address is already in use'
      });
    }

    next(e);
  } finally {
    client.release();
  }
});

app.delete('/admin/students/:id', authenticate, allow('admin'), async (req, res, next) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE app_users u
       SET active=FALSE
       FROM students s
       WHERE u.id=s.id AND u.id=$1 AND u.active=TRUE
       RETURNING u.id,u.full_name AS name`,
      [req.params.id]
    );

    if (!result.rowCount) {
      const exists = await client.query(
        'SELECT 1 FROM students WHERE id=$1',
        [req.params.id]
      );

      await client.query('ROLLBACK');

      return res.status(exists.rowCount ? 409 : 404).json({
        error: exists.rowCount
          ? 'Student account is already disabled'
          : 'Student not found'
      });
    }

    await audit(
      client,
      req.user.id,
      'student.disabled',
      'student',
      req.params.id,
      { preserveRelatedRecords: true }
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      id: result.rows[0].id,
      active: false,
      message: 'Student login disabled; related records were preserved.'
    });
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});


const recordSchema = z.object({
  id: z.string().min(1).max(180),
  studentId: z.string().min(1).max(80),
  studentName: z.string().min(1).max(200),
  classId: z.string().min(1).max(80),
  className: z.string().min(1).max(200),
  classGroup: z.string().min(1).max(200),
  section: z.string().min(1).max(20),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timestamp: z.string().datetime(),
  markedBy: z.string().min(1).max(200),
  attendance: z.enum(['Present', 'Absent']),
  source: z.enum(['manual', 'face']),
  matchScore: z.number().min(0).max(1).optional(),
  status: z.enum(['Pending Sync', 'Synced', 'Sync Failed']),
  sessionId: z.string().min(1).max(180)
});

const sessionSchema = z.object({
  id: z.string().min(1).max(180),
  classGroup: z.string().min(1).max(200),
  section: z.string().min(1).max(20),
  subjectId: z.string().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['scheduled', 'finalized', 'cancelled']),
  syncStatus: z.enum(['Pending Sync', 'Synced', 'Sync Failed']),
  createdAt: z.string().datetime(),
  finalizedAt: z.string().datetime().optional(),
  finalizedBy: z.string().max(200).optional(),
  cancelledAt: z.string().datetime().optional()
});

async function teacherCanTeach(userId, role, subjectId) {
  if (role === 'admin') return true;
  if (role !== 'teacher') return false;

  const r = await pool.query(
    'SELECT 1 FROM teacher_subjects WHERE teacher_id=$1 AND subject_id=$2',
    [userId, subjectId]
  );

  return r.rowCount > 0;
}

app.post('/attendance', authenticate, allow('teacher', 'admin'), async (req, res, next) => {
  const parsed = recordSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid attendance record',
      details: parsed.error.issues.map(i => ({
        path: i.path,
        message: i.message
      }))
    });
  }

  const r = parsed.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (!(await teacherCanTeach(req.user.id, req.user.role, r.classId))) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'You are not assigned to this subject'
      });
    }

    if (req.user.role === 'teacher') {
      const slot = await client.query(
        `SELECT 1 FROM timetable_entries
         WHERE active=TRUE AND teacher_id=$1 AND subject_id=$2
           AND section=$3 AND class_group=$4
         LIMIT 1`,
        [req.user.id, r.classId, r.section, r.classGroup]
      );

      if (!slot.rowCount) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'No active timetable slot assigns this subject to your selected class and section.'
        });
      }
    }

    const student = await client.query(
      `SELECT s.section,u.full_name
       FROM students s
       JOIN app_users u ON u.id=s.id
       WHERE s.id=$1`,
      [r.studentId]
    );

    if (!student.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Unknown student' });
    }

    if (student.rows[0].section !== r.section) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'Student section does not match attendance record'
      });
    }

    const session = await client.query(
      `SELECT status,section,subject_id,session_date
       FROM attendance_sessions
       WHERE id=$1
       FOR UPDATE`,
      [r.sessionId]
    );

    if (!session.rowCount) {
      const createdSession = await client.query(
        `INSERT INTO attendance_sessions
         (id,class_group,section,subject_id,session_date,status,sync_status,created_at,payload)
         VALUES($1,$2,$3,$4,$5,'scheduled','Pending Sync',$6,'{}'::jsonb)
         ON CONFLICT DO NOTHING RETURNING id`,
        [r.sessionId, r.classGroup, r.section, r.classId, r.date, r.timestamp]
      );

      if (!createdSession.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'A session already exists for this section, subject and date'
        });
      }
    } else {
      const stored = session.rows[0];

      if (
        stored.section !== r.section ||
        stored.subject_id !== r.classId ||
        new Date(stored.session_date).toISOString().slice(0, 10) !== r.date
      ) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Attendance record does not match its session'
        });
      }

      if (stored.status !== 'scheduled') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Attendance session is locked'
        });
      }
    }

    const inserted = await client.query(
      `INSERT INTO attendance_records
       (id,student_id,student_name,subject_id,subject_name,class_group,section,
        attendance_date,recorded_at,marked_by,attendance,source,match_score,
        sync_status,session_id,payload)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
       ON CONFLICT DO NOTHING RETURNING id`,
      [
        r.id,
        r.studentId,
        student.rows[0].full_name,
        r.classId,
        r.className,
        r.classGroup,
        r.section,
        r.date,
        r.timestamp,
        req.user.full_name,
        r.attendance,
        r.source,
        r.matchScore ?? null,
        'Synced',
        r.sessionId,
        JSON.stringify(r)
      ]
    );

    if (!inserted.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Duplicate attendance record',
        duplicate: true
      });
    }

    await audit(
      client,
      req.user.id,
      'attendance.created',
      'attendance',
      r.id,
      { studentId: r.studentId, subjectId: r.classId, source: r.source }
    );

    await client.query('COMMIT');
    res.status(201).json({ ok: true, id: r.id, sessionId: r.sessionId });
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});

app.post('/sessions', authenticate, allow('teacher', 'admin'), async (req, res, next) => {
  const parsed = sessionSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid session',
      details: parsed.error.issues.map(i => ({
        path: i.path,
        message: i.message
      }))
    });
  }

  const s = parsed.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (!(await teacherCanTeach(req.user.id, req.user.role, s.subjectId))) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'You are not assigned to this subject'
      });
    }

    if (req.user.role === 'teacher') {
      const slot = await client.query(
        `SELECT 1 FROM timetable_entries
         WHERE active=TRUE AND teacher_id=$1 AND subject_id=$2
           AND section=$3 AND class_group=$4
         LIMIT 1`,
        [req.user.id, s.subjectId, s.section, s.classGroup]
      );

      if (!slot.rowCount) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'No active timetable slot assigns this subject to your selected class and section.'
        });
      }
    }

    const result = await client.query(
      `INSERT INTO attendance_sessions
       (id,class_group,section,subject_id,session_date,status,sync_status,
        created_at,finalized_at,finalized_by,cancelled_at,payload)
       VALUES($1,$2,$3,$4,$5,$6,'Synced',$7,$8,$9,$10,$11::jsonb)
       ON CONFLICT(id) DO UPDATE
       SET status=EXCLUDED.status,
           sync_status='Synced',
           finalized_at=EXCLUDED.finalized_at,
           finalized_by=EXCLUDED.finalized_by,
           cancelled_at=EXCLUDED.cancelled_at,
           payload=EXCLUDED.payload
       WHERE attendance_sessions.status='scheduled'
       RETURNING id`,
      [
        s.id,
        s.classGroup,
        s.section,
        s.subjectId,
        s.date,
        s.status,
        s.createdAt,
        s.finalizedAt || null,
        req.user.full_name,
        s.cancelledAt || null,
        JSON.stringify(s)
      ]
    );

    if (!result.rowCount) {
      const existing = await client.query(
        `SELECT id FROM attendance_sessions
         WHERE id=$1 OR (section=$2 AND subject_id=$3 AND session_date=$4)`,
        [s.id, s.section, s.subjectId, s.date]
      );

      await client.query('COMMIT');

      return res.status(409).json({
        error: 'Session already exists or is locked',
        duplicate: true,
        id: existing.rows[0]?.id
      });
    }

    await audit(
      client,
      req.user.id,
      'attendance_session.synced',
      'attendance_session',
      s.id,
      { status: s.status, subjectId: s.subjectId }
    );

    await client.query('COMMIT');
    res.status(201).json({ ok: true, id: s.id });
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});

app.get('/attendance/me', authenticate, async (req, res, next) => {
  try {
    if (req.user.role === 'student') {
      const r = await pool.query(
        `SELECT id,student_id AS "studentId",student_name AS "studentName",
                subject_id AS "classId",subject_name AS "className",
                section,attendance_date::text AS date,attendance,source,
                sync_status AS status,session_id AS "sessionId"
         FROM attendance_records
         WHERE student_id=$1
         ORDER BY attendance_date DESC`,
        [req.user.id]
      );

      return res.json({ records: r.rows });
    }

    if (req.user.role === 'teacher') {
      const r = await pool.query(
        `SELECT ar.*
         FROM attendance_records ar
         JOIN teacher_subjects ts ON ts.subject_id=ar.subject_id
         WHERE ts.teacher_id=$1
         ORDER BY attendance_date DESC
         LIMIT 500`,
        [req.user.id]
      );

      return res.json({ records: r.rows });
    }

    const r = await pool.query(
      'SELECT * FROM attendance_records ORDER BY attendance_date DESC LIMIT 1000'
    );

    res.json({ records: r.rows });
  } catch (e) {
    next(e);
  }
});

app.get('/students', authenticate, allow('teacher', 'admin'), async (req, res, next) => {
  try {
    const q = z.object({
      section: z.string().optional(),
      search: z.string().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0)
    }).safeParse(req.query);

    if (!q.success) return res.status(400).json({ error: 'Invalid query' });

    const { section, search, limit, offset } = q.data;

    const result = await pool.query(
      `SELECT s.id,u.full_name AS name,u.email,s.section,
              s.class_group AS "classGroup"
       FROM students s
       JOIN app_users u ON u.id=s.id
       WHERE u.active=TRUE
         AND ($1::text IS NULL OR s.section=$1)
         AND ($2::text IS NULL OR u.full_name ILIKE '%'||$2||'%' OR s.id ILIKE '%'||$2||'%')
         AND ($5::text IS NULL OR EXISTS (
           SELECT 1 FROM timetable_entries t
           WHERE t.active=TRUE AND t.teacher_id=$5
             AND t.section=s.section AND t.class_group=s.class_group
         ))
       ORDER BY u.full_name
       LIMIT $3 OFFSET $4`,
      [
        section || null,
        search || null,
        limit,
        offset,
        req.user.role === 'teacher' ? req.user.id : null
      ]
    );

    res.json({ students: result.rows, limit, offset });
  } catch (e) {
    next(e);
  }
});

app.get('/subjects', authenticate, async (req, res, next) => {
  try {
    const result = req.user.role === 'teacher'
      ? await pool.query(
          `SELECT s.id,s.name
           FROM subjects s
           JOIN teacher_subjects ts ON ts.subject_id=s.id
           WHERE ts.teacher_id=$1
           ORDER BY s.name`,
          [req.user.id]
        )
      : await pool.query('SELECT id,name FROM subjects ORDER BY name');

    res.json({ subjects: result.rows });
  } catch (e) {
    next(e);
  }
});

app.get('/reports/attendance', authenticate, allow('teacher', 'admin'), async (req, res, next) => {
  try {
    const q = z.object({
      subjectId: z.string().optional(),
      section: z.string().optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    }).safeParse(req.query);

    if (!q.success) return res.status(400).json({ error: 'Invalid report filters' });

    if (
      req.user.role === 'teacher' &&
      q.data.subjectId &&
      !(await teacherCanTeach(req.user.id, 'teacher', q.data.subjectId))
    ) {
      return res.status(403).json({ error: 'Not assigned to subject' });
    }

    const d = q.data;

    const r = await pool.query(
      `SELECT subject_id AS "subjectId",section,
              COUNT(*) FILTER(WHERE attendance='Present')::int AS present,
              COUNT(*) FILTER(WHERE attendance='Absent')::int AS absent,
              COUNT(*)::int AS recorded
       FROM attendance_records
       WHERE ($1::text IS NULL OR subject_id=$1)
         AND ($2::text IS NULL OR section=$2)
         AND ($3::date IS NULL OR attendance_date >= $3)
         AND ($4::date IS NULL OR attendance_date <= $4)
       GROUP BY subject_id,section
       ORDER BY subject_id,section`,
      [d.subjectId || null, d.section || null, d.from || null, d.to || null]
    );

    res.json({ report: r.rows });
  } catch (e) {
    next(e);
  }
});


// Admin user directory.
app.get('/admin/users', authenticate, allow('admin'), async (req, res, next) => {
  try {
    const p = z.object({
      role: z.enum(['student', 'teacher', 'admin']).optional(),
      search: z.string().max(100).optional(),
      status: z.enum(['active', 'disabled']).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(10),
      offset: z.coerce.number().int().min(0).default(0)
    }).safeParse(req.query);

    if (!p.success) return res.status(400).json({ error: 'Invalid filters' });

    const d = p.data;

    const where = `WHERE ($1::text IS NULL OR role=$1)
      AND ($2::text IS NULL OR full_name ILIKE '%'||$2||'%'
        OR email ILIKE '%'||$2||'%' OR id ILIKE '%'||$2||'%')
      AND ($3::text IS NULL OR active=($3='active'))`;

    const [r, c] = await Promise.all([
      pool.query(
        `SELECT id,email,full_name AS "name",role,active,
                must_change_password AS "mustChangePassword",
                created_at AS "createdAt"
         FROM app_users ${where}
         ORDER BY role,full_name
         LIMIT $4 OFFSET $5`,
        [d.role || null, d.search || null, d.status || null, d.limit, d.offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total FROM app_users ${where}`,
        [d.role || null, d.search || null, d.status || null]
      )
    ]);

    res.json({
      users: r.rows,
      limit: d.limit,
      offset: d.offset,
      total: c.rows[0].total
    });
  } catch (e) {
    next(e);
  }
});

app.post('/admin/users', authenticate, allow('admin'), async (req, res, next) => {
  const p = z.object({
    id: z.string().trim().regex(/^[A-Za-z0-9_-]{2,80}$/),
    email: z.string().trim().email().max(200),
    name: z.string().trim().min(2).max(160),
    role: z.enum(['student', 'teacher', 'admin']),
    password: z.string().min(12).max(200),
    section: z.string().trim().max(20).optional(),
    classGroup: z.string().trim().max(200).optional()
  }).safeParse(req.body);

  if (!p.success) {
    return res.status(400).json({
      error: 'Invalid user details. Check the fields and use a password of at least 12 characters.'
    });
  }

  const d = {
    ...p.data,
    id: p.data.id.trim(),
    email: p.data.email.trim().toLowerCase(),
    name: p.data.name.trim()
  };

  if (d.role === 'student' && (!d.section || !d.classGroup)) {
    return res.status(400).json({
      error: 'Section and class/group are required for student accounts'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const hash = await bcrypt.hash(d.password, 12);

    await client.query(
      `INSERT INTO app_users
       (id,email,full_name,role,password_hash,must_change_password)
       VALUES($1,$2,$3,$4,$5,FALSE)`,
      [d.id, d.email, d.name, d.role, hash]
    );

    if (d.role === 'student') {
      await client.query(
        'INSERT INTO students(id,section,class_group) VALUES($1,$2,$3)',
        [d.id, d.section.toUpperCase(), d.classGroup]
      );
    }

    if (d.role === 'teacher') {
      await client.query('INSERT INTO teachers(id) VALUES($1)', [d.id]);
    }

    await audit(client, req.user.id, 'user.created', 'user', d.id, {
      role: d.role
    });

    await client.query('COMMIT');
    res.status(201).json({ ok: true, id: d.id, role: d.role });
  } catch (e) {
    await client.query('ROLLBACK');

    if (e.code === '23505') {
      return res.status(409).json({ error: 'User ID or email already exists' });
    }

    next(e);
  } finally {
    client.release();
  }
});

app.patch('/admin/users/:id', authenticate, allow('admin'), async (req, res, next) => {
  const p = z.object({
    active: z.boolean().optional(),
    name: z.string().trim().min(2).max(160).optional(),
    email: z.string().trim().email().max(200).optional()
  }).strict().refine(d => Object.keys(d).length > 0).safeParse(req.body);

  if (!p.success) return res.status(400).json({ error: 'Invalid user update' });

  if (req.params.id === req.user.id && p.data.active === false) {
    return res.status(400).json({
      error: 'You cannot deactivate your own account'
    });
  }

  try {
    const d = { ...p.data };
    if (d.email) d.email = d.email.toLowerCase();

    if (d.active === false) {
      const target = await pool.query(
        'SELECT role,active FROM app_users WHERE id=$1',
        [req.params.id]
      );

      if (!target.rowCount) return res.status(404).json({ error: 'User not found' });

      if (target.rows[0].role === 'admin' && target.rows[0].active) {
        const count = await pool.query(
          "SELECT COUNT(*)::int AS count FROM app_users WHERE role='admin' AND active=TRUE"
        );

        if (count.rows[0].count <= 1) {
          return res.status(400).json({
            error: 'The last active admin account cannot be disabled'
          });
        }
      }
    }

    const r = await pool.query(
      `UPDATE app_users
       SET active=COALESCE($2,active),
           full_name=COALESCE($3,full_name),
           email=COALESCE($4,email)
       WHERE id=$1
       RETURNING id,email,full_name AS name,role,active`,
      [req.params.id, d.active ?? null, d.name ?? null, d.email ?? null]
    );

    if (!r.rowCount) return res.status(404).json({ error: 'User not found' });

    await audit(pool, req.user.id, 'user.updated', 'user', req.params.id, {
      active: d.active,
      updatedFields: Object.keys(d)
    });

    res.json({ user: r.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    next(e);
  }
});

app.post('/admin/subjects', authenticate, allow('admin'), async (req, res, next) => {
  const p = z.object({
    id: z.string().min(1).max(80),
    name: z.string().min(2).max(160),
    teacherId: z.string().min(1).max(80).optional()
  }).safeParse(req.body);

  if (!p.success) return res.status(400).json({ error: 'Invalid subject' });

  const d = p.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      'INSERT INTO subjects(id,name,teacher_id) VALUES($1,$2,$3)',
      [d.id, d.name, d.teacherId || null]
    );

    if (d.teacherId) {
      await client.query(
        'INSERT INTO teacher_subjects(teacher_id,subject_id) VALUES($1,$2)',
        [d.teacherId, d.id]
      );
    }

    await audit(client, req.user.id, 'subject.created', 'subject', d.id, {});
    await client.query('COMMIT');

    res.status(201).json({ ok: true, id: d.id });
  } catch (e) {
    await client.query('ROLLBACK');

    if (e.code === '23505') {
      return res.status(409).json({ error: 'Subject ID already exists' });
    }

    next(e);
  } finally {
    client.release();
  }
});


// Student-facing timetable, fees, feedback and notification APIs.
app.get('/timetable', authenticate, async (req, res, next) => {
  try {
    const sectionResult = req.user.role === 'student'
      ? await pool.query(
          'SELECT section,class_group FROM students WHERE id=$1',
          [req.user.id]
        )
      : null;

    const section = req.query.section || sectionResult?.rows[0]?.section;

    if (
      req.user.role === 'student' &&
      req.query.section &&
      req.query.section !== sectionResult?.rows[0]?.section
    ) {
      return res.status(403).json({
        error: 'Cannot view another section timetable'
      });
    }

    if (!section && !['admin', 'teacher'].includes(req.user.role)) {
      return res.status(400).json({ error: 'section is required' });
    }

    const result = await pool.query(
      `SELECT t.id,t.class_group AS "classGroup",t.section,
              t.subject_id AS "subjectId",s.name AS "subjectName",
              t.teacher_id AS "teacherId",u.full_name AS "teacherName",
              t.weekday,t.starts_at AS "startsAt",t.ends_at AS "endsAt",t.room
       FROM timetable_entries t
       JOIN subjects s ON s.id=t.subject_id
       JOIN app_users u ON u.id=t.teacher_id
       WHERE t.active=TRUE
         AND ($1::text IS NULL OR t.section=$1)
         AND ($2::text IS NULL OR t.teacher_id=$2)
       ORDER BY t.weekday,t.starts_at`,
      [section || null, req.user.role === 'teacher' ? req.user.id : null]
    );

    res.json({ timetable: result.rows });
  } catch (e) {
    next(e);
  }
});


// Admin timetable editor.
app.post('/admin/timetable', authenticate, allow('admin'), async (req, res, next) => {
  const p = z.object({
    id: z.string().trim().min(1).max(80),
    classGroup: z.string().trim().min(1).max(200),
    section: z.string().trim().min(1).max(20),
    subjectId: z.string().trim().min(1).max(80),
    subjectName: z.string().trim().min(2).max(160).optional(),
    teacherId: z.string().trim().min(1).max(80),
    weekday: z.number().int().min(0).max(6),
    startsAt: z.string().regex(/^\d{2}:\d{2}$/),
    endsAt: z.string().regex(/^\d{2}:\d{2}$/),
    room: z.string().max(100).default('')
  }).safeParse(req.body);

  if (!p.success) {
    return res.status(400).json({
      error: 'Invalid timetable details. Check the teacher, subject, class and time fields.'
    });
  }

  const d = { ...p.data, section: p.data.section.toUpperCase() };

  if (d.startsAt >= d.endsAt) {
    return res.status(400).json({ error: 'End time must be later than start time.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const teacher = await client.query(
      `SELECT u.id FROM app_users u
       JOIN teachers t ON t.id=u.id
       WHERE u.id=$1 AND u.role='teacher' AND u.active=TRUE
       FOR UPDATE OF u`,
      [d.teacherId]
    );

    if (!teacher.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Select an active teacher account first.'
      });
    }

    if (d.subjectName) {
      await client.query(
        'INSERT INTO subjects(id,name) VALUES($1,$2)',
        [d.subjectId, d.subjectName]
      );
    } else {
      const subject = await client.query(
        'SELECT id FROM subjects WHERE id=$1',
        [d.subjectId]
      );

      if (!subject.rowCount) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Subject not found. Create it first or choose an existing subject.'
        });
      }
    }

    const overlap = await client.query(
      `SELECT id FROM timetable_entries
       WHERE active=TRUE AND weekday=$1 AND id<>$2
         AND starts_at < $4::time AND ends_at > $3::time
         AND (
           teacher_id=$5
           OR (class_group=$6 AND section=$7)
           OR ($8::text<>'' AND LOWER(room)=LOWER($8))
         )
       LIMIT 1`,
      [
        d.weekday, d.id, d.startsAt, d.endsAt,
        d.teacherId, d.classGroup, d.section, d.room
      ]
    );

    if (overlap.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'This time overlaps another class for the same teacher or class section.'
      });
    }

    await client.query(
      `INSERT INTO teacher_subjects(teacher_id,subject_id)
       VALUES($1,$2) ON CONFLICT DO NOTHING`,
      [d.teacherId, d.subjectId]
    );

    const saved = await client.query(
      `INSERT INTO timetable_entries
       (id,class_group,section,subject_id,teacher_id,weekday,starts_at,ends_at,room)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(id) DO UPDATE
       SET class_group=EXCLUDED.class_group,
           section=EXCLUDED.section,
           subject_id=EXCLUDED.subject_id,
           teacher_id=EXCLUDED.teacher_id,
           weekday=EXCLUDED.weekday,
           starts_at=EXCLUDED.starts_at,
           ends_at=EXCLUDED.ends_at,
           room=EXCLUDED.room,
           active=TRUE
       RETURNING id`,
      [
        d.id, d.classGroup, d.section, d.subjectId, d.teacherId,
        d.weekday, d.startsAt, d.endsAt, d.room
      ]
    );

    await audit(
      client,
      req.user.id,
      'timetable.upserted',
      'timetable',
      d.id,
      {
        teacherId: d.teacherId,
        subjectId: d.subjectId,
        section: d.section,
        weekday: d.weekday
      }
    );

    await client.query('COMMIT');
    res.status(201).json({ ok: true, id: saved.rows[0].id });
  } catch (e) {
    await client.query('ROLLBACK');

    if (e.code === '23505') {
      return res.status(409).json({
        error: 'A conflicting timetable or subject ID already exists.'
      });
    }

    next(e);
  } finally {
    client.release();
  }
});

app.delete('/admin/timetable/:id', authenticate, allow('admin'), async (req, res, next) => {
  try {
    const r = await pool.query(
      'UPDATE timetable_entries SET active=FALSE WHERE id=$1 AND active=TRUE RETURNING id',
      [req.params.id]
    );

    if (!r.rowCount) {
      return res.status(404).json({ error: 'Timetable entry not found.' });
    }

    await pool.query(
      `DELETE FROM teacher_subjects ts
       USING timetable_entries gone
       WHERE gone.id=$1
         AND ts.teacher_id=gone.teacher_id
         AND ts.subject_id=gone.subject_id
         AND NOT EXISTS (
           SELECT 1 FROM timetable_entries active
           WHERE active.active=TRUE
             AND active.teacher_id=ts.teacher_id
             AND active.subject_id=ts.subject_id
         )`,
      [req.params.id]
    );

    await audit(pool, req.user.id, 'timetable.disabled', 'timetable', req.params.id, {});
    res.json({ ok: true, id: req.params.id });
  } catch (e) {
    next(e);
  }
});

app.post('/timetable', authenticate, allow('admin'), async (req, res, next) => {
  const p = z.object({
    id: z.string().min(1).max(80),
    classGroup: z.string().min(1).max(200),
    section: z.string().min(1).max(20),
    subjectId: z.string().min(1).max(80),
    teacherId: z.string().min(1).max(80),
    weekday: z.number().int().min(0).max(6),
    startsAt: z.string().regex(/^\d{2}:\d{2}$/),
    endsAt: z.string().regex(/^\d{2}:\d{2}$/),
    room: z.string().max(100).default('')
  }).safeParse(req.body);

  if (!p.success) return res.status(400).json({ error: 'Invalid timetable entry' });

  const d = p.data;

  try {
    const overlap = await pool.query(
      `SELECT id FROM timetable_entries
       WHERE active=TRUE AND weekday=$1 AND id<>$2
         AND starts_at < $4::time AND ends_at > $3::time
         AND (
           teacher_id=$5
           OR (class_group=$6 AND section=$7)
           OR ($8::text<>'' AND LOWER(room)=LOWER($8))
         )
       LIMIT 1`,
      [
        d.weekday, d.id, d.startsAt, d.endsAt,
        d.teacherId, d.classGroup, d.section, d.room
      ]
    );

    if (overlap.rowCount) {
      return res.status(409).json({
        error: 'This time overlaps another class for the same teacher, class section, or room.'
      });
    }

    const r = await pool.query(
      `INSERT INTO timetable_entries
       (id,class_group,section,subject_id,teacher_id,weekday,starts_at,ends_at,room)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(id) DO UPDATE
       SET class_group=EXCLUDED.class_group,
           section=EXCLUDED.section,
           subject_id=EXCLUDED.subject_id,
           teacher_id=EXCLUDED.teacher_id,
           weekday=EXCLUDED.weekday,
           starts_at=EXCLUDED.starts_at,
           ends_at=EXCLUDED.ends_at,
           room=EXCLUDED.room,
           active=TRUE
       RETURNING id`,
      [
        d.id, d.classGroup, d.section, d.subjectId, d.teacherId,
        d.weekday, d.startsAt, d.endsAt, d.room
      ]
    );

    await audit(pool, req.user.id, 'timetable.upserted', 'timetable', d.id, {});
    res.status(201).json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    next(e);
  }
});

app.get('/fees/me', authenticate, async (req, res, next) => {
  try {
    if (req.user.role === 'student') {
      const r = await pool.query(
        `SELECT id,amount_paise AS "amountPaise",status,
                payment_reference AS "paymentReference",
                created_at AS "createdAt"
         FROM fee_records
         WHERE student_id=$1
         ORDER BY created_at DESC`,
        [req.user.id]
      );

      return res.json({ fees: r.rows });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const r = await pool.query(
      `SELECT id,student_id AS "studentId",amount_paise AS "amountPaise",
              status,payment_reference AS "paymentReference",
              created_at AS "createdAt"
       FROM fee_records
       ORDER BY created_at DESC
       LIMIT 1000`
    );

    res.json({ fees: r.rows });
  } catch (e) {
    next(e);
  }
});

app.post('/fees', authenticate, allow('admin'), async (req, res, next) => {
  const p = z.object({
    id: z.string().min(1).max(80),
    studentId: z.string().min(1).max(80),
    amountPaise: z.number().int().min(0).max(100000000000),
    status: z.enum(['due', 'recorded', 'paid', 'waived']),
    paymentReference: z.string().max(180).optional()
  }).safeParse(req.body);

  if (!p.success) return res.status(400).json({ error: 'Invalid fee record' });

  const d = p.data;

  try {
    await pool.query(
      `INSERT INTO fee_records
       (id,student_id,amount_paise,status,payment_reference)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(id) DO UPDATE
       SET amount_paise=EXCLUDED.amount_paise,
           status=EXCLUDED.status,
           payment_reference=EXCLUDED.payment_reference`,
      [d.id, d.studentId, d.amountPaise, d.status, d.paymentReference || null]
    );

    await audit(pool, req.user.id, 'fee.upserted', 'fee', d.id, {
      status: d.status
    });

    res.status(201).json({
      ok: true,
      id: d.id,
      note: 'This records fee status only; it does not process a payment.'
    });
  } catch (e) {
    next(e);
  }
});

app.post('/feedback', authenticate, allow('student'), async (req, res, next) => {
  const p = z.object({
    teacherId: z.string().min(1).max(80).optional(),
    subjectId: z.string().min(1).max(80).optional(),
    rating: z.number().int().min(1).max(5),
    comments: z.string().max(2000).default('')
  }).safeParse(req.body);

  if (!p.success) return res.status(400).json({ error: 'Invalid feedback' });

  const d = p.data;

  try {
    const r = await pool.query(
      `INSERT INTO feedback(student_id,teacher_id,subject_id,rating,comments)
       VALUES($1,$2,$3,$4,$5)
       RETURNING id,created_at AS "createdAt"`,
      [req.user.id, d.teacherId || null, d.subjectId || null, d.rating, d.comments]
    );

    res.status(201).json({ feedback: r.rows[0] });
  } catch (e) {
    next(e);
  }
});

app.get('/feedback/analytics', authenticate, allow('teacher', 'admin'), async (req, res, next) => {
  try {
    if (
      req.user.role === 'teacher' &&
      req.query.teacherId &&
      req.query.teacherId !== req.user.id
    ) {
      return res.status(403).json({
        error: 'Cannot view another teacher feedback'
      });
    }

    const teacherId = req.user.role === 'teacher'
      ? req.user.id
      : (req.query.teacherId || null);

    const r = await pool.query(
      `SELECT teacher_id AS "teacherId",subject_id AS "subjectId",
              COUNT(*)::int AS responses,
              ROUND(AVG(rating)::numeric,2) AS "averageRating"
       FROM feedback
       WHERE ($1::text IS NULL OR teacher_id=$1)
       GROUP BY teacher_id,subject_id
       ORDER BY teacher_id,subject_id`,
      [teacherId]
    );

    res.json({ analytics: r.rows });
  } catch (e) {
    next(e);
  }
});

app.get('/notifications', authenticate, async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT id,title,message,read_at AS "readAt",created_at AS "createdAt"
       FROM user_notifications
       WHERE user_id=$1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.user.id]
    );

    res.json({ notifications: r.rows });
  } catch (e) {
    next(e);
  }
});

app.post('/notifications', authenticate, allow('admin'), async (req, res, next) => {
  const p = z.object({
    userId: z.string().min(1).max(80),
    title: z.string().min(1).max(160),
    message: z.string().min(1).max(2000)
  }).safeParse(req.body);

  if (!p.success) return res.status(400).json({ error: 'Invalid notification' });

  try {
    const r = await pool.query(
      'INSERT INTO user_notifications(user_id,title,message) VALUES($1,$2,$3) RETURNING id',
      [p.data.userId, p.data.title, p.data.message]
    );

    res.status(201).json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    next(e);
  }
});

app.patch('/notifications/:id/read', authenticate, async (req, res, next) => {
  try {
    const r = await pool.query(
      'UPDATE user_notifications SET read_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING id',
      [req.params.id, req.user.id]
    );

    if (!r.rowCount) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});


// Consent ledger stores metadata only; biometric templates remain on the user's device.
app.post('/face-enrollment/consent', authenticate, allow('student'), async (req, res, next) => {
  const p = z.object({
    consent: z.boolean(),
    modelVersion: z.string().min(1).max(80),
    deviceReference: z.string().max(120).optional()
  }).safeParse(req.body);

  if (!p.success) return res.status(400).json({ error: 'Invalid consent request' });

  try {
    if (!p.data.consent) {
      await pool.query(
        'UPDATE face_enrollment_consents SET revoked_at=NOW() WHERE student_id=$1 AND revoked_at IS NULL',
        [req.user.id]
      );

      return res.json({ ok: true, consent: false });
    }

    await pool.query(
      `INSERT INTO face_enrollment_consents
       (student_id,consented_at,revoked_at,model_version,device_reference)
       VALUES($1,NOW(),NULL,$2,$3)
       ON CONFLICT(student_id) DO UPDATE
       SET consented_at=NOW(),revoked_at=NULL,
           model_version=EXCLUDED.model_version,
           device_reference=EXCLUDED.device_reference`,
      [req.user.id, p.data.modelVersion, p.data.deviceReference || null]
    );

    res.status(201).json({ ok: true, consent: true });
  } catch (e) {
    next(e);
  }
});

app.get('/face-enrollment/status', authenticate, async (req, res, next) => {
  try {
    if (req.user.role === 'student') {
      const r = await pool.query(
        `SELECT consented_at AS "consentedAt",
                revoked_at AS "revokedAt",
                model_version AS "modelVersion"
         FROM face_enrollment_consents
         WHERE student_id=$1`,
        [req.user.id]
      );

      return res.json({ enrollment: r.rows[0] || null });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const r = await pool.query(
      `SELECT student_id AS "studentId",
              consented_at AS "consentedAt",
              revoked_at AS "revokedAt",
              model_version AS "modelVersion"
       FROM face_enrollment_consents
       ORDER BY consented_at DESC`
    );

    res.json({ enrollments: r.rows });
  } catch (e) {
    next(e);
  }
});


// CampusSync Smart Risk Radar.
app.get('/reports/risk-radar', authenticate, allow('teacher', 'admin'), async (req, res, next) => {
  try {
    const subjectId = typeof req.query.subjectId === 'string'
      ? req.query.subjectId
      : null;

    if (
      req.user.role === 'teacher' &&
      subjectId &&
      !(await teacherCanTeach(req.user.id, 'teacher', subjectId))
    ) {
      return res.status(403).json({ error: 'Not assigned to subject' });
    }

    const r = await pool.query(
      `SELECT ar.student_id AS "studentId",
              MAX(ar.student_name) AS "studentName",
              ar.section,
              ar.subject_id AS "subjectId",
              COUNT(*)::int AS total,
              COUNT(*) FILTER(WHERE ar.attendance='Present')::int AS present,
              ROUND(
                100.0*COUNT(*) FILTER(WHERE ar.attendance='Present')
                /NULLIF(COUNT(*),0),1
              ) AS "attendancePercent"
       FROM attendance_records ar
       JOIN teacher_subjects ts ON ts.subject_id=ar.subject_id
       WHERE ($1::text IS NULL OR ar.subject_id=$1)
         AND ($2='admin' OR ts.teacher_id=$3)
       GROUP BY ar.student_id,ar.section,ar.subject_id
       HAVING COUNT(*) FILTER(WHERE ar.attendance='Present')::numeric
              /NULLIF(COUNT(*),0)<0.75
       ORDER BY "attendancePercent" ASC
       LIMIT 200`,
      [subjectId, req.user.role, req.user.id]
    );

    res.json({
      thresholdPercent: 75,
      studentsAtRisk: r.rows,
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    next(e);
  }
});


// Administrator-initiated password reset.
app.post('/admin/users/:id/reset-password', authenticate, allow('admin'), async (req, res, next) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({
      error: 'Use Change Password to update your own password.'
    });
  }

  const p = z.object({
    temporaryPassword: z.string().min(12).max(200)
  }).safeParse(req.body);

  if (!p.success) {
    return res.status(400).json({
      error: 'Temporary password must contain at least 12 characters.'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const found = await client.query(
      'SELECT id,active FROM app_users WHERE id=$1 FOR UPDATE',
      [req.params.id]
    );

    if (!found.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found.' });
    }

    if (!found.rows[0].active) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Reactivate this account before resetting its password.'
      });
    }

    const hash = await bcrypt.hash(p.data.temporaryPassword, 12);

    await client.query(
      'UPDATE app_users SET password_hash=$2,must_change_password=FALSE WHERE id=$1',
      [req.params.id, hash]
    );

    await audit(
      client,
      req.user.id,
      'user.password_reset',
      'user',
      req.params.id,
      { mustChangePassword: false }
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      message: 'Password reset. The user can sign in with the new password.'
    });
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});


// Server-backed attendance history for the administrator.
app.get('/admin/attendance', authenticate, allow('admin'), async (req, res, next) => {
  const p = z.object({
    search: z.string().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    offset: z.coerce.number().int().min(0).default(0)
  }).safeParse(req.query);

  if (!p.success) {
    return res.status(400).json({
      error: 'Invalid attendance history filters.'
    });
  }

  try {
    const d = p.data;
    const where = `WHERE ($1::text IS NULL
      OR ar.student_id ILIKE '%'||$1||'%'
      OR ar.student_name ILIKE '%'||$1||'%'
      OR ar.subject_name ILIKE '%'||$1||'%'
      OR ar.marked_by ILIKE '%'||$1||'%')`;

    const [r, c] = await Promise.all([
      pool.query(
        `SELECT ar.id,ar.student_id AS "studentId",
                ar.student_name AS "studentName",
                ar.subject_id AS "classId",ar.subject_name AS "className",
                ar.class_group AS "classGroup",ar.section,
                ar.attendance_date::text AS date,
                ar.recorded_at AS timestamp,ar.marked_by AS "markedBy",
                ar.attendance,ar.source,ar.match_score AS "matchScore",
                ar.sync_status AS status,ar.session_id AS "sessionId"
         FROM attendance_records ar ${where}
         ORDER BY ar.attendance_date DESC,ar.recorded_at DESC
         LIMIT $2 OFFSET $3`,
        [d.search || null, d.limit, d.offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM attendance_records ar ${where}`,
        [d.search || null]
      )
    ]);

    res.json({
      records: r.rows,
      limit: d.limit,
      offset: d.offset,
      total: c.rows[0].total
    });
  } catch (e) {
    next(e);
  }
});


// Paginated, filterable audit trail.
app.get('/admin/audit-logs', authenticate, allow('admin'), async (req, res, next) => {
  const p = z.object({
    search: z.string().max(120).optional(),
    action: z.string().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0)
  }).safeParse(req.query);

  if (!p.success) {
    return res.status(400).json({ error: 'Invalid audit log filters.' });
  }

  try {
    const d = p.data;
    const where = `WHERE (
      $1::text IS NULL
      OR al.action ILIKE '%'||$1||'%'
      OR al.entity_type ILIKE '%'||$1||'%'
      OR COALESCE(al.entity_id,'') ILIKE '%'||$1||'%'
      OR COALESCE(u.full_name,'') ILIKE '%'||$1||'%'
      OR COALESCE(al.actor_id,'') ILIKE '%'||$1||'%'
    ) AND ($2::text IS NULL OR al.action ILIKE '%'||$2||'%')`;

    const [r, c] = await Promise.all([
      pool.query(
        `SELECT al.id,al.actor_id AS "actorId",
                COALESCE(u.full_name,al.actor_id,'System') AS "actorName",
                al.action,al.entity_type AS "entityType",
                al.entity_id AS "entityId",al.details,
                al.created_at AS "createdAt"
         FROM audit_logs al
         LEFT JOIN app_users u ON u.id=al.actor_id
         ${where}
         ORDER BY al.created_at DESC,al.id DESC
         LIMIT $3 OFFSET $4`,
        [d.search || null, d.action || null, d.limit, d.offset]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM audit_logs al
         LEFT JOIN app_users u ON u.id=al.actor_id
         ${where}`,
        [d.search || null, d.action || null]
      )
    ]);

    res.json({
      logs: r.rows,
      limit: d.limit,
      offset: d.offset,
      total: c.rows[0].total
    });
  } catch (e) {
    next(e);
  }
});


// AI scheduling tools.
const readActiveTimetable = async (client = pool) => {
  const r = await client.query(
    `SELECT t.id,t.class_group AS "classGroup",t.section,
            t.subject_id AS "subjectId",s.name AS "subjectName",
            t.teacher_id AS "teacherId",u.full_name AS "teacherName",
            t.weekday,
            to_char(t.starts_at,'HH24:MI') AS "startsAt",
            to_char(t.ends_at,'HH24:MI') AS "endsAt",
            t.room
     FROM timetable_entries t
     JOIN subjects s ON s.id=t.subject_id
     JOIN app_users u ON u.id=t.teacher_id
     WHERE t.active=TRUE
     ORDER BY t.weekday,t.starts_at`
  );

  return r.rows;
};

app.get('/ai/timetable/validate', authenticate, allow('admin'), async (_req, res, next) => {
  try {
    const slots = await readActiveTimetable();
    const result = validateSchedule(slots);

    res.json({
      ...result,
      checkedSlots: slots.length,
      checkedAt: new Date().toISOString()
    });
  } catch (e) {
    next(e);
  }
});

app.post('/ai/timetable/generate', authenticate, allow('admin'), async (req, res, next) => {
  const p = z.object({
    requirements: z.array(z.object({
      classGroup: z.string().trim().min(1).max(200),
      section: z.string().trim().min(1).max(20),
      subjectId: z.string().trim().min(1).max(80),
      subjectName: z.string().trim().max(160).optional(),
      teacherId: z.string().trim().min(1).max(80),
      weeklySessions: z.number().int().min(1).max(6).default(1),
      durationMinutes: z.number().int()
        .refine(v => [30, 60, 90, 120].includes(v))
        .default(60),
      room: z.string().max(100).default('')
    })).min(1).max(40),
    days: z.array(z.number().int().min(1).max(5)).optional()
  }).safeParse(req.body);

  if (!p.success) {
    return res.status(400).json({
      error: 'Invalid requirements. Check class, section, subject, teacher, sessions and duration.'
    });
  }

  try {
    const [allSlots, teachers, subjects] = await Promise.all([
      readActiveTimetable(),
      pool.query(
        'SELECT id FROM teachers WHERE id=ANY($1::text[])',
        [p.data.requirements.map(r => r.teacherId)]
      ),
      pool.query(
        'SELECT id FROM subjects WHERE id=ANY($1::text[])',
        [p.data.requirements.map(r => r.subjectId)]
      )
    ]);

    const teacherIds = new Set(teachers.rows.map(r => r.id));
    const subjectIds = new Set(subjects.rows.map(r => r.id));

    const invalid = p.data.requirements.find(
      r => !teacherIds.has(r.teacherId) || !subjectIds.has(r.subjectId)
    );

    if (invalid) {
      return res.status(400).json({
        error: `Teacher or subject does not exist for requirement ${invalid.subjectId}. Create/select them first.`
      });
    }

    const targetKeys = new Set(
      p.data.requirements.map(
        r => `${r.classGroup.trim().toLowerCase()}::${r.section.trim().toUpperCase()}`
      )
    );

    const replaceSlotIds = allSlots
      .filter(s => targetKeys.has(
        `${String(s.classGroup).trim().toLowerCase()}::${String(s.section).trim().toUpperCase()}`
      ))
      .map(s => s.id);

    const slots = allSlots.filter(s => !replaceSlotIds.includes(s.id));

    const result = generateSchedule({
      requirements: p.data.requirements,
      existingSlots: slots,
      days: p.data.days
    });

    if (!result.ok) return res.status(422).json(result);

    res.json({
      ...result,
      replaceSlotIds,
      message: 'Preview only. Existing slots for the requested class/section will be replaced only after approval.',
      existingSlots: slots.length
    });
  } catch (e) {
    next(e);
  }
});

app.post('/ai/timetable/apply', authenticate, allow('admin'), async (req, res, next) => {
  const p = z.object({
    replaceSlotIds: z.array(z.string().min(1).max(80)).max(500).default([]),
    slots: z.array(z.object({
      id: z.string().min(1).max(80),
      classGroup: z.string().min(1).max(200),
      section: z.string().min(1).max(20),
      subjectId: z.string().min(1).max(80),
      subjectName: z.string().optional(),
      teacherId: z.string().min(1).max(80),
      weekday: z.number().int().min(1).max(5),
      startsAt: z.string().regex(/^\d{2}:\d{2}$/),
      endsAt: z.string().regex(/^\d{2}:\d{2}$/),
      room: z.string().max(100).default('')
    })).min(1).max(240)
  }).safeParse(req.body);

  if (!p.success) return res.status(400).json({ error: 'Invalid generated timetable.' });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(782410)');

    const existing = await readActiveTimetable(client);
    const replaceIds = new Set(p.data.replaceSlotIds);

    if ([...replaceIds].some(id => !existing.some(s => s.id === id))) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'The timetable changed after generation. Generate a fresh preview.'
      });
    }

    const validation = validateSchedule([
      ...existing.filter(s => !replaceIds.has(s.id)),
      ...p.data.slots
    ]);

    if (!validation.valid) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'The timetable changed after generation; generated slots now conflict. Generate again.',
        conflicts: validation.conflicts
      });
    }

    if (replaceIds.size) {
      await client.query(
        'UPDATE timetable_entries SET active=FALSE WHERE id=ANY($1::text[]) AND active=TRUE',
        [[...replaceIds]]
      );
    }

    for (const slot of p.data.slots) {
      const ok = await client.query(
        'SELECT 1 FROM teachers WHERE id=$1',
        [slot.teacherId]
      );

      const sub = await client.query(
        'SELECT 1 FROM subjects WHERE id=$1',
        [slot.subjectId]
      );

      if (!ok.rowCount || !sub.rowCount) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'A selected teacher or subject no longer exists. Nothing was applied.'
        });
      }

      await client.query(
        'INSERT INTO teacher_subjects(teacher_id,subject_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [slot.teacherId, slot.subjectId]
      );

      await client.query(
        `INSERT INTO timetable_entries
         (id,class_group,section,subject_id,teacher_id,weekday,starts_at,ends_at,room,active)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)`,
        [
          slot.id,
          slot.classGroup,
          slot.section.toUpperCase(),
          slot.subjectId,
          slot.teacherId,
          slot.weekday,
          slot.startsAt,
          slot.endsAt,
          slot.room || ''
        ]
      );
    }

    await audit(
      client,
      req.user.id,
      'ai.timetable.generated',
      'timetable',
      null,
      { count: p.data.slots.length }
    );

    await client.query('COMMIT');

    res.status(201).json({
      ok: true,
      applied: p.data.slots.length,
      message: 'Validated timetable slots applied.'
    });
  } catch (e) {
    await client.query('ROLLBACK');

    if (e.code === '23505') {
      return res.status(409).json({
        error: 'A generated slot ID already exists. Generate the timetable again.'
      });
    }

    next(e);
  } finally {
    client.release();
  }
});

app.post('/ai/timetable/recover', authenticate, allow('admin'), async (req, res, next) => {
  const p = z.object({
    disruptionType: z.enum(['teacher', 'room']),
    weekday: z.number().int().min(1).max(5),
    unavailableTeacherId: z.string().optional(),
    substituteTeacherId: z.string().optional(),
    unavailableRoom: z.string().optional(),
    replacementRoom: z.string().optional()
  }).safeParse(req.body);

  if (!p.success) return res.status(400).json({ error: 'Invalid recovery request.' });

  try {
    const slots = await readActiveTimetable();

    if (p.data.disruptionType === 'teacher') {
      const r = await pool.query(
        `SELECT t.id
         FROM teachers t
         JOIN app_users u ON u.id=t.id
         WHERE t.id=$1 AND t.id<>$2 AND u.active=TRUE`,
        [p.data.substituteTeacherId || '', p.data.unavailableTeacherId || '']
      );

      if (!r.rowCount) {
        return res.status(400).json({
          error: 'Choose an existing active substitute teacher different from the unavailable teacher.'
        });
      }

      const affected = slots.filter(
        s => s.weekday === p.data.weekday &&
             s.teacherId === p.data.unavailableTeacherId
      );

      if (affected.length) {
        const qualified = await pool.query(
          'SELECT subject_id AS "subjectId" FROM teacher_subjects WHERE teacher_id=$1',
          [p.data.substituteTeacherId]
        );

        const canTeach = new Set(qualified.rows.map(x => x.subjectId));
        const unsupported = affected.find(s => !canTeach.has(s.subjectId));

        if (unsupported) {
          return res.status(400).json({
            error: `The substitute teacher is not assigned to ${unsupported.subjectName || unsupported.subjectId}. Assign this subject to the substitute first, or choose another teacher.`
          });
        }
      }
    }

    const result = recoverSchedule({ slots, ...p.data });

    if (!result.ok) return res.status(422).json(result);

    res.json({
      ...result,
      message: 'Preview only. Review the proposed changes before applying them.'
    });
  } catch (e) {
    next(e);
  }
});

app.post('/ai/timetable/recover/apply', authenticate, allow('admin'), async (req, res, next) => {
  const p = z.object({
    changes: z.array(z.object({
      id: z.string().min(1).max(80),
      replacesId: z.string().min(1).max(80),
      classGroup: z.string().min(1).max(200),
      section: z.string().min(1).max(20),
      subjectId: z.string().min(1).max(80),
      teacherId: z.string().min(1).max(80),
      weekday: z.number().int().min(1).max(5),
      startsAt: z.string().regex(/^\d{2}:\d{2}$/),
      endsAt: z.string().regex(/^\d{2}:\d{2}$/),
      room: z.string().max(100).default('')
    })).min(1).max(100)
  }).safeParse(req.body);

  if (!p.success) return res.status(400).json({ error: 'Invalid recovery changes.' });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(782410)');

    const existing = await readActiveTimetable(client);
    const ids = new Set(p.data.changes.map(c => c.replacesId));

    if (ids.size !== p.data.changes.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Duplicate source slot in recovery proposal.'
      });
    }

    if ([...ids].some(id => !existing.some(s => s.id === id))) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'The timetable changed after recovery was generated. Recalculate recovery.'
      });
    }

    const finalSlots = [
      ...existing.filter(s => !ids.has(s.id)),
      ...p.data.changes
    ];

    const validation = validateSchedule(finalSlots);

    if (!validation.valid) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Recovery proposal no longer validates. No changes were applied.',
        conflicts: validation.conflicts
      });
    }

    for (const c of p.data.changes) {
      await client.query(
        'UPDATE timetable_entries SET active=FALSE WHERE id=$1 AND active=TRUE',
        [c.replacesId]
      );

      await client.query(
        'INSERT INTO teacher_subjects(teacher_id,subject_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [c.teacherId, c.subjectId]
      );

      await client.query(
        `INSERT INTO timetable_entries
         (id,class_group,section,subject_id,teacher_id,weekday,starts_at,ends_at,room,active)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)`,
        [
          c.id,
          c.classGroup,
          c.section.toUpperCase(),
          c.subjectId,
          c.teacherId,
          c.weekday,
          c.startsAt,
          c.endsAt,
          c.room || ''
        ]
      );
    }

    await audit(
      client,
      req.user.id,
      'ai.timetable.recovered',
      'timetable',
      null,
      { count: p.data.changes.length, replaced: [...ids] }
    );

    await client.query('COMMIT');

    res.json({
      ok: true,
      applied: p.data.changes.length,
      message: 'Recovery changes applied and validated.'
    });
  } catch (e) {
    await client.query('ROLLBACK');

    if (e.code === '23505') {
      return res.status(409).json({
        error: 'A recovery slot ID already exists. Recalculate recovery.'
      });
    }

    next(e);
  } finally {
    client.release();
  }
});


// Role-scoped CampusSync Assistant.
app.post('/ai/chat', authenticate, async (req, res, next) => {
  const p = z.object({
    message: z.string().trim().min(1).max(1000)
  }).safeParse(req.body);

  if (!p.success) {
    return res.status(400).json({
      error: 'Enter a message up to 1000 characters.'
    });
  }

  try {
    const role = req.user.role;
    const userId = req.user.id;
    const message = p.data.message;

    let context = {
      role,
      userName: req.user.full_name
    };

    if (role === 'student') {
      const st = await pool.query(
        'SELECT section,class_group AS "classGroup" FROM students WHERE id=$1',
        [userId]
      );

      context.section = st.rows[0]?.section;
      context.classGroup = st.rows[0]?.classGroup;

      const [tt, att] = await Promise.all([
        pool.query(
          `SELECT t.weekday,
                  to_char(t.starts_at,'HH24:MI') AS "startsAt",
                  to_char(t.ends_at,'HH24:MI') AS "endsAt",
                  s.name AS subject,t.room,u.full_name AS teacher
           FROM timetable_entries t
           JOIN subjects s ON s.id=t.subject_id
           JOIN app_users u ON u.id=t.teacher_id
           WHERE t.active=TRUE AND t.section=$1
           ORDER BY t.weekday,t.starts_at`,
          [context.section || '']
        ),
        pool.query(
          `SELECT subject_name AS subject,
                  COUNT(*)::int AS total,
                  COUNT(*) FILTER(WHERE attendance='Present')::int AS present,
                  COUNT(*) FILTER(WHERE attendance='Absent')::int AS absent
           FROM attendance_records
           WHERE student_id=$1
           GROUP BY subject_name
           ORDER BY subject_name`,
          [userId]
        )
      ]);

      context.timetable = tt.rows;
      context.attendance = att.rows;
    } else if (role === 'teacher') {
      const [tt, att] = await Promise.all([
        pool.query(
          `SELECT t.weekday,
                  to_char(t.starts_at,'HH24:MI') AS "startsAt",
                  to_char(t.ends_at,'HH24:MI') AS "endsAt",
                  t.section,s.name AS subject,t.room
           FROM timetable_entries t
           JOIN subjects s ON s.id=t.subject_id
           WHERE t.active=TRUE AND t.teacher_id=$1
           ORDER BY t.weekday,t.starts_at`,
          [userId]
        ),
        pool.query(
          `SELECT ar.subject_name AS subject,ar.section,
                  COUNT(*)::int AS total,
                  COUNT(*) FILTER(WHERE ar.attendance='Present')::int AS present
           FROM attendance_records ar
           JOIN teacher_subjects ts
             ON ts.subject_id=ar.subject_id AND ts.teacher_id=$1
           GROUP BY ar.subject_name,ar.section
           ORDER BY ar.subject_name
           LIMIT 50`,
          [userId]
        )
      ]);

      context.timetable = tt.rows;
      context.attendanceSummary = att.rows;
    } else {
      const [tt, counts] = await Promise.all([
        readActiveTimetable(),
        pool.query(
          `SELECT
             (SELECT COUNT(*)::int FROM app_users WHERE active=TRUE) AS users,
             (SELECT COUNT(*)::int FROM timetable_entries WHERE active=TRUE) AS slots,
             (SELECT COUNT(*)::int FROM attendance_records) AS "attendanceRecords"`
        )
      ]);

      // Keep the complete timetable for validation and total counts.
      // Only limit the sample passed to the language model.
      context.timetable = tt.slice(0, 120);
      context.totalTimetableEntries = tt.length;
      context.systemCounts = counts.rows[0];
      context.scheduleValidation = validateSchedule(tt);
    }

    let answer;
    const q = message.toLowerCase();

    // Optional LLM. The local intent-based answer below is the fallback.
    if (process.env.OPENAI_API_KEY) {
      try {
        const response = await fetch(
          process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json'
            },
            signal: AbortSignal.timeout(12000),
            body: JSON.stringify({
              model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
              temperature: 0.2,
              max_tokens: 450,
              messages: [
                {
                  role: 'system',
                  content: `You are CampusSync's role-scoped campus assistant.
The user role is ${role}.
Answer the user's actual question directly and concisely using only the JSON context provided.
Never reveal other users' private data, passwords, tokens, or data not in context.
Do not claim to change data.
For timetable questions, distinguish the total timetable count from the limited timetable sample in context.
For conflict questions, use scheduleValidation and describe the conflict types/messages if present.
If information is absent, say so.
Context: ${JSON.stringify(context).slice(0, 18000)}`
                },
                { role: 'user', content: message }
              ]
            })
          }
        );

        if (response.ok) {
          const data = await response.json();
          answer = data.choices?.[0]?.message?.content?.trim();
        }
      } catch {
        // Use the local grounded response if the model is unavailable.
      }
    }

    if (!answer) {
      // IMPORTANT: validate/conflict intent is checked before generic timetable intent.
      if (
        role === 'admin' &&
        /(conflict|validate|validation|overlap|clash|double.?book|collision)/.test(q)
      ) {
        const validation = context.scheduleValidation || {
          valid: true,
          conflictCount: 0,
          conflicts: []
        };

        if (validation.valid) {
          answer = `I checked all ${
            context.totalTimetableEntries ??
            context.systemCounts?.slots ??
            (context.timetable || []).length
          } active timetable entries. No teacher, section, or room overlaps were detected.`;
        } else {
          const details = (validation.conflicts || [])
            .slice(0, 8)
            .map(c => {
              const day = Number.isInteger(c.weekday)
                ? ` on ${DAY_NAMES[c.weekday]}`
                : '';

              return `${c.type}${day}: ${c.message} (slots: ${(c.slotIds || []).join(', ')})`;
            })
            .join('; ');

          answer = `I found ${validation.conflictCount} timetable conflict(s). ${details}${
            validation.conflictCount > 8
              ? '; Additional conflicts are available in AI Timetable Tools'
              : ''
          }. Open AI Timetable Tools to review the full conflict list.`;
        }
      } else if (/attendance|present|absent|threshold|percentage|percent/.test(q)) {
        if (role === 'student') {
          answer = context.attendance?.length
            ? `Your recorded attendance by subject: ${
                context.attendance.map(a =>
                  `${a.subject}: ${a.present}/${a.total} present (${
                    a.total ? Math.round(a.present / a.total * 100) : 0
                  }%)`
                ).join('; ')
              }.`
            : 'I could not find any attendance records for your account yet.';
        } else if (role === 'teacher') {
          answer = context.attendanceSummary?.length
            ? `Attendance summary for your assigned subjects: ${
                context.attendanceSummary.map(a =>
                  `${a.subject}, Section ${a.section}: ${a.present}/${a.total} present (${
                    a.total ? Math.round(a.present / a.total * 100) : 0
                  }%)`
                ).join('; ')
              }.`
            : 'No attendance records are available for your assigned subjects yet.';
        } else {
          answer = `There are ${context.systemCounts.attendanceRecords} attendance records in the system. For detailed student-level records, use the Attendance History panel. I can only summarize records exposed by the current admin context.`;
        }
      } else if (
        role === 'admin' &&
        /(how many|count|total|number of|system stats|statistics|users|students|teachers|slots|entries)/.test(q)
      ) {
        const c = context.systemCounts || {};

        answer = `Current system counts: ${c.users ?? 'unknown'} active users, ${
          c.slots ?? context.totalTimetableEntries ?? 0
        } active timetable entries, and ${
          c.attendanceRecords ?? 0
        } attendance records. The timetable has ${
          context.totalTimetableEntries ?? c.slots ?? 0
        } entries; ${
          context.scheduleValidation?.valid
            ? 'no conflicts were detected'
            : `${context.scheduleValidation?.conflictCount ?? 0} conflict(s) were detected`
        }.`;
      } else if (/timetable|schedule|class|lecture|room|today|tomorrow/.test(q)) {
        const entries = context.timetable || [];

        if (role === 'student' || role === 'teacher') {
          answer = entries.length
            ? `Your timetable entries: ${
                entries.slice(0, 20).map(t =>
                  `${DAY_NAMES[Number(t.weekday)] || `Day ${t.weekday}`} ${
                    t.startsAt
                  }-${t.endsAt}: ${
                    t.subject || t.subjectName || 'Class'
                  }${
                    t.section ? `, Section ${t.section}` : ''
                  }${
                    t.teacher || t.teacherName ? `, teacher ${t.teacher || t.teacherName}` : ''
                  }${
                    t.room ? `, room ${t.room}` : ''
                  }`
                ).join('; ')
              }${
                entries.length > 20 ? `; showing 20 of ${entries.length} entries` : ''
              }.`
            : 'No timetable entries are currently available for your account/section.';
        } else {
          const total =
            context.totalTimetableEntries ??
            context.systemCounts?.slots ??
            entries.length;

          const sample = entries.slice(0, 15).map(t =>
            `${DAY_NAMES[Number(t.weekday)] || `Day ${t.weekday}`} ${
              t.startsAt
            }-${t.endsAt}: ${
              t.subjectName || t.subject || t.subjectId
            }, ${t.classGroup || ''}${
              t.section ? ` Section ${t.section}` : ''
            }, teacher ${t.teacherName || t.teacherId || 'unassigned'}${
              t.room ? `, room ${t.room}` : ''
            }`
          ).join('; ');

          answer = `There are ${total} active timetable entries. Validation: ${
            context.scheduleValidation?.valid
              ? 'no conflicts detected'
              : `${context.scheduleValidation?.conflictCount ?? 0} conflict(s) detected`
          }.${sample
            ? ` Timetable sample: ${sample}${
                total > entries.length
                  ? `; showing ${entries.length} of ${total} entries`
                  : ''
              }.`
            : ''
          } For a complete validation report, use AI Timetable Tools.`;
        }
      } else {
        answer = `I’m CampusSync Assistant for ${role}. ${
          role === 'student'
            ? 'I can summarize your timetable and recorded attendance.'
            : role === 'teacher'
              ? 'I can summarize your assigned timetable and attendance records.'
              : 'I can report active users, timetable counts, attendance-record counts, and validate timetable conflicts.'
        } Try asking a specific question, such as “Check timetable conflicts”, “How many active timetable entries are there?”, or “Show my attendance percentage”.`;
      }
    }

    res.json({
      answer,
      role,
      mode: process.env.OPENAI_API_KEY
        ? 'llm-or-grounded-fallback'
        : 'grounded-assistant',
      contextAvailable: true
    });
  } catch (e) {
    next(e);
  }
});


app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, _req, res, _next) => {
  console.error('[api]', err.stack || err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const port = Number(process.env.PORT || 4000);

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`CampusSync API listening on http://localhost:${port}`);
  });
}

export default app;