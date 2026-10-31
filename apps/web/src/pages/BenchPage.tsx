import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { DataTable, Remote } from "../components/parts";
import { formatDateTime, stateLabel } from "../format";
import { useApi } from "../useApi";

interface QueueItem { id: string; protocol: string; priority: string; version: number; createdAt: string; device: { brand: string; model: string } }
interface Mine { id: string; protocol: string; state: string; device: { brand: string; model: string } }

// BarcodeDetector não existe em todos os navegadores (ex.: Safari no iPhone). A busca manual por protocolo
// é uma alternativa COMPLETA, não um complemento.
type DetectorCtor = new (options: { formats: string[] }) => { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };
const Detector = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;

function Scanner({ onFound }: { onFound: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Detector) return;
    let stop = false;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const detector = new Detector({ formats: ["qr_code"] });
        while (!stop && video.current) {
          const found = await detector.detect(video.current).catch(() => []);
          if (found[0]?.rawValue) { onFound(found[0].rawValue); return; }
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      } catch {
        setError("Não foi possível usar a câmera. Use a busca por protocolo.");
      }
    })();
    return () => { stop = true; stream?.getTracks().forEach((track) => track.stop()); };
  }, [onFound]);

  if (!Detector) return <p className="muted">Este navegador não lê QR Code pela câmera. Use a busca por protocolo.</p>;
  return (
    <div>
      <video ref={video} muted playsInline aria-label="Imagem da câmera para ler o QR Code" style={{ width: "100%", maxWidth: 360, borderRadius: 10 }} />
      {error ? <p role="alert" className="error">{error}</p> : null}
    </div>
  );
}

export function BenchPage() {
  const navigate = useNavigate();
  const queue = useApi<{ queue: QueueItem[] }>("/work-orders/queue");
  const mine = useApi<{ workOrders: Mine[] }>("/work-orders?limit=50");
  const [protocol, setProtocol] = useState("");
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      const result = await api<{ workOrders: Array<{ id: string; protocol: string }> }>(`/work-orders?q=${encodeURIComponent(protocol.trim())}&limit=5`);
      const exact = result.workOrders.find((o) => o.protocol === protocol.trim()) ?? result.workOrders[0];
      if (exact) navigate(`/ordens/${exact.id}`);
      else setMessage("Nenhuma ordem encontrada com esse protocolo na sua bancada.");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Falha de conexão.");
    }
  }

  function openScanned(text: string) {
    setScanning(false);
    const match = /\/ordens\/([0-9a-f-]{36})(?:[/?#]|$)/.exec(text);
    if (match?.[1]) navigate(`/ordens/${match[1]}`);
    else setMessage("QR Code não reconhecido. Use a etiqueta da ordem de serviço.");
  }

  async function claim(item: QueueItem) {
    setMessage(null);
    try {
      await api(`/work-orders/${item.id}/claim`, { method: "POST", body: { expectedVersion: item.version } });
      queue.reload();
      mine.reload();
      setMessage(`Você assumiu a ordem ${item.protocol}.`);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Falha de conexão.");
      queue.reload();
    }
  }

  return (
    <>
      <h1>Bancada</h1>
      <section className="card" aria-labelledby="h-find">
        <h2 id="h-find">Abrir uma ordem</h2>
        <form onSubmit={search} className="actions">
          <div>
            <label htmlFor="protocol">Protocolo</label>
            <input id="protocol" value={protocol} onChange={(e) => setProtocol(e.target.value)} placeholder="2026-000123" inputMode="numeric" autoComplete="off" required />
          </div>
          <button type="submit" className="primary">Buscar</button>
          <button type="button" onClick={() => setScanning((on) => !on)} aria-pressed={scanning}>{scanning ? "Parar leitura" : "Ler QR Code"}</button>
        </form>
        {scanning ? <Scanner onFound={openScanned} /> : null}
        {message ? <p role="status">{message}</p> : null}
      </section>

      <h2>Minhas ordens</h2>
      <Remote state={mine} onRetry={mine.reload}>
        {({ workOrders }) => (
          <DataTable
            caption="Ordens atribuídas a você"
            rows={workOrders}
            rowKey={(r) => r.id}
            empty="Nenhuma ordem atribuída a você."
            columns={[
              { header: "Protocolo", render: (r) => <Link to={`/ordens/${r.id}`}>{r.protocol}</Link> },
              { header: "Situação", render: (r) => <span className="badge">{stateLabel(r.state)}</span> },
              { header: "Equipamento", render: (r) => `${r.device.brand} ${r.device.model}` },
            ]}
          />
        )}
      </Remote>

      <h2>Fila (sem técnico)</h2>
      <Remote state={queue} onRetry={queue.reload}>
        {({ queue: items }) => (
          <DataTable
            caption="Ordens recebidas aguardando um técnico"
            rows={items}
            rowKey={(r) => r.id}
            empty="Nenhuma ordem aguardando técnico."
            columns={[
              { header: "Protocolo", render: (r) => r.protocol },
              { header: "Equipamento", render: (r) => `${r.device.brand} ${r.device.model}` },
              { header: "Prioridade", render: (r) => r.priority },
              { header: "Recebida em", render: (r) => formatDateTime(r.createdAt) },
              { header: "Ação", render: (r) => <button type="button" onClick={() => void claim(r)}>Assumir {r.protocol}</button> },
            ]}
          />
        )}
      </Remote>
    </>
  );
}
