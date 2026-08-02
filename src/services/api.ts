/**
 * API Client configuration
 * 
 * Dev mode: calls http://localhost:8000/api/...
 * Prod mode: calls /api/... (same origin)
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

export async function apiGet<T>(endpoint: string): Promise<T> {
  const url = `${API_BASE_URL}/api${endpoint}`;
  const response = await fetch(url);
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error || "API request failed");
  }
  
  return data.data;
}

export async function apiPost<T>(endpoint: string, body?: unknown): Promise<T> {
  const url = `${API_BASE_URL}/api${endpoint}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error || "API request failed");
  }
  
  return data.data;
}

export async function apiPut<T>(endpoint: string, body: unknown): Promise<T> {
  const url = `${API_BASE_URL}/api${endpoint}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error || "API request failed");
  }
  
  return data.data;
}

export async function apiDelete<T>(endpoint: string): Promise<T> {
  const url = `${API_BASE_URL}/api${endpoint}`;
  const response = await fetch(url, {
    method: "DELETE",
  });
  const data = await response.json();
  
  if (!data.success) {
    throw new Error(data.error || "API request failed");
  }
  
  return data.data;
}
