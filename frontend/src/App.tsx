import React from "react";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { AuthProvider, getDashboardPath, useAuth } from "@/context/AuthContext";
import type { UserRole } from "@/services/authStorage";
import Loader from "@/components/ui/loader";
import RoleProtectedRoute from "@/components/RoleProtectedRoute";
import GuestRoute from "@/components/GuestRoute";
import AdminSidebar from "@/components/AdminSidebar";
import StudentSidebar from "@/components/StudentSidebar";
import AdminNavbar from "@/components/AdminNavbar";
import StudentNavbar from "@/components/StudentNavbar";
import UserSidebar from "@/components/UserSidebar";
import UserNavbar from "@/components/UserNavbar";
import Dashboard from "@/pages/Dashboard";
import ManageStudents from "@/pages/admin/ManageStudents";
import ManageParents from "@/pages/admin/ManageParents";
import Staffs from "@/pages/admin/Staffs";
import Settings from "@/pages/settings";
import Register from "@/pages/Register";
import PendingApprovals from "@/pages/PendingApprovals";
import Login from "@/pages/Login";
import ForgotPassword from "@/pages/ForgotPassword";
import AdminProfile from "@/pages/AdminProfile";
import StudentProfile from "@/pages/StudentProfile";
import OrderDisplay from "@/pages/order/OrderDisplay";
import StudentWallet from "@/pages/student/StudentWallet";
import StudentHistory from "@/pages/student/StudentHistory";
import Reports from "@/pages/Reports";
import AuditLogs from "@/pages/AuditLogs";
import UserProfile from "@/pages/UserProfile";
import ParentProfile from "@/pages/parent/ParentProfile";
import ParentDashboard from "@/pages/parent/ParentDashboard";
import PayWithKopokopo from "@/pages/parent/PayWithKopokopo";
import ParentTopUpWallet from "@/pages/parent/ParentTopUpWallet";
import ParentManageWallet from "@/pages/parent/ParentManageWallet";
import ParentWalletHistory from "@/pages/parent/ParentWalletHistory";
import PosTerminal from "@/pages/restaurant/PosTerminal";
import MenuManagement from "@/pages/restaurant/MenuManagement";
import MenuListPage from "@/pages/restaurant/MenuListPage";
import MenuAddPage from "@/pages/restaurant/MenuAddPage";
import MenuEditPage from "@/pages/restaurant/MenuEditPage";
import MenuUpdatePage from "@/pages/restaurant/MenuUpdatePage";
import MenuDeletePage from "@/pages/restaurant/MenuDeletePage";
import MenuRecipesPage from "@/pages/restaurant/MenuRecipesPage";
import MenuCategoriesPage from "@/pages/restaurant/MenuCategoriesPage";
import InventoryPage from "@/pages/restaurant/InventoryPage";
import SuppliersPage from "@/pages/restaurant/SuppliersPage";
import ProductionPage from "@/pages/restaurant/ProductionPage";
import FinanceDashboard from "@/pages/finance/FinanceDashboard";
import ExpensesPage from "@/pages/finance/ExpensesPage";
import ReceiptsPage from "@/pages/finance/ReceiptsPage";
import CollectionsPage from "@/pages/finance/CollectionsPage";
import StaffAttendanceTerminal from "@/pages/attendance/StaffAttendanceTerminal";
import StaffAttendanceReport from "@/pages/attendance/StaffAttendanceReport";

const USER_ROLES: UserRole[] = ["parent", "finance", "restaurant"];

const R = (roles: UserRole[], element: JSX.Element) => (
  <RoleProtectedRoute roles={roles}>{element}</RoleProtectedRoute>
);

function AppShell() {
  const location = useLocation();
  const { status, user } = useAuth();
  const publicPages = ["/login", "/register", "/forgot-password", "/kiosk", "/attendance"];
  const isAuthPage = publicPages.includes(location.pathname);
  const isKioskPage = location.pathname === "/kiosk";
  const isAttendancePage = location.pathname === "/attendance";
  const showShell = status === "authenticated" && !!user && !isAuthPage && !isKioskPage && !isAttendancePage;
  const role = user?.role;

  let SidebarComponent: React.FC = AdminSidebar;
  let NavbarComponent: React.FC = AdminNavbar;

  if (role === "student") {
    SidebarComponent = StudentSidebar;
    NavbarComponent = StudentNavbar;
  } else if (role && USER_ROLES.includes(role)) {
    SidebarComponent = UserSidebar;
    NavbarComponent = UserNavbar;
  }

  if (status === "loading" && !isAuthPage) {
    return (
      <Loader
        size="sm"
        title="Loading SmartPOS..."
        subtitle="Verifying your session"
        className="min-h-screen py-24"
      />
    );
  }

  if (status === "unauthenticated" && !isAuthPage) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (isKioskPage) {
    return (
      <Routes>
        <Route path="/kiosk" element={<OrderDisplay mode="kiosk" />} />
      </Routes>
    );
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
      {showShell && <SidebarComponent />}
      <div className="flex-1 flex flex-col h-screen overflow-y-auto">
        {showShell && <NavbarComponent />}
        <Routes>
          <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
          <Route path="/register" element={<GuestRoute><Register /></GuestRoute>} />
          <Route path="/forgot-password" element={<GuestRoute><ForgotPassword /></GuestRoute>} />

          {/* Admin */}
          <Route path="/" element={R(["admin"], <Dashboard />)} />
          <Route path="/students" element={R(["admin"], <ManageStudents />)} />
          <Route path="/parents" element={R(["admin"], <ManageParents />)} />
          <Route path="/staffs" element={R(["admin"], <Staffs />)} />
          <Route path="/restaurant-staff" element={<Navigate to="/staffs" replace />} />
          <Route path="/finance-officers" element={<Navigate to="/staffs" replace />} />
          <Route path="/manage-users" element={R(["admin"], <Navigate to="/students" replace />)} />
          <Route path="/add-student" element={R(["admin"], <Navigate to="/students" replace />)} />
          <Route path="/reports" element={R(["admin"], <Reports />)} />
          <Route path="/audit-logs" element={R(["admin"], <AuditLogs />)} />
          <Route path="/pending-approvals" element={R(["admin"], <PendingApprovals />)} />
          <Route path="/staff-attendance" element={R(["admin", "finance"], <StaffAttendanceReport />)} />
          <Route path="/admin-profile" element={R(["admin"], <AdminProfile />)} />
          <Route path="/settings" element={R(["admin"], <Settings />)} />

          {/* Student */}
          <Route path="/student/order" element={R(["student"], <OrderDisplay mode="student" />)} />
          <Route path="/student-fees" element={<Navigate to="/student/wallet" replace />} />
          <Route path="/student-dashboard" element={R(["student"], <Navigate to="/student/wallet" replace />)} />
          <Route path="/student/wallet" element={R(["student"], <StudentWallet />)} />
          <Route path="/student/history" element={R(["student"], <StudentHistory />)} />
          <Route path="/student-profile" element={R(["student"], <StudentProfile />)} />

          {/* Parent */}
          <Route path="/parent-dashboard" element={R(["parent"], <ParentDashboard />)} />
          <Route path="/pay-kopokopo" element={R(["parent", "admin", "restaurant", "finance"], <PayWithKopokopo />)} />
          <Route path="/pay-mpesa" element={<Navigate to="/pay-kopokopo" replace />} />
          <Route path="/parent/topup" element={R(["parent"], <ParentTopUpWallet />)} />
          <Route path="/parent/wallet" element={R(["parent"], <ParentManageWallet />)} />
          <Route path="/parent/history" element={R(["parent"], <ParentWalletHistory />)} />

          {/* Restaurant */}
          <Route path="/pos" element={R(["restaurant"], <PosTerminal />)} />
          <Route path="/menu-management" element={R(["restaurant"], <MenuManagement />)} />
          <Route path="/menu-management/list" element={R(["restaurant"], <MenuListPage />)} />
          <Route path="/menu-management/add" element={R(["restaurant"], <MenuAddPage />)} />
          <Route path="/menu-management/edit" element={R(["restaurant"], <MenuEditPage />)} />
          <Route path="/menu-management/update" element={R(["restaurant"], <MenuUpdatePage />)} />
          <Route path="/menu-management/delete" element={R(["restaurant"], <MenuDeletePage />)} />
          <Route path="/menu-management/recipes" element={R(["restaurant"], <MenuRecipesPage />)} />
          <Route path="/menu-management/categories" element={R(["restaurant"], <MenuCategoriesPage />)} />
          <Route path="/inventory" element={R(["admin", "restaurant", "finance"], <InventoryPage />)} />
          <Route path="/suppliers" element={R(["admin", "restaurant", "finance"], <SuppliersPage />)} />
          <Route path="/production" element={R(["admin", "restaurant", "finance"], <ProductionPage />)} />
          <Route path="/my-attendance" element={R(["restaurant", "finance"], <StaffAttendanceReport />)} />

          {/* Finance */}
          <Route path="/finance" element={R(["finance"], <FinanceDashboard />)} />
          <Route path="/expenses" element={R(["finance"], <ExpensesPage />)} />
          <Route path="/receipts" element={R(["finance"], <ReceiptsPage />)} />
          <Route path="/collections" element={R(["admin", "finance"], <CollectionsPage />)} />

          {/* Shared profile */}
          <Route
            path="/user-profile"
            element={R(
              ["admin", "student", "parent", "finance", "restaurant"],
              user?.role === "parent" ? <ParentProfile /> : <UserProfile />,
            )}
          />

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
