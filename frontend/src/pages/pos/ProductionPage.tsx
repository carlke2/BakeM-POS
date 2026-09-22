import { Navigate } from "react-router-dom";

/** Redirect legacy production route into unified Inventory kitchen tab. */
const ProductionPage = () => <Navigate to="/inventory?tab=kitchen" replace />;

export default ProductionPage;
