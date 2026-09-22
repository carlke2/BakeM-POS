import { Navigate, useLocation } from "react-router-dom";
import Loader from "@/components/ui/loader";
import { useAuth } from "@/context/AuthContext";

const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const { status } = useAuth();
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

  if (status !== "authenticated") {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

export default ProtectedRoute;
