import axios from "axios";
import { clearShopSession, getShopToken } from "@/shop/shopSession";

const defaultBaseUrl = import.meta.env.PROD
  ? "https://api.smartpos.com/api"
  : "http://localhost:5000/api";

const shopApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || defaultBaseUrl,
});

shopApi.interceptors.request.use((config) => {
  const token = getShopToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

shopApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !window.location.pathname.startsWith("/shop/login")) {
      clearShopSession();
      window.location.href = "/shop/login";
    }
    return Promise.reject(error);
  },
);

export default shopApi;
