import React from "react";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { AuthProvider, getDashboardPath, useAuth } from "@/context/AuthContext";
import type { UserRole } from "@/services/authStorage";
import Loader from "@/components/ui/loader";
import RoleProtectedRoute from "@/components/RoleProtectedRoute";
import GuestRoute from "@/components/GuestRoute";
import Sidebar from "@/components/Sidebar";
import Navbar from "@/components/Navbar";
import Dashboard from "@/pages/Dashboard";
import Staffs from "@/pages/admin/Staffs";
import Settings from "@/pages/settings";
import Login from "@/pages/Login";
import ForgotPassword from "@/pages/ForgotPassword";
import AdminProfile from "@/pages/AdminProfile";
import Reports from "@/pages/Reports";
import AuditLogs from "@/pages/AuditLogs";
import UserProfile from "@/pages/UserProfile";
import PosTerminal from "@/pages/pos/PosTerminal";
import MenuManagement from "@/pages/pos/MenuManagement";
import MenuListPage from "@/pages/pos/MenuListPage";
import MenuAddPage from "@/pages/pos/MenuAddPage";
import MenuEditPage from "@/pages/pos/MenuEditPage";
import MenuUpdatePage from "@/pages/pos/MenuUpdatePage";
import MenuDeletePage from "@/pages/pos/MenuDeletePage";
import MenuRecipesPage from "@/pages/pos/MenuRecipesPage";
import MenuCategoriesPage from "@/pages/pos/MenuCategoriesPage";
import InventoryPage from "@/pages/pos/InventoryPage";
import SuppliersPage from "@/pages/pos/SuppliersPage";
import ProductionPage from "@/pages/pos/ProductionPage";
import FinanceDashboard from "@/pages/finance/FinanceDashboard";
import ExpensesPage from "@/pages/finance/ExpensesPage";
import ReceiptsPage from "@/pages/finance/ReceiptsPage";
import CollectionsPage from "@/pages/finance/CollectionsPage";
import StaffAttendanceTerminal from "@/pages/attendance/StaffAttendanceTerminal";
import StaffAttendanceReport from "@/pages/attendance/StaffAttendanceReport";

const R = (roles: UserRole[], element: JSX.Element) => (
  <RoleProtectedRoute roles={roles}>{element}</RoleProtectedRoute>
);

function AppShell() {
  const location = useLocation();
  const { status, user } = useAuth();
  const publicPages = ["/login", "/forgot-password", "/attendance"];
  const isAuthPage = publicPages.includes(location.pathname);
  const isAttendancePage = location.pathname === "/attendance";
  const showShell = status === "authenticated" && !!user && !isAuthPage && !isAttendancePage;

  if (status === "loading" && !isAuthPage) {
    return (
      <Loader
        size="sm"
        title="Loading Slow Rise Co..."
        subtitle="Verifying your session"
        className="min-h-screen py-24"
      />
    );
  }

  if (status === "unauthenticated" && !isAuthPage) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (isAttendancePage) {
    return (
      <Routes>
        <Route path="/attendance" element={<StaffAttendanceTerminal />} />
      </Routes>
    );
  }

  return (
    <div className="flex">
      {showShell && <Sidebar />}
      <div className="flex-1 flex flex-col h-screen overflow-y-auto">
        {showShell && <Navbar />}
        <Routes>
          <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
          <Route path="/forgot-password" element={<GuestRoute><ForgotPassword /></GuestRoute>} />

          {/* Owner */}
          <Route path="/" element={R(["owner"], <Dashboard />)} />
          <Route path="/dashboard" element={<Navigate to="/" replace />} />
          <Route path="/staffs" element={R(["owner"], <Staffs />)} />
          <Route path="/reports" element={R(["owner"], <Reports />)} />
          <Route path="/audit-logs" element={R(["owner"], <AuditLogs />)} />
          <Route path="/staff-attendance" element={R(["owner"], <StaffAttendanceReport />)} />
          <Route path="/admin-profile" element={R(["owner"], <AdminProfile />)} />
          <Route path="/settings" element={R(["owner"], <Settings />)} />

          {/* POS & bakery ops — owner + cashier */}
          <Route path="/pos" element={R(["owner", "cashier"], <PosTerminal />)} />
          <Route path="/menu-management" element={R(["owner"], <MenuManagement />)} />
          <Route path="/menu-management/list" element={R(["owner"], <MenuListPage />)} />
          <Route path="/menu-management/add" element={R(["owner"], <MenuAddPage />)} />
          <Route path="/menu-management/edit" element={R(["owner"], <MenuEditPage />)} />
          <Route path="/menu-management/update" element={R(["owner"], <MenuUpdatePage />)} />
          <Route path="/menu-management/delete" element={R(["owner"], <MenuDeletePage />)} />
          <Route path="/menu-management/recipes" element={R(["owner"], <MenuRecipesPage />)} />
          <Route path="/menu-management/categories" element={R(["owner"], <MenuCategoriesPage />)} />
          <Route path="/inventory" element={R(["owner"], <InventoryPage />)} />
          <Route path="/suppliers" element={R(["owner"], <SuppliersPage />)} />
          <Route path="/production" element={R(["owner"], <ProductionPage />)} />
          <Route path="/my-attendance" element={R(["owner", "cashier"], <StaffAttendanceReport />)} />

          {/* Finance — owner only */}
          <Route path="/finance" element={R(["owner"], <FinanceDashboard />)} />
          <Route path="/expenses" element={R(["owner"], <ExpensesPage />)} />
          <Route path="/receipts" element={R(["owner"], <ReceiptsPage />)} />
          <Route path="/collections" element={R(["owner"], <CollectionsPage />)} />

          {/* Shared profile */}
          <Route path="/user-profile" element={R(["owner", "cashier"], <UserProfile />)} />

          <Route
            path="*"
            element={
              status === "authenticated" && user
                ? <Navigate to={getDashboardPath(user.role)} replace />
                : <Navigate to="/login" replace />
            }
          />
        </Routes>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
