"use client";

import React, { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";

type EmailListItem = {
  id: number;
  from_email: string;
  subject: string;
  created_at: string;
};

type EmailDetail = {
  id: number;
  to_email: string;
  from_email: string;
  subject: string;
  body_text: string;
  created_at: string;
};

type EmailPreview = Pick<EmailListItem, "from_email" | "subject">;

const HIDDEN_SUBJECT = "reset your password for spotify";

async function apiRequest(
  path: string,
  options: RequestInit = {},
  token?: string
) {
  if (!API_BASE) {
    throw new Error("NEXT_PUBLIC_API_BASE is not set");
  }

  // Penting: pakai Record<string, string>, bukan HeadersInit
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = "Bearer " + token;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `API error ${res.status}: ${text || res.statusText || "Unknown error"}`
    );
  }

  return res.json();
}

// Biar nggak kelihatan "bounces+..." di UI
function getSenderLabel(fromEmail: string): string {
  const lower = fromEmail.toLowerCase();

  // contoh: bounce+...@notify.openai.com, noreply@tm.openai.com, dll
  if (lower.includes("openai.com")) {
    return "OpenAI";
  }

  const match = fromEmail.match(/([^@]+)@/);
  if (match) return match[1];

  return fromEmail;
}

function isHiddenEmail(email: EmailPreview): boolean {
  return email.subject.trim().toLowerCase() === HIDDEN_SUBJECT;
}

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<{ email: string } | null>(null);
  const [inbox, setInbox] = useState<EmailListItem[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<EmailDetail | null>(null);

  const [loading, setLoading] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedToken = window.localStorage.getItem("tm_token");
    if (savedToken) {
      setToken(savedToken);
      fetchMe(savedToken);
      fetchInbox(savedToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedEmail) return;

    if (isHiddenEmail(selectedEmail)) {
      setSelectedEmail(null);
    }
  }, [selectedEmail]);

  const visibleInbox = inbox.filter((item) => !isHiddenEmail(item));

  async function fetchMe(currentToken?: string) {
    try {
      const t = currentToken || token;
      if (!t) return;
      const data = await apiRequest("/api/me", {}, t);
      setMe({ email: data.email });
    } catch (err) {
      console.error(err);
    }
  }

  async function deleteEmailById(id: number, currentToken: string) {
    await apiRequest(`/api/email/${id}`, { method: "DELETE" }, currentToken);
  }

  async function removeSpotifyResetEmails(
    emails: EmailListItem[],
    currentToken: string
  ) {
    const spotifyResetEmails = emails.filter((item) => isHiddenEmail(item));

    if (spotifyResetEmails.length === 0) {
      return emails;
    }

    const results = await Promise.allSettled(
      spotifyResetEmails.map((item) => deleteEmailById(item.id, currentToken))
    );

    const failedCount = results.filter(
      (result) => result.status === "rejected"
    ).length;

    if (failedCount > 0) {
      setError(`Gagal menghapus ${failedCount} email Spotify reset.`);
    }

    const refreshedInbox: EmailListItem[] = await apiRequest(
      "/api/inbox?limit=50",
      {},
      currentToken
    );

    return refreshedInbox.filter((item) => !isHiddenEmail(item));
  }

  async function fetchInbox(currentToken?: string) {
    try {
      const t = currentToken || token;
      if (!t) return;
      setLoading(true);
      setError(null);
      const data: EmailListItem[] = await apiRequest(
        "/api/inbox?limit=50",
        {},
        t
      );
      const cleanedInbox = await removeSpotifyResetEmails(data, t);

      setInbox(cleanedInbox);

      if (
        selectedEmail &&
        !cleanedInbox.some((item) => item.id === selectedEmail.id)
      ) {
        setSelectedEmail(null);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Gagal mengambil inbox");
    } finally {
      setLoading(false);
    }
  }

  async function fetchEmailDetail(id: number) {
    try {
      if (!token) return;
      setLoading(true);
      setError(null);
      const data: EmailDetail = await apiRequest(
        `/api/email/${id}`,
        {},
        token
      );

      if (isHiddenEmail(data)) {
        await deleteEmailById(data.id, token);
        await fetchInbox(token);
        setSelectedEmail(null);
        return;
      }

      setSelectedEmail(data);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Gagal mengambil detail email");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginLoading(true);
    setError(null);

    try {
      const data = await apiRequest("/api/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      const t = data.token as string;
      setToken(t);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("tm_token", t);
      }
      await fetchMe(t);
      await fetchInbox(t);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Login gagal");
    } finally {
      setLoginLoading(false);
    }
  }

  function handleLogout() {
    setToken(null);
    setMe(null);
    setInbox([]);
    setSelectedEmail(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("tm_token");
    }
  }

  async function handleDeleteEmail(id: number) {
    if (!token) return;
    try {
      setLoading(true);
      setError(null);
      await deleteEmailById(id, token);
      await fetchInbox(token);
      if (selectedEmail?.id === id) {
        setSelectedEmail(null);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Gagal menghapus email");
    } finally {
      setLoading(false);
    }
  }

  // ---------- TAMPILAN LOGIN ----------
  if (!token || !me) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-3xl bg-slate-900/80 border border-slate-800/80 shadow-xl shadow-sky-900/40 p-8 space-y-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Mail Panel
            </h1>
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-950/40 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm text-slate-300">Email</label>
              <input
                type="email"
                className="w-full rounded-2xl bg-slate-900/70 border border-slate-700 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                placeholder="user@domain.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-slate-300">Password</label>
              <input
                type="password"
                className="w-full rounded-2xl bg-slate-900/70 border border-slate-700 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              disabled={loginLoading}
              className="w-full rounded-2xl bg-sky-500 hover:bg-sky-400 disabled:bg-sky-700 text-slate-950 font-semibold py-2.5 text-sm transition-colors"
            >
              {loginLoading ? "Logging in..." : "Login"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ---------- TAMPILAN SETELAH LOGIN ----------
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex justify-center px-4 py-6">
      <div className="w-full max-w-4xl rounded-3xl bg-slate-900/80 border border-slate-800/80 shadow-2xl shadow-sky-900/40 p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Inbox</h1>
            <p className="text-sm text-slate-400">{me.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchInbox()}
              disabled={loading}
              className="rounded-full border border-sky-500/60 bg-sky-500/10 px-4 py-1.5 text-sm font-medium hover:bg-sky-500/20 disabled:opacity-60"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
            <button
              onClick={handleLogout}
              className="rounded-full border border-slate-700 bg-slate-800 px-4 py-1.5 text-sm hover:bg-slate-700"
            >
              Logout
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[260px,minmax(0,1fr)] gap-4">
          {/* Daftar email kiri */}
          <div className="rounded-3xl bg-slate-900/70 border border-slate-800/80 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <span className="text-sm font-medium text-slate-200">
                Daftar email
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => fetchInbox()}
                  disabled={loading}
                  className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1"
                >
                  ↻ Refresh
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[420px]">
              {visibleInbox.length === 0 ? (
                <div className="text-xs text-slate-500 px-4 py-6">
                  Belum ada email masuk.
                </div>
              ) : (
                <ul className="divide-y divide-slate-800/80">
                  {visibleInbox.map((item) => (
                    <li
                      key={item.id}
                      onClick={() => fetchEmailDetail(item.id)}
                      className={`cursor-pointer px-4 py-3 text-xs space-y-1 hover:bg-slate-800/70 ${
                        selectedEmail?.id === item.id
                          ? "bg-slate-800/80"
                          : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold truncate">
                          {item.subject || "(Tanpa subjek)"}
                        </span>
                        <span className="text-[10px] text-slate-400 whitespace-nowrap">
                          {new Date(item.created_at).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {getSenderLabel(item.from_email)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Detail email kanan */}
          <div className="rounded-3xl bg-slate-900/70 border border-slate-800/80 p-4 space-y-3">
            {selectedEmail ? (
              <>
                <div className="space-y-1">
                  <h2 className="text-base font-semibold">
                    {selectedEmail.subject || "(Tanpa subjek)"}
                  </h2>
                  <div className="text-xs text-slate-400 space-x-1">
                    <span>From: {getSenderLabel(selectedEmail.from_email)}</span>
                    <span>· To: {selectedEmail.to_email}</span>
                    <span>·</span>
                    <span>
                      {new Date(selectedEmail.created_at).toLocaleString()}
                    </span>
                  </div>
                </div>

                {/* hanya tombol Hapus, teks body dihilangkan */}
                <div className="flex justify-end">
                  <button
                    onClick={() =>
                      selectedEmail && handleDeleteEmail(selectedEmail.id)
                    }
                    className="rounded-full bg-red-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-400"
                  >
                    Hapus
                  </button>
                </div>

                <div className="rounded-2xl bg-slate-950/80 border border-slate-800/90 overflow-hidden max-h-[420px]">
                  <iframe
                    title="email-body"
                    className="w-full h-[420px] bg-white"
                    srcDoc={selectedEmail.body_text || ""}
                  />
                </div>
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                Pilih email di sebelah kiri untuk melihat detail.
              </div>
            )}
          </div>
        </div>

        <p className="text-[11px] text-slate-500 pt-1">Inbox diperbarui.</p>
      </div>
    </div>
  );
}
