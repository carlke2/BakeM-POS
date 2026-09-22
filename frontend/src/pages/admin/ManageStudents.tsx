import React, { useEffect, useMemo, useState } from "react";
import { GraduationCap, Plus, Edit, Trash2, X, Eye, Fingerprint, Search, KeyRound, Wallet, FileSpreadsheet, FileText, CalendarDays } from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import Loader from "@/components/ui/loader";
import WalletAdjustModal from "@/components/WalletAdjustModal";
import { captureFingerprint, checkScannerHealth, prepareScanner, checkFingerprintDuplicate } from "@/services/fingerprintScanner";
import {
  downloadStudentsExcel,
  downloadStudentsPdf,
  filterOnboardedOnDay,
  formatMoney,
  isRegistrationFeeEligible,
  parseLocalDateInput,
  REGISTRATION_FEE_KES,
  toLocalDateInput,
} from "@/lib/studentOnboardingExport";

const COURSE_OPTIONS = [
  "Diploma Water Engineering",
  "Water Resource and Technology",
];

const RELATIONSHIP_OPTIONS = [
  { value: "father", label: "Father" },
  { value: "mother", label: "Mother" },
  { value: "guardian", label: "Guardian" },
  { value: "sibling", label: "Sibling" },
  { value: "other", label: "Other" },
];

const emptyStudent = {
  name: "",
  regNo: "",
  phone: "",
  email: "",
  gender: "",
  dateOfBirth: "",
  course: "",
  className: "",
  category: "regular",
  password: "",
  parentRelationship: "father",
  parentName: "",
  parentPhone: "",
  parentReceiveSms: true,
  parentReceiveEmail: true,
  fingerprintTemplate: "",
  hasFingerprint: false,
};

const inputCls = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#0A1F44] outline-none";
const labelCls = "block text-xs font-medium text-gray-600 mb-1";
const sectionCls = "text-xs font-bold text-[#0A1F44] uppercase tracking-wide";

const formatDateInput = (value?: string | null) => {
  if (!value) return "";
  return value.slice(0, 10);
};

const ManageStudents: React.FC = () => {
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [studentForm, setStudentForm] = useState(emptyStudent);
  const [viewItem, setViewItem] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [scannerReady, setScannerReady] = useState<boolean | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [validatingFingerprint, setValidatingFingerprint] = useState(false);
  const [pinStudent, setPinStudent] = useState<any>(null);
  const [pinSettings, setPinSettings] = useState<{ pinEnabled: boolean } | null>(null);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinSaving, setPinSaving] = useState(false);
  const [walletStudent, setWalletStudent] = useState<any>(null);
  /** Empty = all students; otherwise `YYYY-MM-DD` onboarded date filter. */
  const [onboardedDate, setOnboardedDate] = useState("");

  const selectedOnboardedDay = useMemo(
    () => (onboardedDate ? parseLocalDateInput(onboardedDate) : null),
    [onboardedDate],
  );
  const isDateFiltered = Boolean(selectedOnboardedDay);
  const isOnboardedToday =
    Boolean(selectedOnboardedDay) &&
    toLocalDateInput(selectedOnboardedDay!) === toLocalDateInput();

  const filteredStudents = useMemo(() => {
    let list = students;
    if (selectedOnboardedDay) {
      list = filterOnboardedOnDay(list, selectedOnboardedDay);
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) => {
      const haystack = [
        s.name,
        s.regNo,
        s.course,
        s.className,
        s.category,
        s.email,
        s.phone,
        s.gender,
        s.parent?.name,
        s.parent?.phone,
        s.parentRelationship,
        s.hasFingerprint ? "enrolled fingerprint" : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [students, searchQuery, selectedOnboardedDay]);

  const onboardedOnSelectedCount = useMemo(() => {
    if (!selectedOnboardedDay) return 0;
    return filterOnboardedOnDay(students, selectedOnboardedDay).length;
  }, [students, selectedOnboardedDay]);

  const collectionTotals = useMemo(() => {
    const walletTotal = filteredStudents.reduce(
      (sum, s) => sum + Number(s.walletBalance || 0),
      0,
    );
    const feeEligibleCount = filteredStudents.filter((s) =>
      isRegistrationFeeEligible(s.createdAt),
    ).length;
    const registrationFeesTotal = feeEligibleCount * REGISTRATION_FEE_KES;
    return {
      students: filteredStudents.length,
      feeEligibleCount,
      walletTotal,
      registrationFeesTotal,
      collectedTotal: walletTotal + registrationFeesTotal,
    };
  }, [filteredStudents]);

  const exportFiltered = (format: "excel" | "pdf") => {
    if (filteredStudents.length === 0) {
      toast.warning("Nothing to export", "No students match the current filter");
      return;
    }
    const dayLabel = selectedOnboardedDay
      ? selectedOnboardedDay.toLocaleDateString()
      : "";
    const title = isDateFiltered
      ? `Students onboarded on ${dayLabel}`
      : "Students list";
    const filenamePrefix = isDateFiltered
      ? `students-onboarded-${onboardedDate}`
      : "students-list";
    const exportOpts = {
      title,
      filenamePrefix,
      totals: {
        walletTotal: collectionTotals.walletTotal,
        registrationFeesTotal: collectionTotals.registrationFeesTotal,
        collectedTotal: collectionTotals.collectedTotal,
      },
    };
    try {
      if (format === "excel") {
        downloadStudentsExcel(filteredStudents, exportOpts);
      } else {
        downloadStudentsPdf(filteredStudents, exportOpts);
      }
      toast.success(
        format === "excel" ? "Excel downloaded" : "PDF downloaded",
        `${filteredStudents.length} student(s) exported`,
      );
    } catch (e: any) {
      toast.error("Export failed", e?.message || "Could not generate file");
    }
  };

  const setField = <K extends keyof typeof emptyStudent>(key: K, value: (typeof emptyStudent)[K]) => {
    setStudentForm((f) => ({ ...f, [key]: value }));
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      // Backend GET /students also backfills fees; POST ensures a forced pass.
      try {
        const ensure = await API.post("/students/registration-fees/ensure");
        if (ensure.data?.applied > 0) {
          toast.success(
            "Registration fees applied",
            `Deducted KES ${ensure.data.fee || 500} from ${ensure.data.applied} student wallet(s)`,
          );
        }
      } catch {
        // Non-blocking: list still loads even if fee backfill fails
      }
      const { data } = await API.get("/students");
      setStudents(data);
    } catch (e: any) {
      toast.error("Failed to load students", e.response?.data?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    if (!showForm) return;
    checkScannerHealth()
      .then((h) => {
        setScannerReady(h.deviceConnected);
        if (h.deviceConnected) return prepareScanner();
      })
      .catch(() => setScannerReady(false));
  }, [showForm]);

  const closeForm = () => {
    setShowForm(false);
    setEditId(null);
    setStudentForm(emptyStudent);
  };

  const saveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentForm.gender) {
      toast.error("Validation", "Please select a gender");
      return;
    }
    if (!studentForm.parentName.trim() || !studentForm.parentPhone.trim()) {
      toast.error("Validation", "Primary parent name and phone are required");
      return;
    }

    try {
      const payload: any = {
        name: studentForm.name.trim(),
        regNo: studentForm.regNo.trim() || undefined,
        phone: studentForm.phone.trim() || null,
        email: studentForm.email.trim() || null,
        gender: studentForm.gender,
        dateOfBirth: studentForm.dateOfBirth || null,
        course: studentForm.course || null,
        className: studentForm.className || null,
        category: studentForm.category || "regular",
        parentRelationship: studentForm.parentRelationship || null,
        parent: {
          name: studentForm.parentName.trim(),
          phone: studentForm.parentPhone.trim(),
          receiveSms: studentForm.parentReceiveSms,
          receiveEmail: studentForm.parentReceiveEmail,
        },
      };

      if (studentForm.fingerprintTemplate) {
        payload.fingerprintTemplate = studentForm.fingerprintTemplate;
      }

      if (editId) {
        const body: any = { ...payload };
        if (studentForm.password) body.password = studentForm.password;
        await API.put(`/students/${editId}`, body);
      } else {
        if (studentForm.password) payload.password = studentForm.password;
        await API.post("/students", payload);
      }
      toast.success(editId ? "Updated" : "Added");
      closeForm();
      fetchData();
    } catch (e: any) {
      toast.error("Operation failed", e.response?.data?.message);
    }
  };

  const handleCaptureFingerprint = async () => {
    setCapturing(true);
    try {
      await prepareScanner();
      const template = await captureFingerprint();

      setStudentForm((f) => ({ ...f, fingerprintTemplate: template, hasFingerprint: true }));
      toast.success("Fingerprint captured", "Checking for duplicates…");

      setValidatingFingerprint(true);
      const fast = await checkFingerprintDuplicate(template, editId || undefined, {
        biometric: false,
      });
      if (fast.unique === false) {
        setStudentForm((f) => ({ ...f, fingerprintTemplate: "", hasFingerprint: false }));
        toast.error("Fingerprint already enrolled", fast.message);
        return;
      }

      toast.success("Fingerprint ready", "Save the student to store the template");

      checkFingerprintDuplicate(template, editId || undefined, { biometric: true })
        .then((full) => {
          if (full.unique === false) {
            setStudentForm((f) => ({ ...f, fingerprintTemplate: "", hasFingerprint: false }));
            toast.error("Fingerprint already enrolled", full.message);
          }
        })
        .catch(() => {});
    } catch (e: any) {
      const msg = e.response?.data?.message || e.message;
      toast.error("Capture failed", msg);
      setScannerReady(false);
    } finally {
      setCapturing(false);
      setValidatingFingerprint(false);
    }
  };

  const clearFingerprint = () => setStudentForm((f) => ({ ...f, fingerprintTemplate: "" }));

  const removeStoredFingerprint = async () => {
    if (!editId) return;
    const r = await toast.confirm("Remove stored fingerprint?", { confirmLabel: "Remove" });
    if (!r) return;
    try {
      await API.delete(`/students/${editId}/fingerprint`);
      setStudentForm((f) => ({ ...f, fingerprintTemplate: "", hasFingerprint: false }));
      toast.success("Fingerprint removed");
      fetchData();
    } catch (e: any) {
      toast.error("Failed to remove fingerprint", e.response?.data?.message);
    }
  };

  const editStudent = (s: any) => {
    setEditId(s._id || s.id);
    setStudentForm({
      name: s.name,
      regNo: s.regNo,
      phone: s.phone || "",
      email: s.email || "",
      gender: s.gender || "",
      dateOfBirth: formatDateInput(s.dateOfBirth),
      course: s.course || "",
      className: s.className || "",
      category: s.category || "regular",
      password: "",
      parentRelationship: s.parentRelationship || "father",
      parentName: s.parent?.name || "",
      parentPhone: s.parent?.phone || "",
      parentReceiveSms: s.parent?.receiveSms !== false,
      parentReceiveEmail: s.parent?.receiveEmail !== false,
      fingerprintTemplate: "",
      hasFingerprint: Boolean(s.hasFingerprint),
    });
    setShowForm(true);
  };

  const deleteStudent = async (id: string) => {
    const r = await toast.confirm("Delete student?", { confirmLabel: "Delete" });
    if (!r) return;
    await API.delete(`/students/${id}`);
    fetchData();
  };

  const openPinModal = async (student: any) => {
    setPinStudent(student);
    setPinSettings(null);
    setPinLoading(true);
    try {
      const { data } = await API.get(`/students/${student._id || student.id}/wallet-settings`);
      setPinSettings({ pinEnabled: Boolean(data.pinEnabled) });
    } catch (e: any) {
      toast.error("Failed to load wallet PIN", e.response?.data?.message);
      setPinStudent(null);
    } finally {
      setPinLoading(false);
    }
  };

  const closePinModal = () => {
    setPinStudent(null);
    setPinSettings(null);
  };

  const setStudentPin = async () => {
    if (!pinStudent) return;
    const pin = window.prompt("Enter new 4-digit wallet PIN");
    if (!pin) return;
    setPinSaving(true);
    try {
      const { data } = await API.put(`/students/${pinStudent._id || pinStudent.id}/wallet-settings`, { pin });
      setPinSettings({ pinEnabled: Boolean(data.pinEnabled) });
      toast.success("Wallet PIN updated");
    } catch (e: any) {
      toast.error("Update failed", e.response?.data?.message);
    } finally {
      setPinSaving(false);
    }
  };

  const resetStudentPin = async () => {
    if (!pinStudent) return;
    const ok = await toast.confirm("Reset wallet PIN to default (1234)?", { confirmLabel: "Reset" });
    if (!ok) return;
    setPinSaving(true);
    try {
      const { data } = await API.put(`/students/${pinStudent._id || pinStudent.id}/wallet-settings`, { resetPin: true });
      setPinSettings({ pinEnabled: Boolean(data.pinEnabled) });
      toast.success("Wallet PIN reset to 1234");
    } catch (e: any) {
      toast.error("Reset failed", e.response?.data?.message);
    } finally {
      setPinSaving(false);
    }
  };

  const backfillDefaultPins = async () => {
    const ok = await toast.confirm(
      "Set default PIN (1234) for all students without a wallet PIN?",
      { confirmLabel: "Apply to all" },
    );
    if (!ok) return;
    try {
      const { data } = await API.post("/students/wallet-pins/backfill-default");
      toast.success("Default PINs applied", data.message);
      fetchData();
    } catch (e: any) {
      toast.error("Backfill failed", e.response?.data?.message);
    }
  };

  return (
    <div className="p-4 md:p-8 bg-[#E8F4FD] min-h-screen font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-[#0A1F44] text-white rounded-2xl p-6">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GraduationCap size={28} /> Students
          </h1>
          <p className="text-blue-200 text-sm mt-1">Add and manage student accounts, wallets, and fingerprints</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex flex-col gap-4 p-5 border-b border-gray-100">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="font-bold text-[#0A1F44]">All Students</h2>
                {isDateFiltered && selectedOnboardedDay && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    Showing {filteredStudents.length} onboarded on{" "}
                    {selectedOnboardedDay.toLocaleDateString()}
                    {searchQuery.trim() ? " (with search)" : ""}
                    {" · "}
                    {onboardedOnSelectedCount} total that day
                    {isOnboardedToday ? " (today)" : ""}
                  </p>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-3 sm:items-center w-full sm:w-auto">
                <div className="relative flex-1 sm:w-72">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search students, admission no, parent..."
                    className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0A1F44] outline-none"
                  />
                </div>
                <button onClick={() => { closeForm(); setShowForm(true); }} className="flex items-center justify-center gap-2 bg-[#0A1F44] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#0A1F44]/90">
                  <Plus size={16} /> Add Student
                </button>
                <button onClick={backfillDefaultPins} className="flex items-center justify-center gap-2 bg-white border border-gray-200 text-[#0A1F44] px-4 py-2 rounded-xl text-sm font-semibold hover:bg-gray-50">
                  <KeyRound size={16} /> Default PINs
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <CalendarDays size={14} /> Onboarded
                </span>
                <div className="inline-flex rounded-xl border border-gray-200 overflow-hidden text-sm">
                  <button
                    type="button"
                    onClick={() => setOnboardedDate("")}
                    className={`px-3 py-1.5 font-medium transition ${
                      !isDateFiltered
                        ? "bg-[#0A1F44] text-white"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setOnboardedDate(toLocalDateInput())}
                    className={`px-3 py-1.5 font-medium transition border-l border-gray-200 ${
                      isOnboardedToday
                        ? "bg-[#0A1F44] text-white"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    Today
                  </button>
                </div>
                <input
                  type="date"
                  value={onboardedDate}
                  onChange={(e) => setOnboardedDate(e.target.value)}
                  className="px-3 py-1.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0A1F44] outline-none"
                  title="Filter by onboarded date"
                />
                {isDateFiltered && (
                  <span className="text-xs text-gray-400">
                    ({onboardedOnSelectedCount})
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => exportFiltered("excel")}
                  disabled={filteredStudents.length === 0}
                  className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Export filtered list to Excel"
                >
                  <FileSpreadsheet size={15} /> Excel
                </button>
                <button
                  type="button"
                  onClick={() => exportFiltered("pdf")}
                  disabled={filteredStudents.length === 0}
                  className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold border border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Export filtered list to PDF"
                >
                  <FileText size={15} /> PDF
                </button>
              </div>
            </div>

            {filteredStudents.length > 0 && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
                <div className="rounded-xl border border-gray-100 bg-slate-50 px-3 py-2.5">
                  <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">
                    {isDateFiltered ? "Students" : "All students"}
                  </p>
                  <p className="text-lg font-bold text-[#0A1F44]">{collectionTotals.students}</p>
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2.5">
                  <p className="text-[11px] uppercase tracking-wide text-amber-700/70 font-semibold">Registration fees</p>
                  <p className="text-lg font-bold text-amber-800">
                    KES {formatMoney(collectionTotals.registrationFeesTotal)}
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2.5">
                  <p className="text-[11px] uppercase tracking-wide text-emerald-700/70 font-semibold">Wallet balances</p>
                  <p className="text-lg font-bold text-emerald-800">
                    KES {formatMoney(collectionTotals.walletTotal)}
                  </p>
                </div>
                <div className="rounded-xl border border-[#0A1F44]/15 bg-[#0A1F44]/5 px-3 py-2.5">
                  <p className="text-[11px] uppercase tracking-wide text-[#0A1F44]/60 font-semibold">Total collected</p>
                  <p className="text-lg font-bold text-[#0A1F44]">
                    KES {formatMoney(collectionTotals.collectedTotal)}
                  </p>
                </div>
              </div>
            )}
          </div>

          {loading ? (
            <Loader size="sm" title="Loading students..." subtitle="Fetching student records" className="py-8" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-3 text-left">Student</th>
                    <th className="px-4 py-3 text-left">Admission / Course</th>
                    <th className="px-4 py-3 text-center">Fingerprint</th>
                    <th className="px-4 py-3 text-left">Parent</th>
                    <th className="px-4 py-3 text-right">Registration Fee</th>
                    <th className="px-4 py-3 text-right">Wallet</th>
                    <th className="px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {students.length === 0 ? (
                    <tr><td colSpan={7} className="p-8 text-center text-gray-400">No students yet</td></tr>
                  ) : filteredStudents.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-gray-400">
                        {isDateFiltered
                          ? `No students were onboarded on ${selectedOnboardedDay?.toLocaleDateString()}`
                          : "No students match your search"}
                      </td>
                    </tr>
                  ) : filteredStudents.map((s) => (
                    <tr key={s._id || s.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-900">{s.name}</p>
                        <p className="text-xs text-gray-400 capitalize">{s.gender}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{s.regNo}</p>
                        <p className="text-gray-500">{s.course || "-"}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {s.hasFingerprint ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                            <Fingerprint size={12} /> Enrolled
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        <p>{s.parent?.name || "-"}</p>
                        {s.parent?.phone && (
                          <p className="text-xs text-gray-400">{s.parent.phone}</p>
                        )}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-medium ${
                          isRegistrationFeeEligible(s.createdAt)
                            ? "text-amber-700"
                            : "text-gray-400"
                        }`}
                      >
                        {isRegistrationFeeEligible(s.createdAt)
                          ? `KES ${formatMoney(REGISTRATION_FEE_KES)}`
                          : "N/A"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-green-600">
                        KES {formatMoney(Number(s.walletBalance || 0))}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-center gap-1">
                          <button onClick={() => setViewItem(s)} className="p-2 text-gray-400 hover:text-blue-600"><Eye size={16} /></button>
                          <button onClick={() => setWalletStudent(s)} className="p-2 text-gray-400 hover:text-emerald-600" title="Update wallet"><Wallet size={16} /></button>
                          <button onClick={() => openPinModal(s)} className="p-2 text-gray-400 hover:text-indigo-600" title="Wallet PIN"><KeyRound size={16} /></button>
                          <button onClick={() => editStudent(s)} className="p-2 text-gray-400 hover:text-amber-600"><Edit size={16} /></button>
                          <button onClick={() => deleteStudent(s._id || s.id)} className="p-2 text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex justify-between items-center mb-5">
              <h3 className="font-bold text-[#0A1F44] text-lg">{editId ? "Edit Student" : "Add Student"}</h3>
              <button onClick={closeForm} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            <form onSubmit={saveStudent} className="space-y-6">
              <section className="space-y-3">
                <p className={sectionCls}>Student Information</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Full Name <span className="text-red-500">*</span></label>
                    <input className={inputCls} placeholder="Student full name" value={studentForm.name} onChange={(e) => setField("name", e.target.value)} required />
                  </div>
                  <div>
                    <label className={labelCls}>Admission No</label>
                    <input className={inputCls} placeholder="Auto-generated if empty" value={studentForm.regNo} onChange={(e) => setField("regNo", e.target.value)} disabled={!!editId} />
                  </div>
                  <div>
                    <label className={labelCls}>Date of Birth</label>
                    <input type="date" className={inputCls} value={studentForm.dateOfBirth} onChange={(e) => setField("dateOfBirth", e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Gender <span className="text-red-500">*</span></label>
                    <select className={inputCls} value={studentForm.gender} onChange={(e) => setField("gender", e.target.value)} required>
                      <option value="">Select…</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Course</label>
                    <select className={inputCls} value={studentForm.course} onChange={(e) => setField("course", e.target.value)}>
                      <option value="">Select…</option>
                      {COURSE_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Class</label>
                    <input
                      className={inputCls}
                      placeholder="e.g. Year 1 / Form 2 / Grade 6"
                      value={studentForm.className}
                      onChange={(e) => setField("className", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Category</label>
                    <select className={inputCls} value={studentForm.category} onChange={(e) => setField("category", e.target.value)}>
                      <option value="regular">Regular</option>
                      <option value="sponsored">Sponsored</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Student Phone <span className="text-gray-400 font-normal">(optional)</span></label>
                    <input className={inputCls} placeholder="e.g. 0712345678" value={studentForm.phone} onChange={(e) => setField("phone", e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Student Email</label>
                    <input type="email" className={inputCls} placeholder="e.g. student@email.com" value={studentForm.email} onChange={(e) => setField("email", e.target.value)} />
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <p className={sectionCls}>Parents / Guardians</p>
                <p className="text-sm font-semibold text-gray-700">Primary Parent/Guardian</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Name <span className="text-red-500">*</span></label>
                    <input className={inputCls} placeholder="Parent/Guardian name" value={studentForm.parentName} onChange={(e) => setField("parentName", e.target.value)} required />
                  </div>
                  <div>
                    <label className={labelCls}>Phone <span className="text-red-500">*</span></label>
                    <input className={inputCls} placeholder="0712345678" value={studentForm.parentPhone} onChange={(e) => setField("parentPhone", e.target.value)} required />
                  </div>
                  <div>
                    <label className={labelCls}>Relationship</label>
                    <select className={inputCls} value={studentForm.parentRelationship} onChange={(e) => setField("parentRelationship", e.target.value)}>
                      {RELATIONSHIP_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <p className={labelCls}>Communication Preferences</p>
                    <div className="flex flex-wrap gap-4 mt-1">
                      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input type="checkbox" checked={studentForm.parentReceiveSms} onChange={(e) => setField("parentReceiveSms", e.target.checked)} className="rounded border-gray-300" />
                        Receive SMS
                      </label>
                      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                        <input type="checkbox" checked={studentForm.parentReceiveEmail} onChange={(e) => setField("parentReceiveEmail", e.target.checked)} className="rounded border-gray-300" />
                        Receive Email
                      </label>
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <p className={sectionCls}>Account Access</p>
                <div>
                  <label className={labelCls}>
                    {editId ? "New password (leave blank to keep)" : "Password (optional - defaults to last 6 digits of admission no)"}
                  </label>
                  <input type="password" className={inputCls} value={studentForm.password} onChange={(e) => setField("password", e.target.value)} minLength={7} />
                </div>
              </section>

              <section className="rounded-xl border border-gray-200 p-4 space-y-3 bg-gray-50">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#0A1F44] flex items-center gap-2">
                    <Fingerprint size={16} /> Fingerprint Enrollment
                  </p>
                  {scannerReady === true && <span className="text-xs text-green-600 font-medium">Scanner connected</span>}
                  {scannerReady === false && <span className="text-xs text-amber-600 font-medium">Scanner offline</span>}
                </div>
                <p className="text-xs text-gray-500">
                  Run <code className="bg-white px-1 rounded">dotnet run</code> in FingerprintScanner on this PC, then capture during enrollment.
                </p>
                {(studentForm.fingerprintTemplate || studentForm.hasFingerprint) ? (
                  <div className="flex items-center justify-between gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    <span className="text-sm text-green-700 font-medium">
                      {studentForm.fingerprintTemplate ? "New fingerprint ready to save" : "Fingerprint on file"}
                    </span>
                    <div className="flex gap-2">
                      {editId && studentForm.hasFingerprint && !studentForm.fingerprintTemplate && (
                        <button type="button" onClick={removeStoredFingerprint} className="text-xs text-red-600 hover:underline">Remove</button>
                      )}
                      <button type="button" onClick={clearFingerprint} className="text-xs text-gray-600 hover:underline">Clear</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">No fingerprint captured yet (optional)</p>
                )}
                <button
                  type="button"
                  onClick={handleCaptureFingerprint}
                  disabled={capturing || validatingFingerprint || scannerReady === false}
                  className="w-full py-2.5 border-2 border-dashed border-[#0A1F44]/30 text-[#0A1F44] rounded-xl text-sm font-semibold hover:bg-white disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {capturing ? (
                    <><Loader size="xs" showText={false} className="mr-2" /> Place finger on scanner...</>
                  ) : validatingFingerprint ? (
                    <><Loader size="xs" showText={false} className="mr-2" /> Checking...</>
                  ) : (
                    <><Fingerprint size={16} /> Capture Fingerprint</>
                  )}
                </button>
              </section>

              <button type="submit" className="w-full py-3 bg-[#0A1F44] text-white rounded-xl font-semibold text-sm">
                {editId ? "Save Changes" : "Save Student"}
              </button>
            </form>
          </div>
        </div>
      )}

      {viewItem && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setViewItem(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg text-[#0A1F44] mb-4">{viewItem.name}</h3>
            <div className="space-y-2 text-sm">
              <p><span className="text-gray-500">Admission No:</span> {viewItem.regNo}</p>
              <p><span className="text-gray-500">Course:</span> {viewItem.course || "-"}</p>
              <p><span className="text-gray-500">Phone:</span> {viewItem.phone || "-"}</p>
              <p><span className="text-gray-500">Email:</span> {viewItem.email || "-"}</p>
              <p><span className="text-gray-500">Gender:</span> {viewItem.gender}</p>
              <p><span className="text-gray-500">Date of Birth:</span> {viewItem.dateOfBirth ? formatDateInput(viewItem.dateOfBirth) : "-"}</p>
              <p><span className="text-gray-500">Wallet:</span> KES {(viewItem.walletBalance || 0).toLocaleString()}</p>
              <p><span className="text-gray-500">Wallet PIN:</span> {viewItem.walletPinSetAt ? "Set" : "Not set"}</p>
              <p><span className="text-gray-500">Fingerprint:</span> {viewItem.hasFingerprint ? "Enrolled" : "Not enrolled"}</p>
              <p><span className="text-gray-500">Parent:</span> {viewItem.parent?.name || "None"}</p>
              {viewItem.parentRelationship && (
                <p><span className="text-gray-500">Relationship:</span> <span className="capitalize">{viewItem.parentRelationship}</span></p>
              )}
            </div>
            <button onClick={() => setViewItem(null)} className="w-full mt-4 py-2 bg-gray-100 rounded-xl text-sm font-medium">Close</button>
            <button
              onClick={() => {
                setWalletStudent(viewItem);
                setViewItem(null);
              }}
              className="w-full mt-2 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700"
            >
              Update wallet
            </button>
          </div>
        </div>
      )}

      {pinStudent && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={closePinModal}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="font-bold text-lg text-[#0A1F44] flex items-center gap-2">
                  <KeyRound size={18} /> Wallet PIN
                </h3>
                <p className="text-sm text-gray-500 mt-1">{pinStudent.name} · {pinStudent.regNo}</p>
              </div>
              <button onClick={closePinModal} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            {pinLoading ? (
              <Loader size="sm" title="Loading..." subtitle="Fetching wallet PIN status" className="py-6" />
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 text-sm">
                  <p className="text-gray-500">Status</p>
                  <p className="font-semibold text-[#0A1F44] mt-1">
                    {pinSettings?.pinEnabled ? "PIN is set" : "No PIN set"}
                  </p>
                  <p className="text-xs text-gray-400 mt-2">Default PIN for new students is <strong>1234</strong>.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={setStudentPin}
                    disabled={pinSaving}
                    className="py-2.5 bg-[#0A1F44] text-white rounded-xl text-sm font-semibold hover:bg-[#0A1F44]/90 disabled:opacity-50"
                  >
                    Set New PIN
                  </button>
                  <button
                    type="button"
                    onClick={resetStudentPin}
                    disabled={pinSaving}
                    className="py-2.5 bg-gray-100 text-gray-800 rounded-xl text-sm font-semibold hover:bg-gray-200 disabled:opacity-50"
                  >
                    Reset to 1234
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {walletStudent && (
        <WalletAdjustModal
          initialStudent={{
            id: walletStudent._id || walletStudent.id,
            name: walletStudent.name,
            regNo: walletStudent.regNo,
            walletBalance: walletStudent.walletBalance,
          }}
          onClose={() => setWalletStudent(null)}
          onSuccess={fetchData}
          title="Update student wallet"
          subtitle={`Adjust wallet for ${walletStudent.name}`}
        />
      )}
    </div>
  );
};

export default ManageStudents;
