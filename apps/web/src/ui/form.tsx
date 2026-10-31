import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { errorMessage } from "../api";

/** Rótulo + campo ligados por id, com ajuda e erro associados (aria-describedby). */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint ? <p id={hintId} className="muted" style={{ margin: "4px 0 0" }}>{hint}</p> : null}
      {error ? <p id={errorId} className="error" style={{ margin: "4px 0 0" }}>{error}</p> : null}
    </div>
  );
}

export function TextField(props: { label: string; value: string; onChange: (value: string) => void; hint?: string; error?: string | null; type?: string; required?: boolean; inputMode?: "numeric" | "tel" | "email" | "decimal"; maxLength?: number; autoComplete?: string }) {
  return (
    <Field label={props.label} hint={props.hint} error={props.error}>
      {({ id, describedBy, invalid }) => (
        <input id={id} type={props.type ?? "text"} value={props.value} required={props.required} inputMode={props.inputMode} maxLength={props.maxLength}
          autoComplete={props.autoComplete ?? "off"} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => props.onChange(e.target.value)} />
      )}
    </Field>
  );
}

export function TextArea(props: { label: string; value: string; onChange: (value: string) => void; hint?: string; required?: boolean; rows?: number; maxLength?: number }) {
  return (
    <Field label={props.label} hint={props.hint}>
      {({ id, describedBy }) => (
        <textarea id={id} value={props.value} required={props.required} rows={props.rows ?? 3} maxLength={props.maxLength} aria-describedby={describedBy}
          style={{ font: "inherit", width: "100%", padding: "8px 12px", borderRadius: "var(--radius)", border: "1px solid var(--control-border)", background: "var(--surface)", color: "var(--text)" }}
          onChange={(e) => props.onChange(e.target.value)} />
      )}
    </Field>
  );
}

export function SelectField<T extends string>(props: { label: string; value: T; onChange: (value: T) => void; options: Array<{ value: T; label: string }>; hint?: string }) {
  return (
    <Field label={props.label} hint={props.hint}>
      {({ id, describedBy }) => (
        <select id={id} value={props.value} aria-describedby={describedBy} onChange={(e) => props.onChange(e.target.value as T)}>
          {props.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}

export function Message({ message }: { message: { kind: "ok" | "error"; text: string } | null }) {
  if (!message) return null;
  return <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "error" : undefined}>{message.text}</p>;
}

/**
 * Executa uma ação assíncrona com proteção contra duplo clique: enquanto uma está em andamento,
 * outra chamada é ignorada (a trava é síncrona, via ref, não depende de re-renderização).
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const running = useRef(false);

  const run = useCallback(async <T,>(task: () => Promise<T>, okText?: string): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> => {
    if (running.current) return { ok: false, error: new Error("em andamento") };
    running.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const value = await task();
      if (okText) setMessage({ kind: "ok", text: okText });
      return { ok: true, value };
    } catch (error) {
      setMessage({ kind: "error", text: errorMessage(error) });
      return { ok: false, error };
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);

  return { run, busy, message, setMessage };
}
