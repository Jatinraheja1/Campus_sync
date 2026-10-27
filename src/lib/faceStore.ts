// Face enrollments live in IndexedDB (better suited than localStorage for biometric templates).
// Only 128-number face descriptors are stored. Raw photos are never saved.
// NOTE: browser storage is NOT a secure vault. For production keep templates server-side, encrypted, access-controlled.

export interface Enrollment {
  studentId: string;
  descriptors: number[][]; // up to MAX_SAMPLES face descriptors
  enrolledAt: string;
  updatedAt: string;
  consentAt: string; // last time staff confirmed the student's consent
  consentRecordedBy: string;
  model: string;
}

export const MAX_SAMPLES = 3;
const DB_NAME = "smartattend-faces";
const STORE = "enrollments";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) { reject(new Error("IndexedDB unavailable")); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "studentId" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB error"));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error("IndexedDB error")); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("IndexedDB aborted")); };
  });
}

export const getAllEnrollments = () => run<Enrollment[]>("readonly", (s) => s.getAll());
export const saveEnrollment = (e: Enrollment) => run("readwrite", (s) => s.put(e));
export const removeEnrollment = (studentId: string) => run("readwrite", (s) => s.delete(studentId));
