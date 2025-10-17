import { useEffect, useState } from "react";

// === CONFIG ===
const GAS_BASE =
  "https://script.google.com/macros/s/AKfycbwmD2GzzontGGC1ceIYBxzOPXFIg1qDsBa8qdmoZ6VNcH4UvVTn4LmxaROxiEM4uoQ0/exec";
const STAND_COUNT = 4;

// === HELPERS ===
function qsGet(param: string): string | null {
  const p = new URLSearchParams(window.location.search);
  return p.get(param);
}

function hideQueryString(): void {
  if (window.history && window.history.replaceState) {
    const newUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, newUrl);
  }
}

async function fetchJson<T = any>(url: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// === TYPES ===
interface Visit {
  stand: number;
  ts: string;
}

// === COMPONENT ===
export default function App() {
  const [anonId, setAnonId] = useState<string | null>(null);
  const [visits, setVisits] = useState<Visit[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("visits") || "[]");
    } catch {
      return [];
    }
  });
  const [reported, setReported] = useState<boolean>(
    localStorage.getItem("reported") === "true"
  );
  const [status, setStatus] = useState<string>("");

  // Load on mount
  useEffect(() => {
    const standParam = qsGet("stand");
    hideQueryString();

    (async () => {
      try {
        const id = await ensureAnonId();
        setAnonId(id);
        if (standParam) {
          const sid = Number(standParam);
          if (!Number.isNaN(sid) && sid >= 1 && sid <= STAND_COUNT) {
            await handleStandVisit(sid, id);
          } else {
            setStatus("QR inválido: stand desconocido.");
          }
        }
      } catch (e) {
        console.error(e);
        setStatus("Error de red o servidor. Intentando en segundo plano...");
      }
    })();
  }, []);

  // Persist visits and trigger report
  useEffect(() => {
    localStorage.setItem("visits", JSON.stringify(visits));
    if (!reported && visitsUniqueCount(visits) === STAND_COUNT) {
      reportComplete(anonId, visits).catch((err) => {
        console.warn("No se pudo reportar ahora; se dejará pendiente", err);
        queuePendingReport(anonId, visits);
      });
    }
  }, [visits]);

  async function ensureAnonId(): Promise<string> {
    const cached = localStorage.getItem("anonId");
    if (cached) return cached;
    const url = `${GAS_BASE}?action=newAnon`;
    const body = await fetchJson<{ id: number }>(url);
    if (!body || !body.id) throw new Error("No se obtuvo anonId del backend");
    localStorage.setItem("anonId", String(body.id));
    return String(body.id);
  }

  function visitsUniqueCount(visArr: Visit[]): number {
    return new Set(visArr.map((v) => v.stand)).size;
  }

  async function handleStandVisit(stand: number, id: string): Promise<void> {
    setStatus(`Registrando visita al stand ${stand}...`);
    const already = visits.some((v) => v.stand === stand);
    if (already) {
      setStatus(`Ya registrado el stand ${stand}.`);
      return;
    }
    const newVisit: Visit = { stand, ts: new Date().toISOString() };
    setVisits((prev) => [...prev, newVisit]);
    setStatus(`Visita al stand ${stand} registrada localmente.`);
  }

  async function reportComplete(id: string | null, visitsToReport: Visit[]): Promise<void> {
    if (!id) throw new Error("anonId missing");
    setStatus("Reportando visita completa al backend...");
    const payload = {
      action: "reportComplete",
      anonId: id,
      visits: visitsToReport,
      timestamp: new Date().toISOString(),
    };
    const res = await fetchJson<{ success: boolean }>(GAS_BASE + "?action=reportComplete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res && res.success) {
      localStorage.setItem("reported", "true");
      setReported(true);
      setStatus("¡Registro completo reportado con éxito!");
      clearPendingReport(id);
    } else {
      throw new Error("Backend no devolvió éxito");
    }
  }

  function queuePendingReport(id: string | null, visitsToReport: Visit[]) {
    if (!id) return;
    const pending = JSON.parse(localStorage.getItem("pendingReports") || "[]");
    pending.push({ anonId: id, visits: visitsToReport, ts: new Date().toISOString() });
    localStorage.setItem("pendingReports", JSON.stringify(pending));
  }

  function clearPendingReport(id: string) {
    const pending = JSON.parse(localStorage.getItem("pendingReports") || "[]");
    const filtered = pending.filter((p: any) => p.anonId !== id);
    localStorage.setItem("pendingReports", JSON.stringify(filtered));
  }

  async function flushPending() {
    const pending = JSON.parse(localStorage.getItem("pendingReports") || "[]");
    for (const p of pending) {
      try {
        await fetchJson(GAS_BASE + "?action=reportComplete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "reportComplete",
            anonId: p.anonId,
            visits: p.visits,
            timestamp: p.ts,
          }),
        });
        clearPendingReport(p.anonId);
        setStatus("Se sincronizó un reporte pendiente.");
      } catch (e) {
        console.warn("No se pudo sincronizar reporte pendiente", e);
      }
    }
  }

  useEffect(() => {
    const onOnline = () => flushPending();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  function resetAll() {
    localStorage.clear();
    setAnonId(null);
    setVisits([]);
    setReported(false);
    setStatus("Cache limpiado.");
  }

  return (
    <div className="App">
      <div className="card">
        <h1>Registro anónimo de stands</h1>
        <p>
          Anónimo ID: <strong>{anonId || "(generando...)"}</strong>
        </p>

        <div className="progress">
          <h2>Progreso</h2>
          <p>
            {visitsUniqueCount(visits)} / {STAND_COUNT} stands visitados
          </p>
          <ul>
            {Array.from({ length: STAND_COUNT }, (_, i) => i + 1).map((s) => (
              <li key={s}>
                Stand {s} {visits.some((v) => v.stand === s) ? "✅" : "—"}
              </li>
            ))}
          </ul>
        </div>

        <div className="status">
          <h2>Estado</h2>
          <p>{status || "Listo"}</p>
        </div>

        <div className="actions">
          <button onClick={flushPending}>Sincronizar pendientes</button>
          <button className="danger" onClick={resetAll}>
            Borrar caché
          </button>
        </div>

        <p className="note">
          Nota: el QR debe apuntar a la URL del deploy con <code>?stand=1</code>,{" "}
          <code>?stand=2</code>, etc. El parámetro se oculta tras leerlo.
        </p>
      </div>
    </div>
  );
}
