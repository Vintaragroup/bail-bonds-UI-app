import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./layouts/AppLayout";
import Dashboard from "./pages/Dashboard";
import Cases from "./pages/Cases";
import CaseDetail from "./pages/CaseDetail";
import CheckIns from "./pages/CheckIns";
import Calendar from "./pages/Calendar";
import PaymentsRoutes from "./pages/PaymentsRoutes";
import Messages from "./pages/Messages";
import Admin from "./pages/Admin";
import Reports from "./pages/Reports";
import AuthPreview from "./pages/AuthPreview";
import AuthRoutes from "./pages/AuthRoutes";
import { UserProvider } from "./components/UserContext";
import RequireAuth from "./components/RequireAuth";

const AUTH_PREVIEW_ENABLED = import.meta.env.VITE_ENABLE_AUTH_PREVIEW === "true" || import.meta.env.DEV;

export default function App() {
  return (
    <UserProvider>
      <Routes>
        <Route path="/login" element={<Navigate to="/auth/login" replace />} />
        <Route path="/auth" element={<AuthRoutes />} />
        <Route path="/auth/:screen" element={<AuthRoutes />} />
        {AUTH_PREVIEW_ENABLED && <Route path="/auth/preview" element={<AuthPreview />} />}
        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/cases" element={<Cases />} />
          <Route path="/cases/:caseId" element={<CaseDetail />} />
          <Route path="/check-ins" element={<CheckIns />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/payments/*" element={<PaymentsRoutes />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/admin" element={<Admin />} />
        </Route>
      </Routes>
    </UserProvider>
  );
}
