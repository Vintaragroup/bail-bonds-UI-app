import { Routes, Route } from "react-router-dom";
import AppLayout from "./layouts/AppLayout";
import Dashboard from "./pages/Dashboard";
import Cases from "./pages/Cases";
import CaseDetail from "./pages/CaseDetail";
import CheckIns from "./pages/CheckIns";
import Calendar from "./pages/Calendar";
import Payments from "./pages/Payments";
import Messages from "./pages/Messages";
import Admin from "./pages/Admin";
import Login from "./pages/Login";
import Reports from "./pages/Reports";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/cases" element={<Cases />} />
        <Route path="/cases/:caseId" element={<CaseDetail />} />
        <Route path="/check-ins" element={<CheckIns />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/admin" element={<Admin />} />
      </Route>
    </Routes>
  );
}
