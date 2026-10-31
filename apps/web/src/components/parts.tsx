import type { ReactNode } from "react";
import type { Remote } from "../useApi";

export const Loading = () => <p role="status" className="state">Carregando…</p>;

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="state">
      <p className="error">{message}</p>
      {onRetry ? <button type="button" onClick={onRetry}>Tentar novamente</button> : null}
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="state muted">{children}</p>;

/** Renderiza os três estados de uma busca: carregando, erro e pronto. */
export function Remote<T>({ state, onRetry, children }: { state: Remote<T>; onRetry?: () => void; children: (data: T) => ReactNode }) {
  if (state.status === "loading") return <Loading />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={onRetry} />;
  return <>{children(state.data)}</>;
}

export interface Column<Row> {
  header: string;
  render: (row: Row) => ReactNode;
}

export function DataTable<Row>({ caption, columns, rows, rowKey, empty }: { caption: string; columns: Column<Row>[]; rows: Row[]; rowKey: (row: Row) => string; empty: string }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>{columns.map((c) => <th key={c.header} scope="col">{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>{columns.map((c) => <td key={c.header}>{c.render(row)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
