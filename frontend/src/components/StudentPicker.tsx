import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import API from "@/services/api";

export type StudentOption = {
  id: string;
  name: string;
  regNo: string;
  walletBalance?: number;
};

const formatKes = (n: number) => `KES ${Number(n || 0).toLocaleString()}`;

const StudentPicker = ({
  selected,
  onSelect,
  onClear,
}: {
  selected: StudentOption | null;
  onSelect: (student: StudentOption) => void;
  onClear: () => void;
}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentOption[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (selected) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await API.get<StudentOption[]>("/students/search", { params: { q } });
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [query, selected]);

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
        <div>
          <p className="font-semibold text-[#0A1F44]">{selected.name}</p>
          <p className="text-xs text-gray-600">
            {selected.regNo}
            {selected.walletBalance != null && ` · Balance: ${formatKes(selected.walletBalance)}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="text-xs font-semibold text-gray-500 hover:text-rose-600"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search student by name, adm no, or phone..."
          className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0A1F44] outline-none"
        />
      </div>
      {searching && <p className="text-xs text-gray-400">Searching...</p>}
      {results.length > 0 && (
        <div className="border border-gray-100 rounded-lg max-h-40 overflow-y-auto">
          {results.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s)}
              className="w-full text-left px-3 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0"
            >
              <p className="font-semibold text-sm text-[#0A1F44]">{s.name}</p>
              <p className="text-xs text-gray-500">
                {s.regNo}
                {s.walletBalance != null && ` · ${formatKes(s.walletBalance)}`}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default StudentPicker;
