import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import { MoreHorizontal } from "lucide-react";
import { ToastProvider } from "../components/ToastContext";
import { useUser } from "../components/UserContext";
import { PillButton } from "../components/ui/pill-button";
import { UserAvatar } from "../components/ui/user-avatar";
import BottomNav from "../components/BottomNav";

// Primary tabs shown in the desktop top nav (cleaned up)
const tabs = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/prospects", label: "Prospects" },
  { to: "/check-ins", label: "Check-ins" },
  { to: "/calendar", label: "Calendar" },
  { to: "/messages", label: "Messages" },
  { to: "/admin", label: "Admin" },
];

// Items moved into the overflow (3-dot) menu
const overflowItems = [
  { to: "/cases", label: "Cases" },
  { to: "/payments", label: "Payments" },
  { to: "/reports", label: "Reports" },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const { currentUser, signOut } = useUser();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef(null);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') setOverflowOpen(false);
    }
    function onClickAway(e) {
      if (!overflowRef.current) return;
      if (!overflowRef.current.contains(e.target)) setOverflowOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onClickAway);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onClickAway);
    };
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      navigate('/auth/login', { replace: true });
    }
  };

  return (
    <ToastProvider>
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="sticky top-0 z-10 bg-white border-b">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <span className="font-semibold tracking-tight">Bail Bonds Dashboard</span>
          <nav className="hidden md:flex gap-4">
            {tabs.map(t => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  "text-sm px-2 py-1 rounded-md " +
                  (isActive ? "bg-gray-100 font-semibold" : "text-gray-600 hover:text-gray-900")
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3 relative" ref={overflowRef}>
            {/* 3-dot overflow menu (desktop only) */}
            <div className="hidden md:block">
              <button
                type="button"
                aria-label="More"
                onClick={() => setOverflowOpen((v) => !v)}
                className="rounded-md border border-slate-300 p-1 text-slate-600 hover:border-slate-400 hover:text-slate-900"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
              {overflowOpen ? (
                <div
                  className="absolute right-28 top-10 z-20 w-48 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg"
                  role="menu"
                >
                  <div className="py-1 text-sm">
                    {overflowItems.map((item) => (
                      <button
                        key={item.to}
                        type="button"
                        onClick={() => { setOverflowOpen(false); navigate(item.to); }}
                        className="block w-full px-3 py-2 text-left text-slate-700 hover:bg-slate-50"
                        role="menuitem"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            {currentUser && (
              <UserAvatar
                user={currentUser}
                size="sm"
                className="cursor-pointer"
                onClick={() => navigate('/auth/profile-settings')}
              />
            )}
            <PillButton size="sm" variant="outline" onClick={handleSignOut}>
              Sign out
            </PillButton>
          </div>
        </div>
      </header>

      {/* Mobile tabs */}
      <div className="md:hidden border-b bg-white">
        <div className="mx-auto max-w-7xl px-2 py-2 flex gap-2 overflow-x-auto">
          {tabs.map(t => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                "text-xs whitespace-nowrap px-2 py-1 rounded-md " +
                (isActive ? "bg-gray-100 font-semibold" : "text-gray-600 hover:text-gray-900")
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      </div>

      {/* Page content */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 pb-24 md:pb-6">
        <Outlet />
      </main>
      {/* bottom nav for mobile */}
      <BottomNav />
    </div>
    </ToastProvider>
  );
}
