import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
const users = [
 {id:'STU001',email:'student@demo.com',name:'Rahul Sharma',role:'student',password:'Student123'},
 {id:'TCH001',email:'teacher@demo.com',name:'Dr. Anita Rao',role:'teacher',password:'Teacher123'},
 {id:'ADM001',email:'admin@demo.com',name:'System Administrator',role:'admin',password:'Admin123'}
];
const students = [
 {id:'STU001',section:'A'},{id:'STU002',section:'A'},{id:'STU003',section:'B'},{id:'STU004',section:'B'}
];
const teachers = [
 {id:'TCH001',email:'teacher@demo.com',name:'Dr. Anita Rao'},
 {id:'TCH002',email:'vikram@college.example',name:'Prof. Vikram Mehta'}
];
const subjects = [
 {id:'CS101',name:'Data Structures',teacher:'TCH001'},
 {id:'CS102',name:'Database Systems',teacher:'TCH001'},
 {id:'CS201',name:'Operating Systems',teacher:'TCH002'}
];
try {
 for (const u of users) {
  const hash=await bcrypt.hash(u.password,12);
  // Seed demo users only when missing. Re-running seed must never reset passwords
  // or reactivate an account that an administrator intentionally disabled.
  await pool.query(`INSERT INTO app_users(id,email,full_name,role,password_hash) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(id) DO NOTHING`,
   [u.id,u.email,u.name,u.role,hash]);
 }
 // Seed the remaining roster users without exposing credentials for them.
 for (const s of students) {
  if (s.id==='STU001') continue;
  await pool.query(`INSERT INTO app_users(id,email,full_name,role,password_hash) VALUES($1,$2,$3,'student',$4) ON CONFLICT(id) DO NOTHING`,
   [s.id,`${s.id.toLowerCase()}@college.example`,({STU002:'Priya Singh',STU003:'Amit Kumar',STU004:'Neha Verma'})[s.id],await bcrypt.hash(`Disabled-${s.id}-${process.env.JWT_SECRET || 'setup'}`,12)]);
 }
 for (const t of teachers) {
  if(t.id==='TCH001') continue;
  await pool.query(`INSERT INTO app_users(id,email,full_name,role,password_hash) VALUES($1,$2,$3,'teacher',$4) ON CONFLICT(id) DO NOTHING`,
   [t.id,t.email,t.name,await bcrypt.hash(`Disabled-${t.id}-${process.env.JWT_SECRET || 'setup'}`,12)]);
 }
 for(const s of students) await pool.query('INSERT INTO students(id,section) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET section=EXCLUDED.section',[s.id,s.section]);
 for(const t of teachers) await pool.query('INSERT INTO teachers(id) VALUES($1) ON CONFLICT DO NOTHING',[t.id]);
 for(const s of subjects) {
  await pool.query('INSERT INTO subjects(id,name,teacher_id) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,teacher_id=EXCLUDED.teacher_id',[s.id,s.name,s.teacher]);
  await pool.query('INSERT INTO teacher_subjects(teacher_id,subject_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[s.teacher,s.id]);
 }
 // Small realistic demo timetable, fee ledger, notifications and attendance history.
 const timetable = [
  {id:'TT-A-CS101-MON',section:'A',subject:'CS101',teacher:'TCH001',weekday:1,start:'09:00',end:'10:00',room:'Lab 2'},
  {id:'TT-A-CS102-WED',section:'A',subject:'CS102',teacher:'TCH001',weekday:3,start:'11:00',end:'12:00',room:'Room 204'},
  {id:'TT-B-CS201-FRI',section:'B',subject:'CS201',teacher:'TCH002',weekday:5,start:'10:00',end:'11:00',room:'Room 105'}
 ];
 for(const t of timetable) await pool.query(`INSERT INTO timetable_entries(id,class_group,section,subject_id,teacher_id,weekday,starts_at,ends_at,room) VALUES($1,'B.Tech CSE, Year 2',$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING`,[t.id,t.section,t.subject,t.teacher,t.weekday,t.start,t.end,t.room]);
 await pool.query(`INSERT INTO fee_records(id,student_id,amount_paise,status,payment_reference) VALUES('FEE-STU001-2026','STU001',4500000,'due',NULL) ON CONFLICT(id) DO NOTHING`);
 await pool.query(`INSERT INTO user_notifications(user_id,title,message) SELECT 'STU001','Welcome to CampusSync','Your attendance and timetable are available in the student portal.' WHERE NOT EXISTS (SELECT 1 FROM user_notifications WHERE user_id='STU001' AND title='Welcome to CampusSync')`);
 // Seed four historical sessions so the Risk Radar demonstrates real SQL-based calculations.
 for(let i=0;i<4;i++) {
  const date=new Date(); date.setDate(date.getDate()-7*(i+1)); const day=date.toISOString().slice(0,10); const sid=`DEMO-CS101-A-${day}`;
  await pool.query(`INSERT INTO attendance_sessions(id,class_group,section,subject_id,session_date,status,sync_status,created_at,payload) VALUES($1,'B.Tech CSE, Year 2','A','CS101',$2,'finalized','Synced',$2::date::timestamptz,'{}'::jsonb) ON CONFLICT(id) DO NOTHING`,[sid,day]);
  for(const studentId of ['STU001','STU002']) {
   const present = studentId==='STU001' ? i<2 : i!==3;
   const user=await pool.query('SELECT full_name FROM app_users WHERE id=$1',[studentId]);
   await pool.query(`INSERT INTO attendance_records(id,student_id,student_name,subject_id,subject_name,class_group,section,attendance_date,recorded_at,marked_by,attendance,source,sync_status,session_id,payload) VALUES($1,$2,$3,'CS101','Data Structures','B.Tech CSE, Year 2','A',$4::date,$4::date::timestamptz,'TCH001',$5,'manual','Synced',$6,'{}'::jsonb) ON CONFLICT DO NOTHING`,[`DEMO-REC-${studentId}-${day}`,studentId,user.rows[0].full_name,day,present?'Present':'Absent',sid]);
  }
 }
 console.log('Seed complete. Existing accounts and their active/disabled status were preserved.');
} catch(e) { console.error('[seed] failed:',e.message); process.exitCode=1; }
finally { await pool.end(); }
