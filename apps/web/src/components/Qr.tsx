import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** QR gerado no navegador: o conteúdo (link ou endereço) nunca é enviado a serviço externo. */
export function Qr({ value, label, size = 192 }: { value: string; label: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { width: size, margin: 2, errorCorrectionLevel: "M" }).then(
      (url) => { if (alive) setSrc(url); },
      () => { if (alive) setSrc(null); },
    );
    return () => { alive = false; };
  }, [value, size]);
  if (!src) return <p role="status" className="muted">Gerando QR Code…</p>;
  return <img src={src} width={size} height={size} alt={label} style={{ background: "#fff", borderRadius: 8 }} />;
}
