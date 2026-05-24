/**
 * Centralized API client with auth token management.
 */

let authToken: string | null = null

/** Store the auth token (call after join) */
export function setAuthToken(token: string): void {
  authToken = token
  sessionStorage.setItem("game-token", token)
}

/** Get the current auth token */
export function getAuthToken(): string | null {
  if (!authToken) {
    authToken = sessionStorage.getItem("game-token")
  }
  return authToken
}

/** Clear the auth token (on leave/disconnect) */
export function clearAuthToken(): void {
  authToken = null
  sessionStorage.removeItem("game-token")
}

/** Build headers with auth token */
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json", ...extra }
  const token = getAuthToken()
  if (token) {
    headers["authorization"] = `Bearer ${token}`
  }
  return headers
}

/** Generic API response type */
type ApiResponse<T = unknown> = { success: true } & T | { success: false; error: string }

/** POST request with auth */
export async function apiPost<T = unknown>(url: string, body?: unknown): Promise<ApiResponse<T>> {
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: body != null ? JSON.stringify(body) : undefined,
  })
  return res.json() as Promise<ApiResponse<T>>
}

/** GET request with auth */
export async function apiGet<T = unknown>(url: string): Promise<ApiResponse<T>> {
  const res = await fetch(url, { headers: authHeaders() })
  return res.json() as Promise<ApiResponse<T>>
}

/** Create an EventSource with token as query param (EventSource doesn't support headers) */
export function createAuthEventSource(url: string): EventSource {
  const token = getAuthToken()
  const separator = url.includes("?") ? "&" : "?"
  const authUrl = token ? `${url}${separator}token=${encodeURIComponent(token)}` : url
  return new EventSource(authUrl)
}

// --- High-level API methods ---

/** Join a game room and store the token */
export async function joinGame(gameId: string, seat: number, password?: string): Promise<ApiResponse<{ token: string; gameId: string; seat: number }>> {
  const res = await fetch(`/api/auth/join/${gameId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seat, password }),
  })
  const data = await res.json() as ApiResponse<{ token: string; gameId: string; seat: number }>
  if (data.success && "token" in data) {
    setAuthToken(data.token)
  }
  return data
}
