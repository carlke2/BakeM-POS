import { useEffect, useState } from "react";
import { User } from "lucide-react";
import API from "@/services/api";
import { useAuth } from "@/context/AuthContext";

const UserProfile = () => {
  const { user } = useAuth();
  const role = user?.role || "";
  const [profile, setProfile] = useState<Record<string, any>>({});
  const name = user?.name || localStorage.getItem("userName") || "User";

  useEffect(() => {
    const load = async () => {
      try {
        if (role === "owner") {
          const { data } = await API.get("/admin/profile");
          setProfile(data);
        } else {
          const { data } = await API.get("/auth/session");
          if (data?.user) setProfile(data.user);
        }
      } catch {
        /* profile endpoint may not exist for all roles */
      }
    };
    load();
  }, [role]);

  const fields = [
    { label: "Name", value: profile.name || name },
    ...(profile.email || user?.email
      ? [{ label: "Email", value: profile.email || user?.email }]
      : []),
    {
      label: "Role",
      value: role === "owner" ? "Owner" : role === "cashier" ? "Cashier" : role,
    },
    ...(profile.phone ? [{ label: "Phone", value: profile.phone }] : []),
  ];

  return (
    <div className="p-4 md:p-8 bg-[#E8F6EC] min-h-screen font-sans">
      <div className="max-w-lg mx-auto">
        <div className="bg-[#39B54A] text-white rounded-2xl p-6 mb-6 text-center">
          <div className="w-20 h-20 rounded-full bg-white text-[#39B54A] flex items-center justify-center font-bold text-3xl mx-auto mb-3">
            {name.charAt(0).toUpperCase()}
          </div>
          <h2 className="text-2xl font-bold flex items-center justify-center gap-2">
            <User size={22} /> My Profile
          </h2>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 divide-y">
          {fields.map((f) => (
            <div key={f.label} className="px-5 py-4 flex justify-between">
              <span className="text-sm text-gray-500">{f.label}</span>
              <span className="text-sm font-semibold text-[#39B54A]">{f.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default UserProfile;
