import { useCallback, useEffect, useState } from "react";
import { getAllEnrollments, type Enrollment } from "../lib/faceStore";

export function useEnrollments() {
  const [enrollments, setEnrollments] = useState<Map<string, Enrollment>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const all = await getAllEnrollments();
      setEnrollments(new Map(all.map((e) => [e.studentId, e])));
      setError(null);
    } catch {
      setError("Face enrollment storage (IndexedDB) is unavailable in this browser, so face recognition cannot be used.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  return { enrollments, loading, error, reload };
}
