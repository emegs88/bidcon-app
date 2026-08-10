"use client";
// ============================================================================
// InventarioHeyGen — PAINEL-VOZES-01 · a tela que substitui o segredo na mão
// AUTORIZADO: Emerson Gomes dos Santos — 10/08/2026.
// ----------------------------------------------------------------------------
// ARQUIVO SEPARADO DE FarolAcoes.tsx, e a razão é o contrário da que juntou os
// três componentes de lá. Aqueles compartilhavam a caixa de confirmação
// nominal; este não tem confirmação nenhuma — é leitura pura. Colá-lo lá
// deixaria a caixa a um `import` de distância de um botão inofensivo, que é
// justamente o começo de a palavra virar reflexo.
//
// NENHUM SEGREDO CHEGA AQUI. Este componente sabe dizer "quero a lista"; quem
// sabe *como* se pergunta à HeyGen é a rota, no servidor, com a chave que já
// vive na Vercel. Era esse o ponto do trabalho.
//
// SEM `router.refresh()`, ao contrário de FarolAcoes. Lá o refresh existe
// porque a ação mudou o banco e a página é Server Component. Aqui nada mudou:
// refresh só re-renderizaria a tela inteira para exibir dados que estão no
// estado deste componente.
//
// ----------------------------------------------------------------------------
// DUAS ESCOLHAS DE TELA QUE SÃO SOBRE HONESTIDADE, NÃO SOBRE ESTÉTICA
// ----------------------------------------------------------------------------
// 1. O CABEÇALHO VEM ANTES DA LISTA, sempre, com o estado de cada fonte e o
//    controle. A lista é a parte bonita e é a parte que engana: uma lista de
//    120 vozes onde faltou uma página parece completa. Quem responde "isto é
//    tudo?" é o cabeçalho, e por isso ele não é rodapé.
//
// 2. `preload="none"` NOS ÁUDIOS. Sem isso o navegador começaria a baixar
//    centenas de amostras ao renderizar a lista — dezenas de megabytes para
//    ouvir uma. O operador clica no play da que interessa.
// ============================================================================
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import styles from "./farol.module.css";

type Fonte = { nome: string; ok: boolean; erro?: string; n: number };

type Voz = {
  id: string;
  nome: string;
  genero: string | null;
  idioma: string | null;
  premium: boolean | null;
  amostra: string | null;
  origem: string;
};

type Avatar = {
  id: string;
  nome: string;
  tipo: string | null;
  preview: string | null;
  origem: string;
};

type Resposta = {
  fonte: "vozes" | "avatares";
  itens: (Voz | Avatar)[];
  fontes: Fonte[];
  controle: { socorro_presente: boolean } | null;
  parcial: boolean;
  avisos: string[];
};

function ehVoz(i: Voz | Avatar): i is Voz {
  return "amostra" in i;
}

/**
 * Copiar o id. Existe porque o id da HeyGen tem 32 caracteres hexadecimais sem
 * separador — transcrever à mão é como uma pessoa erra um dígito e passa a
 * tarde procurando um defeito que ela mesma criou.
 *
 * `navigator.clipboard` não existe fora de contexto seguro; o `catch` deixa o
 * botão dizer "falhou" em vez de morrer calado.
 */
function BotaoCopiar({ texto }: { texto: string }) {
  const [estado, setEstado] = useState<"parado" | "copiado" | "falhou">("parado");
  return (
    <button
      type="button"
      className={styles.copiar}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setEstado("copiado");
        } catch {
          setEstado("falhou");
        }
        setTimeout(() => setEstado("parado"), 1500);
      }}
    >
      {estado === "copiado" ? "copiado" : estado === "falhou" ? "falhou" : "copiar"}
    </button>
  );
}

export default function InventarioHeyGen() {
  const [carregando, setCarregando] = useState<null | "vozes" | "avatares">(null);
  const [erro, setErro] = useState<string | null>(null);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [filtro, setFiltro] = useState("");

  async function buscar(fonte: "vozes" | "avatares") {
    setCarregando(fonte);
    setErro(null);
    try {
      const resp = await fetch(`/api/admin/farol/heygen-inventario?fonte=${fonte}`, {
        cache: "no-store",
      });
      const j = (await resp.json().catch(() => ({}))) as Partial<Resposta> & {
        erro?: string;
        detalhe?: string;
      };
      if (!resp.ok) {
        throw new Error(
          [j.erro ?? `HTTP ${resp.status}`, j.detalhe].filter(Boolean).join(" — ")
        );
      }
      setDados(j as Resposta);
      setFiltro("");
    } catch (e) {
      setDados(null);
      setErro(e instanceof Error ? e.message : "falha ao consultar o inventário.");
    } finally {
      setCarregando(null);
    }
  }

  // Filtro por NOME **ou** ID, e o id importa mais: a pergunta que originou
  // esta tela era "o 05601cd1... existe?", e ela se responde colando o id.
  const termo = filtro.trim().toLowerCase();
  const itens = (dados?.itens ?? []).filter(
    (i) =>
      !termo ||
      i.id.toLowerCase().includes(termo) ||
      (i.nome ?? "").toLowerCase().includes(termo)
  );

  return (
    <div className={styles.acoesWrap}>
      <div className={styles.botoes}>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={carregando !== null}
          onClick={() => buscar("vozes")}
        >
          {carregando === "vozes" ? "consultando…" : "Listar vozes da HeyGen"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={carregando !== null}
          onClick={() => buscar("avatares")}
        >
          {carregando === "avatares" ? "consultando…" : "Listar avatares da HeyGen"}
        </Button>
      </div>

      {erro ? (
        <p className={styles.erroAcao} role="alert">
          {erro}
        </p>
      ) : null}

      {dados ? (
        <div className={styles.inventario}>
          {/* --- o cabeçalho que responde "isto é tudo?" ------------------- */}
          {dados.parcial ? (
            <p className={styles.invParcial} role="alert">
              LISTA PARCIAL — o que está abaixo pode não ser tudo o que existe na
              conta. Não conclua que um id some da HeyGen só porque ele não
              aparece aqui.
            </p>
          ) : null}

          <p className={styles.invResumo}>
            <strong>{dados.itens.length}</strong>{" "}
            {dados.fonte === "vozes" ? "voz(es)" : "avatar(es)"} no inventário
            {termo ? ` · ${itens.length} no filtro` : ""}
          </p>

          <ul className={styles.invFontes}>
            {dados.fontes.map((f) => (
              <li key={f.nome} className={f.ok ? styles.fonteOk : styles.fonteRuim}>
                <code>{f.nome}</code> · {f.ok ? "ok" : "falhou"} · {f.n} item(ns)
                {f.erro ? <span className={styles.fonteErro}> — {f.erro}</span> : null}
              </li>
            ))}
          </ul>

          {dados.controle ? (
            <p
              className={
                dados.controle.socorro_presente ? styles.invControleOk : styles.invControleRuim
              }
            >
              {dados.controle.socorro_presente
                ? "Controle ok: a voz de socorro conhecida apareceu na lista — esta listagem enxerga vozes boas."
                : "Controle FALHOU: a voz de socorro conhecida NÃO apareceu. Esta lista não serve para afirmar que um id não existe."}
            </p>
          ) : null}

          {dados.avisos.length > 0 ? (
            <ul className={styles.invAvisos}>
              {dados.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          ) : null}

          {/* --- o filtro --------------------------------------------------- */}
          {dados.itens.length > 0 ? (
            <input
              type="search"
              className={styles.invFiltro}
              placeholder="filtrar por nome ou colar um id"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              aria-label="filtrar o inventário por nome ou id"
            />
          ) : null}

          {/* --- a lista ---------------------------------------------------- */}
          {itens.length === 0 ? (
            <p className={styles.vazio}>
              {dados.itens.length === 0
                ? "Nenhum item veio. Leia as fontes acima antes de concluir qualquer coisa."
                : "Nada bate com o filtro."}
            </p>
          ) : (
            <ul className={styles.invLista}>
              {itens.map((i) => (
                <li key={`${i.origem}:${i.id}`} className={styles.invItem}>
                  <div className={styles.invCabecalho}>
                    <strong>{i.nome}</strong>
                    <span className={styles.invMeta}>
                      {ehVoz(i)
                        ? [
                            i.idioma,
                            i.genero,
                            i.premium === null ? null : i.premium ? "premium" : "grátis",
                            i.origem,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : [i.tipo, i.origem].filter(Boolean).join(" · ")}
                    </span>
                  </div>

                  <div className={styles.invIdLinha}>
                    <code className={styles.invId}>{i.id}</code>
                    <BotaoCopiar texto={i.id} />
                  </div>

                  {ehVoz(i) ? (
                    i.amostra ? (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <audio
                        className={styles.invAudio}
                        controls
                        preload="none"
                        src={i.amostra}
                      />
                    ) : (
                      <span className={styles.invSemAmostra}>sem amostra na API</span>
                    )
                  ) : i.preview ? (
                    // <img> cru e não next/image: a URL vem da HeyGen, é externa
                    // e variável, e o otimizador exigiria domínio no next.config
                    // — um item novo apareceria quebrado em vez de aparecer.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className={styles.invPreview} src={i.preview} alt={i.nome} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
