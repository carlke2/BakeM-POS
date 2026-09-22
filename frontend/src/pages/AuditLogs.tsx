import React, { useEffect, useState } from "react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import Loader from "@/components/ui/loader";
import {
  Search,
  Filter,
  Shield,
  User,
  GraduationCap,
  CreditCard,
  BookOpen,
  FileText,
  Clock,
  RefreshCw,
} from "lucide-react";

interface AuditEvent {
  _id: string;
  eventType: string;
  userType: string;
  userId?: string;
  userName: string;
  userEmail?: string;
  action: string;
  description?: string;
  metadata?: any;
  ipAddress?: string;
  userAgent?: string;
  timestamp: string;
  createdAt: string;
}

interface AuditData {
  events: AuditEvent[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
  stats: {
    total: number;
    byEventType: Array<{ _id: string; count: number }>;
    byUserType: Array<{ _id: string; count: number }>;
    today: number;
    recentLogins: number;
  };
}

const AuditLogs: React.FC = () => {
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    eventType: "",
    userType: "",
    startDate: "",
    endDate: "",
    search: "",
    page: 1,
  });

  const authHeader = { Authorization: `Bearer ${localStorage.getItem("token")}` };

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.eventType) params.append("eventType", filters.eventType);
      if (filters.userType) params.append("userType", filters.userType);
      if (filters.startDate) params.append("startDate", filters.startDate);
      if (filters.endDate) params.append("endDate", filters.endDate);
      if (filters.search) params.append("search", filters.search);
      params.append("page", String(filters.page));
      params.append("limit", "50");

      const { data } = await API.get(`/audit/events?${params.toString()}`, { headers: authHeader });
      setData(data);
    } catch (error: any) {
      toast.error("Failed to load audit logs", error.response?.data?.message || error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchEvents, 30000);
    return () => clearInterval(interval);
  }, [filters.page, filters.eventType, filters.userType, filters.startDate, filters.endDate, filters.search]);

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case "login":
        return <User className="text-blue-600" size={18} />;
      case "payment":
        return <CreditCard className="text-green-600" size={18} />;
      case "enrollment":
        return <BookOpen className="text-purple-600" size={18} />;
      case "course_created":
      case "course_updated":
      case "course_deleted":
        return <BookOpen className="text-indigo-600" size={18} />;
      case "student_created":
      case "student_updated":
      case "student_deleted":
        return <GraduationCap className="text-blue-600" size={18} />;
      case "staff_created":
      case "staff_updated":
      case "staff_deleted":
        return <Shield className="text-purple-600" size={18} />;
      default:
        return <FileText className="text-gray-600" size={18} />;
    }
  };

  const getEventBadgeColor = (eventType: string) => {
    if (eventType.includes("login")) return "bg-blue-100 text-blue-700";
    if (eventType.includes("payment")) return "bg-green-100 text-green-700";
    if (eventType.includes("created")) return "bg-green-100 text-green-700";
    if (eventType.includes("updated")) return "bg-yellow-100 text-yellow-700";
    if (eventType.includes("deleted")) return "bg-red-100 text-red-700";
    return "bg-gray-100 text-gray-700";
  };

  const getUserTypeBadge = (userType: string) => {
    const colors = {
      admin: "bg-indigo-100 text-indigo-700",
      staff: "bg-purple-100 text-purple-700",
      student: "bg-blue-100 text-blue-700",
    };
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${colors[userType as keyof typeof colors] || "bg-gray-100 text-gray-700"}`}>
        {userType}
      </span>
    );
  };

  return (
    <div className="max-w-7xl mx-auto mt-10 bg-white p-6 rounded-xl shadow-sm border">
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-gray-800">Audit Logs</h2>
          <p className="text-sm text-gray-500 mt-1">Real-time system activity monitoring</p>
        </div>
        <button
          onClick={fetchEvents}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
        >
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>

      {/* Statistics Cards */}
      {data?.stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-blue-50 p-4 rounded-lg border border-black/10">
            <p className="text-sm text-gray-600 mb-1">Total Events</p>
            <p className="text-2xl font-bold text-black">{data.stats.total.toLocaleString()}</p>
          </div>
          <div className="bg-blue-50 p-4 rounded-lg border border-black/10">
            <p className="text-sm text-gray-600 mb-1">Today's Events</p>
            <p className="text-2xl font-bold text-black">{data.stats.today}</p>
          </div>
          <div className="bg-blue-50 p-4 rounded-lg border border-black/10">
            <p className="text-sm text-gray-600 mb-1">Recent Logins (24h)</p>
            <p className="text-2xl font-bold text-black">{data.stats.recentLogins}</p>
          </div>
          <div className="bg-blue-50 p-4 rounded-lg border border-black/10">
            <p className="text-sm text-gray-600 mb-1">Current Page</p>
            <p className="text-2xl font-bold text-black">
              {data.pagination.page} / {data.pagination.pages}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-gray-50 p-4 rounded-lg mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter size={18} className="text-gray-600" />
          <span className="font-semibold text-gray-700">Filters</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search events..."
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })}
              className="pl-10 pr-4 py-2 border rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <select
            value={filters.eventType}
            onChange={(e) => setFilters({ ...filters, eventType: e.target.value, page: 1 })}
            className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Event Types</option>
            <option value="login">Login</option>
            <option value="logout">Logout</option>
            <option value="payment">Payment</option>
            <option value="enrollment">Enrollment</option>
            <option value="course_created">Course Created</option>
            <option value="student_created">Student Created</option>
            <option value="staff_created">Staff Created</option>
            <option value="budget_created">Budget Created</option>
          </select>
          <select
            value={filters.userType}
            onChange={(e) => setFilters({ ...filters, userType: e.target.value, page: 1 })}
            className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All User Types</option>
            <option value="admin">Admin</option>
            <option value="staff">Staff</option>
            <option value="student">Student</option>
          </select>
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => setFilters({ ...filters, startDate: e.target.value, page: 1 })}
            className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Start Date"
          />
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => setFilters({ ...filters, endDate: e.target.value, page: 1 })}
            className="border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="End Date"
          />
        </div>
      </div>

      {/* Events Table */}
      <div className="overflow-x-auto border rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-700 text-left">
            <tr>
              <th className="px-4 py-3 border-b">Time</th>
              <th className="px-4 py-3 border-b">Event Type</th>
              <th className="px-4 py-3 border-b">User</th>
              <th className="px-4 py-3 border-b">User Type</th>
              <th className="px-4 py-3 border-b">Action</th>
              <th className="px-4 py-3 border-b">IP Address</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-6">
                  <Loader size="sm" title="Loading audit logs..." subtitle="Fetching security events" className="py-4" />
                </td>
              </tr>
            ) : !data || data.events.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center p-6 text-gray-500 italic">
                  No audit events found.
                </td>
              </tr>
            ) : (
              data.events.map((event) => (
                <tr key={event._id} className="border-b hover:bg-gray-50 transition">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Clock size={14} className="text-gray-400" />
                      <span className="text-gray-600">
                        {new Date(event.timestamp).toLocaleString()}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {getEventIcon(event.eventType)}
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getEventBadgeColor(event.eventType)}`}>
                        {event.eventType.replace(/_/g, " ")}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <div className="font-medium text-gray-900">{event.userName || "Unknown"}</div>
                      {event.userEmail && (
                        <div className="text-xs text-gray-500">{event.userEmail}</div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">{getUserTypeBadge(event.userType)}</td>
                  <td className="px-4 py-3">
                    <div>
                      <div className="font-medium text-gray-900">{event.action}</div>
                      {event.description && (
                        <div className="text-xs text-gray-500 mt-1">{event.description}</div>
                      )}
                      {event.metadata && Object.keys(event.metadata).length > 0 && (
                        <details className="mt-1">
                          <summary className="text-xs text-indigo-600 cursor-pointer">View details</summary>
                          <pre className="text-xs mt-1 p-2 bg-gray-100 rounded overflow-auto max-w-md">
                            {JSON.stringify(event.metadata, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-gray-600">{event.ipAddress || "N/A"}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.pagination.pages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <div className="text-sm text-gray-600">
            Showing {((data.pagination.page - 1) * data.pagination.limit) + 1} to{" "}
            {Math.min(data.pagination.page * data.pagination.limit, data.pagination.total)} of{" "}
            {data.pagination.total} events
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setFilters({ ...filters, page: Math.max(1, filters.page - 1) })}
              disabled={filters.page === 1}
              className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
              disabled={filters.page >= data.pagination.pages}
              className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Event Type Statistics */}
      {data?.stats.byEventType && data.stats.byEventType.length > 0 && (
        <div className="mt-6 bg-gray-50 p-4 rounded-lg">
          <h3 className="font-semibold text-gray-800 mb-3">Events by Type</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.stats.byEventType.map((item) => (
              <div key={item._id} className="bg-white p-3 rounded border">
                <div className="text-xs text-gray-600 mb-1">{item._id.replace(/_/g, " ")}</div>
                <div className="text-lg font-bold text-gray-900">{item.count}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditLogs;


