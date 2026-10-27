import { Route, Routes } from "react-router-dom";
import RequireRole from "./components/RequireRole";
import AdminDashboard from "./pages/AdminDashboard";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import ChangePassword from "./pages/ChangePassword";
import StudentDashboard from "./pages/StudentDashboard";
import TeacherDashboard from "./pages/TeacherDashboard";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login/:role" element={<Login />} />
      <Route path="/change-password" element={<ChangePassword />} />
      <Route path="/student" element={<RequireRole role="student"><StudentDashboard /></RequireRole>} />
      <Route path="/teacher" element={<RequireRole role="teacher"><TeacherDashboard /></RequireRole>} />
      <Route path="/admin" element={<RequireRole role="admin"><AdminDashboard /></RequireRole>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
