import type { Account, ClassInfo, Role, Student, Teacher } from "../types";

export const STUDENTS: Student[] = [
  { id: "STU001", name: "Rahul Sharma", email: "student@demo.com", section: "A" },
  { id: "STU002", name: "Priya Singh", email: "priya@college.example", section: "A" },
  { id: "STU003", name: "Amit Kumar", email: "amit@college.example", section: "B" },
  { id: "STU004", name: "Neha Verma", email: "neha@college.example", section: "B" },
];

export const TEACHERS: Teacher[] = [
  { id: "TCH001", name: "Dr. Anita Rao", email: "teacher@demo.com", classIds: ["CS101", "CS102"] },
  { id: "TCH002", name: "Prof. Vikram Mehta", email: "vikram@college.example", classIds: ["CS201"] },
];

export const CLASSES: ClassInfo[] = [
  { id: "CS101", name: "Data Structures", teacherId: "TCH001" },
  { id: "CS102", name: "Database Systems", teacherId: "TCH001" },
  { id: "CS201", name: "Operating Systems", teacherId: "TCH002" },
];

/** Only these three accounts can log in. Passwords are stored as salted hashes. */
export const ACCOUNTS: Account[] = [
  { id: "STU001", role: "student", name: "Rahul Sharma", email: "student@demo.com", passwordHash: "54636d826bc78847b8d8a18b592a1d7929c92ec7113bafa6033ec7062f371ba8" },
  { id: "TCH001", role: "teacher", name: "Dr. Anita Rao", email: "teacher@demo.com", passwordHash: "67b6fd4d51f908721e6a4e54b3cb5243c5576a30b5c24ba52826c932bdb442d1" },
  { id: "ADM001", role: "admin", name: "System Administrator", email: "admin@demo.com", passwordHash: "2faa226017fe873880a43ef59ea8d3d7f5c64b6598a3ae4b8558ee06b7fa9d1a" },
];

/** Shown on the login page for demonstration only. */
export const DEMO_CREDENTIALS: Record<Role, { email: string; password: string }> = {
  student: { email: "student@demo.com", password: "Student123" },
  teacher: { email: "teacher@demo.com", password: "Teacher123" },
  admin: { email: "admin@demo.com", password: "Admin123" },
};

export const ROLE_LABEL: Record<Role, string> = {
  student: "Student",
  teacher: "Teacher",
  admin: "Administrator",
};

export const dashboardPath = (role: Role) => `/${role}`;
export const isRole = (v: string | undefined): v is Role => v === "student" || v === "teacher" || v === "admin";

export const CLASS_GROUP = "B.Tech CSE, Year 2";
export const SECTIONS = ["A", "B"];
