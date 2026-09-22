import { Navigate } from "react-router-dom";
import Loader from "@/components/ui/loader";
import { getDashboardPath, useAuth } from "@/context/AuthContext";

const GuestRoute = ({ children }: { children: JSX.Element }) => {
  const { status, user } = useAuth();

  if (status === "loading") {
    return (
      <Loader
        size="sm"
        title="Loading..."
        subtitle="Checking your session"
        className="min-h-screen py-24"
      />
    );
  }

  if (status === "authenticated" && user) {
    return <Navigate to={getDashboardPath(user.role)} replace />;
  }

  return children;
};

export default GuestRoute;
