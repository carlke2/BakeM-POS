import { Navigate, useLocation } from "react-router-dom";
import Loader from "@/components/ui/loader";
import { getDashboardPath, useAuth } from "@/context/AuthContext";
import type { UserRole } from "@/services/authStorage";

type Props = {
  children: JSX.Element;
  roles: UserRole[];
};

const RoleProtectedRoute = ({ children, roles }: Props) => {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <Loader
        size="sm"
        title="Verifying session..."
        subtitle="Checking your login with the server"
        className="min-h-[50vh] py-16"
      />
    );
  }

  if (status !== "authenticated" || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!roles.includes(user.role)) {
    return <Navigate to={getDashboardPath(user.role)} replace />;
  }

  return children;
};

export default RoleProtectedRoute;
