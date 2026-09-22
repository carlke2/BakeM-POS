import { ReactNode } from "react";

interface Props {
  title: string;
  value: string | number;
  icon: ReactNode;
}

const DashboardCard = ({ title, value, icon }: Props) => {
  return (
    <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm flex items-center gap-4">
      <div className="p-3 bg-gray-100 rounded-md text-gray-700">{icon}</div>
      <div>
        <h3 className="text-gray-500 text-xs uppercase tracking-wide">{title}</h3>
        <p className="text-2xl font-semibold text-gray-900 mt-1">{value}</p>
      </div>
    </div>
  );
};

export default DashboardCard;
