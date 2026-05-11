import axios from "axios";

// Base axios instance. Session 5 attaches the Supabase JWT here via an interceptor.
// Session 4 replaces direct use of this client with the NSwag-generated client
// that wraps it.
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000",
  timeout: 15_000,
});
