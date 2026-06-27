// Régua visual de status do processo (apresentação pura).
// Destaca o estado atual; anteriores = concluídos; posteriores = pendentes.
// Nunca exibe data/garantia de contemplação.
import { ORDEM_STATUS, LABEL_STATUS, type StatusProcesso } from "@/lib/status";

export function Timeline({ atual }: { atual: StatusProcesso }) {
  if (atual === "cancelado") {
    return (
      <div
        style={{
          background: "#10182B",
          border: "1px solid rgba(255,255,255,.15)",
          borderRadius: 14,
          padding: "16px 18px",
          color: "#cfcfd4",
        }}
      >
        {LABEL_STATUS.cancelado}.
      </div>
    );
  }

  const idxAtual = ORDEM_STATUS.indexOf(atual);

  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
      {ORDEM_STATUS.map((s, i) => {
        const feito = i < idxAtual;
        const ehAtual = i === idxAtual;
        const cor = ehAtual ? "#36C5F0" : feito ? "#34D399" : "rgba(255,255,255,.22)";
        const marcador = feito ? "✓" : ehAtual ? "●" : "○";
        return (
          <li
            key={s}
            style={{ display: "flex", alignItems: "center", gap: 12 }}
            aria-current={ehAtual ? "step" : undefined}
          >
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: 999,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: `2px solid ${cor}`,
                color: cor,
                fontSize: 13,
                flex: "0 0 auto",
              }}
            >
              {marcador}
            </span>
            <span
              style={{
                color: ehAtual ? "#f6f6f8" : feito ? "#cfcfd4" : "#93A0B8",
                fontWeight: ehAtual ? 700 : 500,
              }}
            >
              {LABEL_STATUS[s]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
