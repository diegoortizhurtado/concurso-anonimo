import { useEffect, useState, useCallback } from "react";

// === CONFIG ===
// Usa el proxy de Vercel (creado en /api/gas-proxy)
const GAS_BASE = "/api/gas-proxy";
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

async function fetchJson<T = unknown>(url: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const text = await res.text(); // leer una vez
  try {
    return JSON.parse(text) as T;
  } catch {
    return { raw: text } as unknown as T;
  }
}

// === TYPES ===
interface Visit {
  stand: number;
  ts: string;
}

interface PendingReport {
  anonId: string;
  visits: Visit[];
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

  // === Helper functions ===

  const visitsUniqueCount = (visArr: Visit[]): number =>
    new Set(visArr.map((v) => v.stand)).size;

  const clearPendingReport = useCallback((id: string) => {
    const pending: PendingReport[] = JSON.parse(localStorage.getItem("pendingReports") || "[]");
    const filtered = pending.filter((p) => p.anonId !== id);
    localStorage.setItem("pendingReports", JSON.stringify(filtered));
  }, []);

  const queuePendingReport = useCallback((id: string, visitsToReport: Visit[]) => {
    const pending: PendingReport[] = JSON.parse(localStorage.getItem("pendingReports") || "[]");
    pending.push({ anonId: id, visits: visitsToReport, ts: new Date().toISOString() });
    localStorage.setItem("pendingReports", JSON.stringify(pending));
  }, []);

  const ensureAnonId = useCallback(async (): Promise<string> => {
    const cached = localStorage.getItem("anonId");
    if (cached) return cached;

    const url = `${GAS_BASE}?action=newAnon`;
    const body = await fetchJson<{ id?: number }>(url);
    if (!body || !body.id) throw new Error("No se obtuvo anonId del backend");
    localStorage.setItem("anonId", String(body.id));
    return String(body.id);
  }, []);

  const reportComplete = useCallback(
    async (id: string, visitsToReport: Visit[]): Promise<void> => {
      if (!id) throw new Error("anonId missing");

      const payload = {
        action: "reportComplete",
        anonId: id,
        visits: visitsToReport,
        timestamp: new Date().toISOString(),
      };

      console.log("📤 Enviando reporte completo a GAS:", payload);

      const res = await fetch(GAS_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => ({}));

      if (data && (data.success || data.status === "ok")) {
        console.log("✅ Reporte recibido por GAS");
        clearPendingReport(id);
        localStorage.setItem("reported", "true");
        setReported(true);
      } else {
        throw new Error("Backend no devolvió éxito");
      }
    },
    [clearPendingReport]
  );

  const flushPending = useCallback(async () => {
    const pending: PendingReport[] = JSON.parse(localStorage.getItem("pendingReports") || "[]");
    for (const p of pending) {
      try {
        await fetch(GAS_BASE, {
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
  }, [clearPendingReport]);

  // === Effects ===

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
            await handleStandVisit(sid);
          } else {
            setStatus("QR inválido: stand desconocido.");
          }
        }
      } catch (e) {
        console.error(e);
        setStatus("Error de red o servidor. Intentando en segundo plano...");
      }
    })();
  }, [ensureAnonId]);

  useEffect(() => {
    if (!anonId) return;
    localStorage.setItem("visits", JSON.stringify(visits));

    if (reported) return;

    if (visitsUniqueCount(visits) === STAND_COUNT) {
      console.log("✅ 4 stands completados, reportando a backend...");
      reportComplete(anonId, visits)
        .then(() => {
          setReported(true);
          localStorage.setItem("reported", "true");
          setStatus("✅ ¡Reporte enviado al backend con éxito!");
        })
        .catch((err) => {
          console.warn("⚠️ No se pudo reportar ahora; guardando pendiente", err);
          queuePendingReport(anonId, visits);
          setStatus("⚠️ Error de red, se guardó el reporte pendiente.");
        });
    }
  }, [visits, anonId, reported, reportComplete, queuePendingReport]);

  useEffect(() => {
    const onOnline = () => flushPending();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flushPending]);

  // === Actions ===

  async function handleStandVisit(stand: number): Promise<void> {
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

  function resetAll() {
    localStorage.clear();
    setAnonId(null);
    setVisits([]);
    setReported(false);
    setStatus("Cache limpiado.");
  }

  // === Render ===

  return (
    <div className="App">
      <div className="card">
        <h1>Registro anónimo de stands</h1>

        <div className="anon-section">
          <h2>Tu código anónimo</h2>
          <div className="anon-id-display">{anonId || "…"}</div>
        </div>

        <div className="progress">
          <h2>Progreso</h2>
          <p>
            {visitsUniqueCount(visits)} / {STAND_COUNT} stands visitados
          </p>
          <ul>
            {Array.from({ length: STAND_COUNT }, (_, i) => i + 1).map((s) => (
              <li key={s}>
                Stand {s}{" "}
                {visits.some((v) => v.stand === s) ? (
                  <span className="check">✅</span>
                ) : (
                  <span className="dash">—</span>
                )}
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

        {/* Nota oculta visualmente, pero visible en el DOM */}
        <p className="note hidden">
          Nota: el QR debe apuntar a la URL del deploy con ?stand=1, ?stand=2, etc.
          El parámetro se oculta tras leerlo.
        </p>
      </div>
    </div>
  );
}