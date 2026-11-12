import { getAuthToken, notifyUnauthorised } from "@/shared/auth/authToken";
import { notifyForbidden } from "@/shared/http/httpNotices";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type RequestOptions = {
  method?: HttpMethod;
  body?: unknown;
  /**
   * Sent to the server as-is (a File/Blob/ArrayBuffer) with no JSON headers.
   * Used for file uploads so the server receives the real bytes.
   */
  rawBody?: BodyInit;
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

/** The bearer header for the signed-in person, or nothing when nobody is. */
function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * A 401 on any request that carried a token means the session is over
 * (expired, or the account was deactivated). Signing in with the wrong
 * password is also a 401, but that one is the page's to show, not a lost
 * session.
 */
function handleUnauthorised(url: string, status: number, hadToken: boolean): void {
  if (status === 401 && hadToken && !url.startsWith("/api/auth/login")) notifyUnauthorised();
}

/**
 * A 403 means the person is signed in but lacks the role. Pages are not
 * trusted to surface that themselves — many quietly drop the error — so the
 * client announces it and the root shows a toast (ForbiddenNotice).
 */
function handleForbidden(url: string, status: number, detail: string): void {
  if (status === 403) notifyForbidden({ url, message: detail });
}

/**
 * One readable sentence for a failed request, whatever the server sent back.
 *
 * FastAPI answers a validation failure with `detail` as an *array of objects*
 * — `{type, loc, msg, input, ctx}` — while every other error answers with
 * `detail` as a string. Callers all over the app do
 * `data.detail ?? "Something failed."` and put the result straight into JSX,
 * so the day a request 422s instead of 400s, React is handed an object and
 * the whole page dies with "Objects are not valid as a React child". The
 * screen the person was working on disappears, and the actual cause — a field
 * they left blank — is never shown.
 *
 * Flattening here, once, is what makes that impossible: no caller can receive
 * anything but a string, so no caller has to remember this.
 */
export function describeApiError(body: unknown, status: number): string {
  const fallback = `Request failed: ${status}`;
  if (typeof body === "string" && body.trim()) return body.trim();
  if (!body || typeof body !== "object") return fallback;

  const record = body as Record<string, unknown>;
  const detail = record.detail;

  if (typeof detail === "string" && detail.trim()) return detail.trim();

  if (Array.isArray(detail)) {
    const lines = detail
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (!entry || typeof entry !== "object") return "";
        const item = entry as Record<string, unknown>;
        const message = typeof item.msg === "string" ? item.msg : "";
        // `loc` reads like ["body", "name"]; the field is what the person
        // needs to hear, not which part of the request carried it.
        const where = Array.isArray(item.loc)
          ? item.loc
              .filter((part) => part !== "body" && part !== "query" && part !== "path")
              .join(".")
          : "";
        if (where && message) return `${where}: ${message}`;
        return message || where;
      })
      .filter(Boolean);
    if (lines.length > 0) return lines.join("; ");
  }

  if (detail && typeof detail === "object") {
    const item = detail as Record<string, unknown>;
    if (typeof item.msg === "string" && item.msg.trim()) return item.msg.trim();
  }

  const message = record.message;
  if (typeof message === "string" && message.trim()) return message.trim();

  return fallback;
}

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, rawBody, signal, headers } = options;

  // Prepend base URL if it exists and URL is relative
  const fullUrl = API_BASE_URL && url.startsWith('/') ? `${API_BASE_URL}${url}` : url;

  const isRaw = rawBody !== undefined;
  const auth = authHeaders();

  const response = await fetch(fullUrl, {
    method,
    signal,
    headers: isRaw
      ? { ...auth, ...(headers ?? {}) }
      : { "Content-Type": "application/json", ...auth, ...(headers ?? {}) },
    body: isRaw ? rawBody : body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    handleUnauthorised(url, response.status, "Authorization" in auth);
    const text = await response.text();
    let errorData: any = {};
    try {
      errorData = JSON.parse(text);
    } catch {
      // If not JSON, wrap text in an object
      errorData = { message: text };
    }
    const detail = describeApiError(errorData, response.status);
    handleForbidden(url, response.status, detail);
    const error: any = new Error(detail);
    error.status = response.status;
    error.detail = detail;
    // `detail` is replaced with the flattened string on the way out, because
    // that is the field the whole app reads and renders.
    error.response = { data: { ...errorData, detail }, raw: errorData };
    throw error;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function apiGet<T>(url: string, signal?: AbortSignal): Promise<T> {
  return request<T>(url, { method: "GET", signal });
}

export async function apiPost<TResponse, TBody = unknown>(
  url: string,
  body?: TBody,
  signal?: AbortSignal,
): Promise<TResponse> {
  return request<TResponse>(url, { method: "POST", body, signal });
}

/** POSTs raw bytes (e.g. an uploaded File) without JSON encoding. */
export async function apiPostRaw<TResponse>(
  url: string,
  rawBody: BodyInit,
  signal?: AbortSignal,
): Promise<TResponse> {
  return request<TResponse>(url, { method: "POST", rawBody, signal });
}

/**
 * POSTs raw bytes and reports how many have gone out.
 *
 * `fetch` cannot do this: a request body stream gives no upload events, so a
 * 100 MB file shows nothing at all until the server answers. XMLHttpRequest
 * is the only API in the browser that reports upload progress, which is the
 * whole reason this sits beside `apiPostRaw` instead of replacing it.
 */
export function apiPostRawWithProgress<TResponse>(
  url: string,
  rawBody: Blob,
  onProgress?: (sentBytes: number, totalBytes: number) => void,
  signal?: AbortSignal,
): Promise<TResponse> {
  const fullUrl = API_BASE_URL && url.startsWith("/") ? `${API_BASE_URL}${url}` : url;

  return new Promise<TResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", fullUrl, true);
    const auth = authHeaders();
    for (const [name, value] of Object.entries(auth)) xhr.setRequestHeader(name, value);

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        // Some proxies strip the length; the caller shows an indeterminate
        // bar in that case rather than a percentage it cannot know.
        if (event.lengthComputable) onProgress(event.loaded, event.total);
      };
    }

    xhr.onload = () => {
      const text = xhr.responseText;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(text ? (JSON.parse(text) as TResponse) : (undefined as TResponse));
        } catch {
          reject(new Error("The server's reply could not be read."));
        }
        return;
      }
      handleUnauthorised(url, xhr.status, "Authorization" in auth);
      // Same error shape as `request` above, so callers read one thing.
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
      const detail = describeApiError(data, xhr.status);
      handleForbidden(url, xhr.status, detail);
      const error: any = new Error(detail);
      error.status = xhr.status;
      error.detail = detail;
      error.response = { data: { ...data, detail }, raw: data };
      reject(error);
    };

    xhr.onerror = () => reject(new Error("The upload could not reach the server."));
    xhr.ontimeout = () => reject(new Error("The upload timed out."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));

    if (signal) {
      if (signal.aborted) {
        reject(new DOMException("Upload cancelled", "AbortError"));
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.send(rawBody);
  });
}

export async function apiPut<TResponse, TBody = unknown>(
  url: string,
  body?: TBody,
  signal?: AbortSignal,
): Promise<TResponse> {
  return request<TResponse>(url, { method: "PUT", body, signal });
}

export async function apiPatch<TResponse, TBody = unknown>(
  url: string,
  body?: TBody,
  signal?: AbortSignal,
): Promise<TResponse> {
  return request<TResponse>(url, { method: "PATCH", body, signal });
}

export async function apiDelete<TResponse>(
  url: string,
  signal?: AbortSignal,
): Promise<TResponse> {
  return request<TResponse>(url, { method: "DELETE", signal });
}

export const apiClient = {
  get: apiGet,
  post: apiPost,
  postRaw: apiPostRaw,
  postRawWithProgress: apiPostRawWithProgress,
  put: apiPut,
  patch: apiPatch,
  delete: apiDelete,
};