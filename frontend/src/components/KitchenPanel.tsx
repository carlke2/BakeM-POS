import { useCallback, useEffect, useState } from "react";
import { ChefHat, Flame, RefreshCw } from "lucide-react";
import API from "@/services/api";
import { toast } from "@/services/toast";
import Loader from "@/components/ui/loader";

type KitchenDish = {
  id: string;
  name: string;
  price: number;
  batchYield: number;
  portionsReady: number;
  canCookBatches: number;
  expectedPerBatch: number;
  ingredients: {
    name: string;
    unit: string;
    quantityPerBatch: number;
    stockLevel: number;
    batchesPossible: number;
  }[];
  activeBatch: {
    soldAmount: number;
    expectedRevenue: number;
    remainingExpected: number;
    soldQuantity: number;
    yieldQuantity: number;
    remainingQuantity: number;
    progressPercent: number;
  } | null;
  totals: {
    activeExpected: number;
    activeSold: number;
    activeRemaining: number;
    activePortionsLeft: number;
  };
};

type Props = {
  onProductionRecorded?: () => void;
};

const KitchenPanel = ({ onProductionRecorded }: Props) => {
  const [dishes, setDishes] = useState<KitchenDish[]>([]);
  const [loading, setLoading] = useState(true);
  const [cookingId, setCookingId] = useState<string | null>(null);

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await API.get<KitchenDish[]>("/menu/kitchen-board");
      setDishes(data);
    } catch (e: any) {
      toast.error("Failed to load kitchen", e.response?.data?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);

  const cookBatch = async (dish: KitchenDish) => {
    if (dish.canCookBatches < 1) {
      toast.error("Not enough ingredients", `Restock ${dish.ingredients.map((i) => i.name).join(", ")} first`);
      return;
    }
    setCookingId(dish.id);
    try {
      const { data } = await API.post(`/menu/${dish.id}/produce`, { batchCount: 1 });
      toast.success(
        `${dish.name} cooked`,
        `${data.yieldTotal} ready for sale — target KES ${data.expectedRevenue.toLocaleString()}`,
      );
      await fetchBoard();
      onProductionRecorded?.();
    } catch (e: any) {
      toast.error("Cook failed", e.response?.data?.message);
    } finally {
      setCookingId(null);
    }
  };

  if (loading) {
    return <Loader size="sm" title="Loading kitchen..." className="py-16" />;
  }

  if (dishes.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-100 rounded-2xl p-6 text-sm text-amber-900">
        <p className="font-extrabold mb-2">No batch recipes configured</p>
        <p className="text-amber-800 leading-relaxed">
          Go to <strong>Menu → Recipes</strong>, pick a dish (e.g. Mandazi), add ingredients per batch
          (1 kg flour), and set <strong>batch yield</strong> (60). Then return here to cook and track sales.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Cook from raw stock → portions appear on POS → each sale updates expected revenue.
        </p>
        <button
          onClick={fetchBoard}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-gray-600 hover:bg-white rounded-lg border border-slate-200"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {dishes.map((dish) => {
          const batch = dish.activeBatch;
          const sold = batch?.soldAmount ?? dish.totals.activeSold;
          const expected = batch?.expectedRevenue ?? dish.totals.activeExpected;
          const remaining = batch?.remainingExpected ?? dish.totals.activeRemaining;
          const progress = expected > 0 ? Math.min(100, (sold / expected) * 100) : 0;

          return (
            <div
              key={dish.id}
              className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm space-y-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-extrabold text-[#0A1F44] text-lg">{dish.name}</h4>
                  <p className="text-xs text-gray-500 mt-0.5">
                    KES {dish.price} each · {dish.batchYield} per batch · target KES {dish.expectedPerBatch.toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => cookBatch(dish)}
                  disabled={cookingId === dish.id || dish.canCookBatches < 1}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white rounded-xl text-xs font-extrabold shrink-0"
                >
                  <Flame size={14} />
                  {cookingId === dish.id ? "Cooking..." : "Cook 1 batch"}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                <div className="bg-slate-50 rounded-xl p-2.5">
                  <p className="text-[9px] text-gray-400 font-bold uppercase">Raw stock</p>
                  <p className="text-sm font-black text-[#0A1F44]">{dish.canCookBatches} batches</p>
                </div>
                <div className="bg-indigo-50 rounded-xl p-2.5">
                  <p className="text-[9px] text-indigo-600 font-bold uppercase">Ready (POS)</p>
                  <p className="text-sm font-black text-indigo-900">{dish.portionsReady}</p>
                </div>
                <div className="bg-emerald-50 rounded-xl p-2.5">
                  <p className="text-[9px] text-emerald-600 font-bold uppercase">Sales made</p>
                  <p className="text-sm font-black text-emerald-800">KES {sold.toLocaleString()}</p>
                </div>
                <div className="bg-amber-50 rounded-xl p-2.5">
                  <p className="text-[9px] text-amber-700 font-bold uppercase">Still expected</p>
                  <p className="text-sm font-black text-amber-900">KES {remaining.toLocaleString()}</p>
                </div>
              </div>

              {expected > 0 && (
                <div>
                  <div className="flex justify-between text-[10px] font-bold text-gray-500 mb-1">
                    <span>Sales progress toward batch target</span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {batch
                      ? `${batch.soldQuantity} of ${batch.yieldQuantity} sold this batch`
                      : "Cook a batch to start tracking"}
                  </p>
                </div>
              )}

              <div className="text-xs text-gray-500 border-t border-slate-100 pt-3">
                <p className="font-bold text-gray-600 mb-1 flex items-center gap-1">
                  <ChefHat size={12} /> Recipe per batch
                </p>
                {dish.ingredients.map((ing, i) => (
                  <p key={i}>
                    {ing.quantityPerBatch} {ing.unit} {ing.name}
                    <span className="text-gray-400"> — {ing.stockLevel} {ing.unit} in stock</span>
                  </p>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default KitchenPanel;
