import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardList,
  AlertTriangle,
  Plus,
  Pencil,
  Save,
  Trash2,
  List,
  Link2,
  ImagePlus,
  X,
  Loader2,
  Tags,
} from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";

export type Tab = "list" | "add" | "edit" | "update" | "delete" | "recipes" | "categories";

interface InventoryOption {
  id: string;
  name: string;
  unit: string;
  stockLevel: number;
}

interface RecipeRow {
  inventoryItemId: string;
  quantity: string;
}

interface MenuIngredient {
  id: string;
  quantity: number;
  inventoryItem: InventoryOption;
}

interface MenuCategory {
  id: string;
  name: string;
  sortOrder: number;
}

interface MenuItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  category: string;
  isAvailable: boolean;
  imageUrl?: string;
  stockLevel?: number | null;
  batchYield?: number | null;
  ingredients?: MenuIngredient[];
}

const EMPTY_FORM = { name: "", description: "", price: "", category: "", imageUrl: "", stockLevel: "" };

const TABS: { id: Tab; label: string; icon: React.FC<{ size?: number }> }[] = [
  { id: "list", label: "All Items", icon: List },
  { id: "categories", label: "Categories", icon: Tags },
  { id: "add", label: "Add", icon: Plus },
  { id: "edit", label: "Edit", icon: Pencil },
  { id: "update", label: "Update", icon: Save },
  { id: "delete", label: "Delete", icon: Trash2 },
  { id: "recipes", label: "Recipes", icon: Link2 },
];

type Props = {
  initialTab?: Tab;
  showTabs?: boolean;
};

// ─── ImageUploader ──────────────────────────────────────────────────────────
interface ImageUploaderProps {
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
}

const ImageUploader = ({ value, onChange, disabled }: ImageUploaderProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!file.type.match(/^image\/(jpeg|png|webp)$/)) {
        return toast.error("Invalid file", "Only jpg, png, and webp images are allowed");
      }
      if (file.size > 3 * 1024 * 1024) {
        return toast.error("File too large", "Maximum image size is 3 MB");
      }
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append("image", file);
        const { data } = await API.post<{ url: string }>("/menu/upload-image", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        onChange(data.url);
        toast.success("Image uploaded");
      } catch (e: any) {
        toast.error("Upload failed", e.response?.data?.message ?? e.message);
      } finally {
        setUploading(false);
      }
    },
    [onChange],
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
        Food Image (optional)
      </label>

      {value ? (
        <div className="relative w-full h-44 rounded-2xl overflow-hidden border border-slate-200 group">
          <img
            src={value}
            alt="Menu item"
            className="w-full h-full object-cover"
          />
          {/* overlay controls */}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
            <button
              type="button"
              disabled={disabled || uploading}
              onClick={() => !disabled && inputRef.current?.click()}
              className="px-3 py-1.5 bg-white/90 text-gray-800 rounded-lg text-xs font-bold hover:bg-white transition flex items-center gap-1.5"
            >
              <ImagePlus size={13} /> Change
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange("")}
              className="px-3 py-1.5 bg-red-600/90 text-white rounded-lg text-xs font-bold hover:bg-red-600 transition flex items-center gap-1.5"
            >
              <X size={13} /> Remove
            </button>
          </div>
        </div>
      ) : (
        <div
          onClick={() => !disabled && !uploading && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`w-full h-36 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-2 transition-all duration-200 cursor-pointer ${
            disabled
              ? "border-gray-100 bg-gray-50 cursor-not-allowed"
              : dragging
              ? "border-indigo-400 bg-indigo-50"
              : "border-slate-200 bg-gray-50/50 hover:border-indigo-300 hover:bg-indigo-50/30"
          }`}
        >
          {uploading ? (
            <>
              <Loader2 size={24} className="text-indigo-500 animate-spin" />
              <span className="text-xs text-indigo-600 font-semibold">Uploading...</span>
            </>
          ) : (
            <>
              <ImagePlus size={24} className={dragging ? "text-indigo-500" : "text-gray-300"} />
              <div className="text-center">
                <p className="text-xs font-bold text-gray-500">
                  {dragging ? "Drop to upload" : "Click or drag image here"}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">JPG, PNG, WEBP - max 3 MB</p>
              </div>
            </>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled || uploading}
      />
    </div>
  );
};

// ─── MenuManagement ──────────────────────────────────────────────────────────
const MenuManagement = ({ initialTab = "list", showTabs = true }: Props) => {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [inventory, setInventory] = useState<InventoryOption[]>([]);

  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState("");

  const [categoryForm, setCategoryForm] = useState({ name: "", sortOrder: "" });
  const [editingCategoryId, setEditingCategoryId] = useState("");
  const [categoryDraft, setCategoryDraft] = useState({ name: "", sortOrder: "" });
  const [deleteCategoryId, setDeleteCategoryId] = useState("");

  const [recipeMenuId, setRecipeMenuId] = useState("");
  const [recipeRows, setRecipeRows] = useState<RecipeRow[]>([]);
  const [batchYield, setBatchYield] = useState("");
  const [savingRecipe, setSavingRecipe] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  const fetchCategories = async () => {
    try {
      const { data } = await API.get<MenuCategory[]>("/menu/categories");
      setCategories(data);
      const defaultCategory = data[0]?.name ?? "";
      setAddForm((prev) => (prev.category ? prev : { ...prev, category: defaultCategory }));
      setDraft((prev) => (prev.category ? prev : { ...prev, category: defaultCategory }));
    } catch (e: any) {
      toast.error("Error", e.response?.data?.message);
    }
  };

  const fetchItems = async () => {
    try {
      const { data } = await API.get("/menu/all");
      setItems(data);
    } catch (e: any) {
      toast.error("Error", e.response?.data?.message);
    }
  };

  const fetchInventory = async () => {
    try {
      const { data } = await API.get("/inventory/items");
      setInventory(data);
    } catch {
      /* optional */
    }
  };

  useEffect(() => {
    fetchItems();
    fetchCategories();
    fetchInventory();
  }, []);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const selectedItem = items.find((i) => i.id === selectedId);
  const deleteTarget = items.find((i) => i.id === deleteId);
  const editingCategory = categories.find((c) => c.id === editingCategoryId);
  const deleteCategoryTarget = categories.find((c) => c.id === deleteCategoryId);
  const categoryNames = categories.map((c) => c.name);

  const loadIntoDraft = (item: MenuItem) => {
    setSelectedId(item.id);
    setDraft({
      name: item.name,
      description: item.description || "",
      price: String(item.price),
      category: item.category,
      imageUrl: item.imageUrl || "",
      stockLevel: item.stockLevel == null ? "" : String(item.stockLevel),
    });
  };

  const loadRecipe = async (menuItemId: string) => {
    setRecipeMenuId(menuItemId);
    if (!menuItemId) {
      setRecipeRows([]);
      setBatchYield("");
      return;
    }
    const item = items.find((i) => i.id === menuItemId);
    setBatchYield(item?.batchYield ? String(item.batchYield) : "");
    try {
      const { data } = await API.get(`/menu/${menuItemId}/ingredients`);
      setRecipeRows(
        data.length > 0
          ? data.map((r: MenuIngredient) => ({
              inventoryItemId: r.inventoryItem.id,
              quantity: String(r.quantity),
            }))
          : [{ inventoryItemId: "", quantity: "" }],
      );
    } catch (e: any) {
      toast.error("Error", e.response?.data?.message);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.name || !addForm.price || !addForm.category) {
      return toast.warning("Name, price, and category are required");
    }
    setSubmitting(true);
    try {
      await API.post("/menu", {
        ...addForm,
        price: Number(addForm.price),
        imageUrl: addForm.imageUrl || undefined,
        stockLevel: addForm.stockLevel === "" ? null : Number(addForm.stockLevel),
      });
      setAddForm({ ...EMPTY_FORM, category: categories[0]?.name ?? "" });
      await fetchItems();
      toast.success("Menu item added");
      if (showTabs) setTab("list");
    } catch (e: any) {
      toast.error("Error", e.response?.data?.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId || !draft.name || !draft.price) {
      return toast.warning("Select an item in Edit first, or pick one below");
    }
    setSubmitting(true);
    try {
      await API.put(`/menu/${selectedId}`, {
        name: draft.name,
        description: draft.description,
        price: Number(draft.price),
        category: draft.category,
        imageUrl: draft.imageUrl || null,
        stockLevel: draft.stockLevel === "" ? null : Number(draft.stockLevel),
      });
      await fetchItems();
      toast.success("Menu item updated");
      if (showTabs) setTab("list");
    } catch (e: any) {
      toast.error("Error", e.response?.data?.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return toast.warning("Select an item to delete");
    const confirmed = await toast.confirm(
      `Delete "${deleteTarget?.name}"? This cannot be undone.`,
      { confirmLabel: "Delete" },
    );
    if (!confirmed) return;
    setSubmitting(true);
    try {
      await API.delete(`/menu/${deleteId}`);
      if (selectedId === deleteId) {
        setSelectedId("");
        setDraft(EMPTY_FORM);
      }
      if (recipeMenuId === deleteId) {
        setRecipeMenuId("");
        setRecipeRows([]);
      }
      setDeleteId("");
      await fetchItems();
      toast.success("Menu item deleted");
      if (showTabs) setTab("list");
    } catch (e: any) {
      toast.error("Error", e.response?.data?.message);
    } finally {
      setSubmitting(false);
    }
  };

  const saveRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipeMenuId) return;
    const ingredients = recipeRows
      .filter((r) => r.inventoryItemId && Number(r.quantity) > 0)
      .map((r) => ({
        inventoryItemId: r.inventoryItemId,
        quantity: Number(r.quantity),
      }));
    setSavingRecipe(true);
    try {
      await API.put(`/menu/${recipeMenuId}/ingredients`, { ingredients });
      await API.put(`/menu/${recipeMenuId}`, {
        batchYield: batchYield === "" ? null : Math.max(1, Math.floor(Number(batchYield))),
      });
      toast.success("Recipe saved");
      fetchItems();
    } catch (e: any) {
      toast.error("Error", e.response?.data?.message);
    } finally {
      setSavingRecipe(false);
    }
  };

  const toggleAvailability = async (item: MenuItem) => {
    try {
      await API.put(`/menu/${item.id}`, { isAvailable: !item.isAvailable });
      fetchItems();
      toast.success(item.isAvailable ? "Marked unavailable" : "Marked available");
    } catch (e: any) {
      toast.error("Error", e.response?.data?.message);
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = categoryForm.name.trim();
    if (!name) return toast.warning("Category name is required");
    setSubmitting(true);
    try {
      await API.post("/menu/categories", {
        name,
        sortOrder: categoryForm.sortOrder ? Number(categoryForm.sortOrder) : 0,
      });
      setCategoryForm({ name: "", sortOrder: "" });
      await fetchCategories();
      toast.success("Category added");
    } catch (e: any) {
      toast.error("Error", e.response?.data?.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategoryId) return toast.warning("Select a category to update");
    const name = categoryDraft.name.trim();
    if (!name) return toast.warning("Category name is required");
    setSubmitting(true);
    try {
      await API.put(`/menu/categories/${editingCategoryId}`, {
        name,
        sortOrder: categoryDraft.sortOrder ? Number(categoryDraft.sortOrder) : 0,
      });
      await fetchCategories();
      await fetchItems();
      toast.success("Category updated");
    } catch (e: any) {
      toast.error("Error", e.response?.data?.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteCategory = async () => {
    if (!deleteCategoryId) return toast.warning("Select a category to delete");
    const confirmed = await toast.confirm(
      `Delete category "${deleteCategoryTarget?.name}"?`,
      { confirmLabel: "Delete" },
    );
    if (!confirmed) return;
    setSubmitting(true);
    try {
      await API.delete(`/menu/categories/${deleteCategoryId}`);
      if (editingCategoryId === deleteCategoryId) {
        setEditingCategoryId("");
        setCategoryDraft({ name: "", sortOrder: "" });
      }
      setDeleteCategoryId("");
      await fetchCategories();
      toast.success("Category deleted");
    } catch (e: any) {
      toast.error("Error", e.response?.data?.message);
    } finally {
      setSubmitting(false);
    }
  };

  const loadCategoryIntoDraft = (category: MenuCategory) => {
    setEditingCategoryId(category.id);
    setCategoryDraft({
      name: category.name,
      sortOrder: String(category.sortOrder),
    });
  };

  const goToEdit = (item: MenuItem) => {
    loadIntoDraft(item);
    if (showTabs) setTab("edit");
  };

  const goToDelete = (item: MenuItem) => {
    setDeleteId(item.id);
    if (showTabs) setTab("delete");
  };

  const unavailable = items.filter((i) => !i.isAvailable);
  const recipeMenu = items.find((i) => i.id === recipeMenuId);

  const tabsToShow = useMemo(() => {
    if (showTabs) return TABS;
    return TABS.filter((t) => t.id === tab);
  }, [showTabs, tab]);

  return (
    <div className="p-4 md:p-8 bg-[#E8F4FD] min-h-screen font-sans space-y-6">
      <div className="bg-[#0A1F44] text-white rounded-2xl p-6">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardList /> Menu Management
        </h2>
        <p className="text-blue-200 text-sm mt-1">
          Use separate tabs to add, edit, update, delete items, and manage recipes
        </p>
      </div>

      {unavailable.length > 0 && tab === "list" && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={20} />
          <div>
            <p className="font-semibold text-amber-800">Unavailable Items</p>
            <p className="text-sm text-amber-700 mt-1">
              {unavailable.map((i) => `${i.name} (${i.category})`).join(", ")}
            </p>
          </div>
        </div>
      )}

      {showTabs && (
        <div className="flex flex-wrap gap-2 bg-white rounded-2xl p-2 border border-gray-100">
          {tabsToShow.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition ${
                tab === id
                  ? "bg-[#0A1F44] text-white shadow-sm"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === "list" && (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-gray-500 uppercase text-[10px] border-b border-slate-100">
              <tr>
                <th className="px-5 py-4 text-left font-extrabold tracking-wider">Item</th>
                <th className="px-5 py-4 text-left font-extrabold tracking-wider">Category</th>
                <th className="px-5 py-4 text-left font-extrabold tracking-wider">Recipe</th>
                <th className="px-5 py-4 text-right font-extrabold tracking-wider">Price</th>
                <th className="px-5 py-4 text-center font-extrabold tracking-wider">Stock</th>
                <th className="px-5 py-4 text-center font-extrabold tracking-wider">Status</th>
                <th className="px-5 py-4 text-right font-extrabold tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-gray-400">
                    No menu items yet. Use the <strong>Add</strong> tab.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr
                    key={item.id}
                    className={`hover:bg-slate-50/40 transition duration-150 ${!item.isAvailable ? "bg-amber-50/20" : ""}`}
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        {/* Thumbnail */}
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            className="w-10 h-10 rounded-xl object-cover shrink-0 border border-slate-100"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center shrink-0 border border-slate-100">
                            <span className="text-slate-400 text-xs font-black">
                              {item.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        )}
                        <div>
                          <p className="font-extrabold text-[#0A1F44]">{item.name}</p>
                          {item.description && (
                            <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{item.description}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg text-[10px] font-bold uppercase tracking-wider">{item.category}</span>
                    </td>
                    <td className="px-5 py-4 text-xs text-gray-500">
                      {item.ingredients?.length ? (
                        <div className="flex flex-col gap-0.5">
                          {item.ingredients.map((ing) => (
                            <span key={ing.id} className="text-gray-650 font-medium">
                              • {ing.quantity} {ing.inventoryItem.unit} {ing.inventoryItem.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400 italic">No ingredients linked</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right font-black text-[#0A1F44]">
                      KES {item.price.toLocaleString()}
                    </td>
                    <td className="px-5 py-4 text-center">
                      {item.stockLevel == null ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : (
                        <span className={`text-xs font-bold ${item.stockLevel <= 0 ? "text-red-600" : "text-gray-700"}`}>
                          {item.stockLevel}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-center">
                      <button
                        type="button"
                        onClick={() => toggleAvailability(item)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition ${
                          item.isAvailable
                            ? "bg-emerald-50 text-emerald-700 border-emerald-100/50 hover:bg-emerald-100"
                            : "bg-amber-50 text-amber-700 border-amber-100/50 hover:bg-amber-100"
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${item.isAvailable ? "bg-emerald-600" : "bg-amber-600"}`} />
                        {item.isAvailable ? "Available" : "Unavailable"}
                      </button>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="inline-flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => goToEdit(item)}
                          className="px-2.5 py-1 text-xs font-bold text-indigo-600 hover:bg-indigo-50 border border-indigo-100 rounded-lg transition duration-150"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            loadRecipe(item.id);
                            setTab("recipes");
                          }}
                          className="px-2.5 py-1 text-xs font-bold text-[#0A1F44] hover:bg-[#0A1F44]/5 border border-slate-200 rounded-lg transition duration-150"
                        >
                          Recipe
                        </button>
                        <button
                          type="button"
                          onClick={() => goToDelete(item)}
                          className="px-2.5 py-1 text-xs font-bold text-red-650 hover:bg-red-50 border border-red-100 rounded-lg transition duration-150"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "categories" && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
              <h3 className="font-extrabold text-[#0A1F44]">All Categories</h3>
              <p className="text-xs text-gray-400 mt-1">Categories appear in POS filters and menu item forms.</p>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-gray-500 uppercase text-[10px] border-b border-slate-100">
                <tr>
                  <th className="px-5 py-3 text-left font-extrabold tracking-wider">Name</th>
                  <th className="px-5 py-3 text-left font-extrabold tracking-wider">Sort</th>
                  <th className="px-5 py-3 text-left font-extrabold tracking-wider">Items</th>
                  <th className="px-5 py-3 text-right font-extrabold tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categories.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center text-gray-400">
                      No categories yet. Add your first category on the right.
                    </td>
                  </tr>
                ) : (
                  categories.map((category) => {
                    const itemCount = items.filter((i) => i.category === category.name).length;
                    return (
                      <tr key={category.id} className="hover:bg-slate-50/40 transition">
                        <td className="px-5 py-4 font-bold text-[#0A1F44]">{category.name}</td>
                        <td className="px-5 py-4 text-gray-500">{category.sortOrder}</td>
                        <td className="px-5 py-4 text-gray-500">{itemCount}</td>
                        <td className="px-5 py-4 text-right">
                          <div className="inline-flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => loadCategoryIntoDraft(category)}
                              className="px-2.5 py-1 text-xs font-bold text-indigo-600 hover:bg-indigo-50 border border-indigo-100 rounded-lg transition"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteCategoryId(category.id)}
                              className="px-2.5 py-1 text-xs font-bold text-red-650 hover:bg-red-50 border border-red-100 rounded-lg transition"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="space-y-6">
            <form
              onSubmit={handleAddCategory}
              className="bg-white rounded-2xl p-6 border border-slate-100 space-y-4 shadow-sm"
            >
              <h3 className="font-extrabold text-[#0A1F44] text-lg">Add Category</h3>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Name</label>
                <input
                  placeholder="e.g. Breakfast"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Sort Order (optional)</label>
                <input
                  type="number"
                  placeholder="0"
                  value={categoryForm.sortOrder}
                  onChange={(e) => setCategoryForm({ ...categoryForm, sortOrder: e.target.value })}
                  className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200"
                  min="0"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-[#0A1F44] hover:bg-[#0A1F44]/90 text-white rounded-xl font-extrabold text-sm disabled:opacity-50 transition duration-200 shadow-sm"
              >
                {submitting ? "Adding..." : "Add Category"}
              </button>
            </form>

            <form
              onSubmit={handleUpdateCategory}
              className="bg-white rounded-2xl p-6 border border-slate-100 space-y-4 shadow-sm"
            >
              <h3 className="font-extrabold text-[#0A1F44] text-lg">Update Category</h3>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Select Category</label>
                <select
                  value={editingCategoryId}
                  onChange={(e) => {
                    const category = categories.find((c) => c.id === e.target.value);
                    if (category) loadCategoryIntoDraft(category);
                    else {
                      setEditingCategoryId("");
                      setCategoryDraft({ name: "", sortOrder: "" });
                    }
                  }}
                  className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 font-semibold"
                >
                  <option value="">Select category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">New Name</label>
                <input
                  placeholder="Category name"
                  value={categoryDraft.name}
                  onChange={(e) => setCategoryDraft({ ...categoryDraft, name: e.target.value })}
                  className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 disabled:opacity-50"
                  disabled={!editingCategoryId}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Sort Order</label>
                <input
                  type="number"
                  placeholder="0"
                  value={categoryDraft.sortOrder}
                  onChange={(e) => setCategoryDraft({ ...categoryDraft, sortOrder: e.target.value })}
                  className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 disabled:opacity-50"
                  disabled={!editingCategoryId}
                  min="0"
                />
              </div>
              {editingCategory && (
                <p className="text-xs text-gray-400">
                  Renaming updates all menu items currently in &quot;{editingCategory.name}&quot;.
                </p>
              )}
              <button
                type="submit"
                disabled={!editingCategoryId || submitting}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-extrabold text-sm disabled:opacity-40 transition duration-200 shadow-sm"
              >
                {submitting ? "Saving..." : "Save Category"}
              </button>
            </form>

            <div className="bg-white rounded-2xl p-6 border border-slate-100 space-y-4 shadow-sm">
              <h3 className="font-extrabold text-red-750 text-lg">Delete Category</h3>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Select Category</label>
                <select
                  value={deleteCategoryId}
                  onChange={(e) => setDeleteCategoryId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 font-semibold"
                >
                  <option value="">Select category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              {deleteCategoryTarget && (
                <div className="rounded-2xl border border-rose-100 bg-rose-50/50 p-4 text-xs text-rose-800 space-y-2">
                  <p>
                    Items using this category:{" "}
                    <strong>{items.filter((i) => i.category === deleteCategoryTarget.name).length}</strong>
                  </p>
                  <p className="text-rose-700">
                    Categories with menu items cannot be deleted. Reassign or remove those items first.
                  </p>
                  <button
                    type="button"
                    onClick={handleDeleteCategory}
                    disabled={submitting}
                    className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-extrabold text-xs transition duration-200 shadow-sm disabled:opacity-40"
                  >
                    {submitting ? "Deleting..." : "Delete Category"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "add" && (
        <form
          onSubmit={handleAdd}
          className="bg-white rounded-2xl p-6 border border-slate-100 space-y-4 max-w-lg shadow-sm"
        >
          <h3 className="font-extrabold text-[#0A1F44] text-lg">Add new menu item</h3>

          <ImageUploader
            value={addForm.imageUrl}
            onChange={(url) => setAddForm({ ...addForm, imageUrl: url })}
          />

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Item Name</label>
            <input
              placeholder="e.g. Grilled Chicken Salad"
              value={addForm.name}
              onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Description (optional)</label>
            <input
              placeholder="e.g. Served with fresh vinaigrette dressing"
              value={addForm.description}
              onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Price (KES)</label>
              <input
                type="number"
                placeholder="0.00"
                value={addForm.price}
                onChange={(e) => setAddForm({ ...addForm, price: e.target.value })}
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 font-semibold"
                required
                min="0"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Category</label>
              <select
                value={addForm.category}
                onChange={(e) => setAddForm({ ...addForm, category: e.target.value })}
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 font-semibold"
                required
              >
                {categoryNames.length === 0 ? (
                  <option value="">No categories — add one first</option>
                ) : (
                  categoryNames.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Stock (portions)</label>
            <input
              type="number"
              min="0"
              placeholder="Leave blank for unlimited"
              value={addForm.stockLevel}
              onChange={(e) => setAddForm({ ...addForm, stockLevel: e.target.value })}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200"
            />
            <p className="text-[10px] text-gray-400">Decreases by 1 each time this item is sold. Restock here or in Update.</p>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-[#0A1F44] hover:bg-[#0A1F44]/90 text-white rounded-xl font-extrabold text-sm disabled:opacity-50 transition duration-200 shadow-sm"
          >
            {submitting ? "Adding Item..." : "Add Menu Item"}
          </button>
        </form>
      )}

      {tab === "edit" && (
        <div className="bg-white rounded-2xl p-6 border border-slate-100 space-y-4 max-w-lg shadow-sm">
          <h3 className="font-extrabold text-[#0A1F44] text-lg">Edit Menu Item</h3>
          <p className="text-xs text-gray-400 leading-normal">
            Choose an item to load its details. You can make and save adjustments in the <strong>Update</strong> tab.
          </p>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Select Menu Item</label>
            <select
              value={selectedId}
              onChange={(e) => {
                const item = items.find((i) => i.id === e.target.value);
                if (item) loadIntoDraft(item);
                else {
                  setSelectedId("");
                  setDraft(EMPTY_FORM);
                }
              }}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 font-semibold"
            >
              <option value="">Select menu item</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.category}) - KES {i.price}
                </option>
              ))}
            </select>
          </div>

          {selectedItem && (
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-5 space-y-3.5 text-xs text-slate-700 animate-in fade-in slide-in-from-top-1 duration-200">
              {selectedItem.imageUrl && (
                <img
                  src={selectedItem.imageUrl}
                  alt={selectedItem.name}
                  className="w-full h-36 object-cover rounded-xl border border-indigo-100"
                />
              )}
              <div className="flex justify-between items-start border-b border-indigo-100/40 pb-2">
                <span className="font-bold text-indigo-900 text-sm">{selectedItem.name}</span>
                <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-md font-bold uppercase tracking-wider text-[9px]">{selectedItem.category}</span>
              </div>
              <div className="space-y-2">
                <p className="flex justify-between">
                  <span className="text-slate-400">Current Price:</span>
                  <span className="font-bold text-[#0A1F44]">KES {selectedItem.price.toLocaleString()}</span>
                </p>
                {selectedItem.description && (
                  <p className="flex flex-col gap-1">
                    <span className="text-slate-400">Description:</span>
                    <span className="font-semibold text-slate-650 bg-white rounded-lg p-2 border border-slate-100 leading-normal">{selectedItem.description}</span>
                  </p>
                )}
              </div>
              <button
                 type="button"
                 onClick={() => setTab("update")}
                 className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-xs transition duration-200 shadow-sm"
               >
                 Proceed to Update Details →
               </button>
            </div>
          )}
        </div>
      )}

      {tab === "update" && (
        <form
          onSubmit={handleUpdate}
          className="bg-white rounded-2xl p-6 border border-slate-100 space-y-4 max-w-lg shadow-sm"
        >
          <h3 className="font-extrabold text-[#0A1F44] text-lg">Update Menu Item</h3>

          {!selectedId && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200/50 rounded-xl p-3 leading-normal font-semibold">
              ⚠️ No item selected. Please choose a menu item from the list below to begin editing.
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Target Menu Item</label>
            <select
              value={selectedId}
              onChange={(e) => {
                const item = items.find((i) => i.id === e.target.value);
                if (item) loadIntoDraft(item);
                else {
                  setSelectedId("");
                  setDraft(EMPTY_FORM);
                }
              }}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 font-semibold"
            >
              <option value="">Select menu item</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.category})
                </option>
              ))}
            </select>
          </div>

          <ImageUploader
            value={draft.imageUrl}
            onChange={(url) => setDraft({ ...draft, imageUrl: url })}
            disabled={!selectedId}
          />

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">New Item Name</label>
            <input
              placeholder="Item name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 disabled:opacity-50"
              disabled={!selectedId}
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">New Description</label>
            <input
              placeholder="Description (optional)"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 disabled:opacity-50"
              disabled={!selectedId}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">New Price (KES)</label>
              <input
                type="number"
                placeholder="Price"
                value={draft.price}
                onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 disabled:opacity-50 font-semibold"
                disabled={!selectedId}
                required
                min="0"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">New Category</label>
              <select
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 disabled:opacity-50 font-semibold"
                disabled={!selectedId}
                required
              >
                {categoryNames.length === 0 ? (
                  <option value="">No categories available</option>
                ) : (
                  categoryNames.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Stock (portions)</label>
            <input
              type="number"
              min="0"
              placeholder="Leave blank for unlimited"
              value={draft.stockLevel}
              onChange={(e) => setDraft({ ...draft, stockLevel: e.target.value })}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 disabled:opacity-50"
              disabled={!selectedId}
            />
            <p className="text-[10px] text-gray-400">Increase to restock. Stock decreases automatically when orders are placed.</p>
          </div>

          <button
            type="submit"
            disabled={!selectedId || submitting}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-extrabold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition duration-200 shadow-sm"
          >
            {submitting ? "Updating Item..." : "Save Changes"}
          </button>
        </form>
      )}

      {tab === "delete" && (
        <div className="bg-white rounded-2xl p-6 border border-slate-100 space-y-4 max-w-lg shadow-sm">
          <h3 className="font-extrabold text-red-750 text-lg">Delete Menu Item</h3>
          <p className="text-xs text-gray-400 leading-normal">
            Select a dish to remove from the system. Linked recipes will also be cleaned up.
          </p>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Select Item to Remove</label>
            <select
              value={deleteId}
              onChange={(e) => setDeleteId(e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 font-semibold"
            >
              <option value="">Select menu item</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.category}) - KES {i.price}
                </option>
              ))}
            </select>
          </div>

          {deleteTarget && (
            <div className="rounded-2xl border border-rose-100 bg-rose-50/50 p-5 space-y-4 text-xs animate-in fade-in slide-in-from-top-1 duration-200">
              {deleteTarget.imageUrl && (
                <img
                  src={deleteTarget.imageUrl}
                  alt={deleteTarget.name}
                  className="w-full h-32 object-cover rounded-xl border border-rose-100 opacity-80"
                />
              )}
              <div className="flex justify-between items-start border-b border-rose-100 pb-2">
                <span className="font-bold text-rose-900 text-sm">{deleteTarget.name}</span>
                <span className="px-2 py-0.5 bg-rose-100 text-rose-700 rounded-md font-bold uppercase tracking-wider text-[9px]">{deleteTarget.category}</span>
              </div>
              <div className="space-y-1 text-rose-800">
                <p>Price: KES {deleteTarget.price.toLocaleString()}</p>
                {deleteTarget.description && <p>Description: {deleteTarget.description}</p>}
                <p className="font-bold text-red-700 mt-2">⚠️ Warning: This action is permanent and cannot be undone.</p>
              </div>
              <button
                type="button"
                onClick={handleDelete}
                disabled={submitting}
                className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-extrabold text-xs transition duration-200 shadow-sm"
              >
                {submitting ? "Deleting permanently..." : "Delete Permanently"}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "recipes" && (
        <form
          onSubmit={saveRecipe}
          className="bg-white rounded-2xl p-6 border border-slate-100 space-y-5 shadow-sm"
        >
          <div>
            <h3 className="font-extrabold text-[#0A1F44] text-lg">Recipe / Batch Production</h3>
            <p className="text-xs text-gray-400 mt-1 leading-normal">
              Ingredients are used once per cooking batch (not per sale). Set batch yield — e.g. 1 kg flour makes 60 mandazis.
              Record batches on the Production page; POS sales track progress toward expected revenue.
            </p>
          </div>

          <div className="space-y-1 max-w-md">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Select Dish</label>
            <select
              value={recipeMenuId}
              onChange={(e) => loadRecipe(e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A1F44] focus:bg-white transition-all duration-200 font-semibold"
            >
              <option value="">Select menu item</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} - {i.ingredients?.length ?? 0} ingredient(s) linked
                </option>
              ))}
            </select>
          </div>

          {recipeMenuId && (
            <div className="space-y-3.5 border-t border-slate-100 pt-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                    Batch yield (portions per cook)
                  </label>
                  <input
                    type="number"
                    min={1}
                    placeholder="e.g. 60 mandazis"
                    value={batchYield}
                    onChange={(e) => setBatchYield(e.target.value)}
                    className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold"
                  />
                </div>
                {recipeMenu && batchYield && Number(batchYield) > 0 && (
                  <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 flex flex-col justify-center">
                    <p className="text-[10px] text-emerald-700 font-bold uppercase">Expected per batch</p>
                    <p className="text-lg font-black text-emerald-900">
                      KES {(Number(batchYield) * recipeMenu.price).toLocaleString()}
                    </p>
                    <p className="text-[10px] text-emerald-600">
                      {batchYield} × KES {recipeMenu.price}
                    </p>
                  </div>
                )}
              </div>

              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Ingredients per batch</label>
              <div className="space-y-3">
                {recipeRows.map((row, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-3 items-center bg-gray-50 border border-slate-100 p-3 rounded-2xl"
                  >
                    <div className="space-y-1">
                      <label className="text-[8px] font-bold text-gray-400 uppercase tracking-wider block">Ingredient Item</label>
                      <select
                        value={row.inventoryItemId}
                        onChange={(e) => {
                          const next = [...recipeRows];
                          next[idx] = { ...next[idx], inventoryItemId: e.target.value };
                          setRecipeRows(next);
                        }}
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#0A1F44] font-semibold"
                        required
                      >
                        <option value="">Choose Inventory item</option>
                        {inventory.map((inv) => (
                          <option key={inv.id} value={inv.id}>
                            {inv.name} ({inv.stockLevel} {inv.unit} in stock)
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[8px] font-bold text-gray-400 uppercase tracking-wider block">Qty per batch</label>
                      <input
                        type="number"
                        step="any"
                        min="0.001"
                        placeholder="e.g. 1 kg"
                        value={row.quantity}
                        onChange={(e) => {
                          const next = [...recipeRows];
                          next[idx] = { ...next[idx], quantity: e.target.value };
                          setRecipeRows(next);
                        }}
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#0A1F44] font-semibold"
                        required
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setRecipeRows(recipeRows.filter((_, i) => i !== idx))}
                      className="p-2 text-gray-400 hover:text-red-650 hover:bg-red-50 rounded-xl mt-4 sm:mt-0 transition self-end"
                      title="Remove ingredient row"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-3 pt-3">
                <button
                  type="button"
                  onClick={() =>
                    setRecipeRows([...recipeRows, { inventoryItemId: "", quantity: "" }])
                  }
                  className="flex items-center gap-1.5 px-4 py-2.5 border border-slate-200 rounded-xl hover:bg-slate-50 transition text-xs font-bold text-gray-700"
                >
                  <Plus size={14} /> Add Ingredient Row
                </button>
                <button
                  type="submit"
                  disabled={savingRecipe}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-extrabold text-xs disabled:opacity-40 transition shadow-sm"
                >
                  {savingRecipe ? "Saving..." : `Save Recipe ${recipeMenu ? `for ${recipeMenu.name}` : ""}`}
                </button>
              </div>
            </div>
          )}
        </form>
      )}
    </div>
  );
};

export default MenuManagement;
