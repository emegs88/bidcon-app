"use client";
// ============================================================================
// Ações do painel do FAROL (PAINEL-FAROL-01) — TODO o interativo desta tela.
// ----------------------------------------------------------------------------
// UM ARQUIVO "use client" SÓ, com três componentes, em vez de três arquivos.
// Eles compartilham a caixa de confirmação nominal e o mesmo formato de erro;
// separá-los faria a caixa virar um quarto arquivo ou, pior, três cópias que
// divergem no primeiro ajuste de texto.
//
// O QUE ESTE ARQUIVO **NÃO** É: a trava. Toda regra que importa — sessão admin,
// palavra de confirmação, linter, transições legais — é conferida no servidor,
// nas rotas de /api/admin/farol/*. O que está aqui é conforto: desabilitar o
// botão antes de o operador clicar, e mostrar o motivo depois. `fetch` na
// consola do navegador não passa por componente nenhum, então uma trava que
// morasse aqui não seria trava.
//
// NENHUM SEGREDO CHEGA A ESTE ARQUIVO. O Bearer do FAROL é injetado
// server-side, dentro de /api/admin/farol/disparar. O browser só sabe dizer
// "quero disparar o render" — nunca *como* se autoriza um disparo.
//
// `router.refresh()` DEPOIS DE CADA AÇÃO. A página é Server Component: o
// refresh a re-renderiza no servidor com o estado real do banco, em vez de eu
// manter uma cópia otimista do estado na tela. Estado otimista aqui mentiria
// exatamente no caso que importa — a ação que falhou no servidor.
// ============================================================================
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
// A MESMA linha que a rota lê. Antes a palavra era repetida aqui à mão, com um
// comentário pedindo que batesse com o servidor — e pedido em comentário não é
// garantia: no dia em que a rota mudasse a palavra, este botão continuaria
// mandando a antiga e o operador levaria 400 sem entender por quê.
import { PALAVRA_PUBLICAR as PALAVRA } from "@/lib/farol/confirmacao";
import styles from "./farol.module.css";

function Erro({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return (
    <p className={styles.erroAcao} role="alert">
      {texto}
    </p>
  );
}

/**
 * Caixa de confirmação nominal. Some quando fechada, para que a tela em repouso
 * não tenha um campo "digite PUBLICAR" pedindo para ser preenchido por reflexo.
 */
function Confirmacao({
  id,
  rotulo,
  aviso,
  enviando,
  onConfirmar,
  onCancelar,
}: {
  id: string;
  rotulo: string;
  aviso: string;
  enviando: boolean;
  onConfirmar: (palavra: string) => void;
  onCancelar: () => void;
}) {
  const [palavra, setPalavra] = useState("");
  const combina = palavra === PALAVRA;

  return (
    <div className={styles.confirmacao}>
      <p className={styles.aviso}>{aviso}</p>
      <Field
        label={`Digite ${PALAVRA} para confirmar`}
        id={`confirmar-${id}`}
        value={palavra}
        autoComplete="off"
        onChange={(e) => setPalavra(e.target.value)}
      />
      <div className={styles.botoes}>
        <Button
          type="button"
          size="sm"
          disabled={!combina || enviando}
          onClick={() => onConfirmar(palavra)}
        >
          {enviando ? "Executando…" : rotulo}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Disparos manuais
// ---------------------------------------------------------------------------

type Alvo = "pauta" | "render" | "publicar";

const DISPAROS: { alvo: Alvo; rotulo: string; aviso: string }[] = [
  {
    alvo: "pauta",
    rotulo: "Escrever pauta agora",
    aviso:
      "Roda o agente de escuta e grava a pauta do dia. Não publica nada. Consome buscas web e uma chamada de modelo.",
  },
  {
    alvo: "render",
    rotulo: "Renderizar agora",
    aviso:
      "Escolhe a carta do dia e dispara o render no HeyGen. Não publica: cria a linha na fila, que a fase 2 publica depois. Consome crédito de render.",
  },
  {
    alvo: "publicar",
    rotulo: "Publicar agora",
    aviso:
      "Roda a fase 2: lê o estado no HeyGen e, se houver vídeo pronto, PUBLICA no Instagram (e no YouTube/TikTok, se armados). Isto vai ao ar num perfil público e não se desfaz sem apagar o post.",
  },
];

export function DisparosManuais({ armado }: { armado: boolean }) {
  const router = useRouter();
  const [aberto, setAberto] = useState<Alvo | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);

  async function disparar(alvo: Alvo, confirmacao: string) {
    setErro(null);
    setResultado(null);
    setEnviando(true);
    try {
      const resp = await fetch("/api/admin/farol/disparar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alvo, confirmacao }),
      });
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok || !dados?.ok) {
        throw new Error(typeof dados?.erro === "string" ? dados.erro : "Falha no disparo.");
      }
      // A resposta LITERAL do alvo, inclusive "desarmado" e "nada_pendente".
      // Traduzir aqui esconderia justamente o caso em que o botão "funcionou"
      // e mesmo assim nada aconteceu.
      setResultado(JSON.stringify(dados.resposta ?? {}, null, 2));
      setAberto(null);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className={styles.acoesWrap}>
      {!armado && (
        <p className={styles.aviso}>
          O FAROL está desarmado (<code>FAROL_REEL</code> ≠ <code>on</code>). Os disparos
          rodam, mas a rota de publicação sai na primeira linha sem falar com ninguém.
        </p>
      )}

      <div className={styles.botoes}>
        {DISPAROS.map((d) => (
          <Button
            key={d.alvo}
            type="button"
            size="sm"
            variant={d.alvo === "publicar" ? "primary" : "ghost"}
            onClick={() => {
              setErro(null);
              setResultado(null);
              setAberto(aberto === d.alvo ? null : d.alvo);
            }}
          >
            {d.rotulo}
          </Button>
        ))}
      </div>

      {aberto && (
        <Confirmacao
          id={`disparo-${aberto}`}
          rotulo={DISPAROS.find((d) => d.alvo === aberto)!.rotulo}
          aviso={DISPAROS.find((d) => d.alvo === aberto)!.aviso}
          enviando={enviando}
          onConfirmar={(p) => disparar(aberto, p)}
          onCancelar={() => setAberto(null)}
        />
      )}

      <Erro texto={erro} />
      {resultado && (
        <pre className={styles.resposta} aria-label="Resposta do disparo">
          {resultado}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Destravar linha de reel
// ---------------------------------------------------------------------------

export function DestravarReel({ reelId, containerId }: { reelId: string; containerId: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function destravar(confirmacao: string) {
    setErro(null);
    setEnviando(true);
    try {
      const resp = await fetch(`/api/admin/farol/reels/${reelId}/destravar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmacao }),
      });
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok || !dados?.ok) {
        throw new Error(typeof dados?.erro === "string" ? dados.erro : "Falha ao destravar.");
      }
      setAberto(false);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className={styles.acoesWrap}>
      {!aberto ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setAberto(true)}>
          Destravar (abandona o container)
        </Button>
      ) : (
        <Confirmacao
          id={`destravar-${reelId}`}
          rotulo="Destravar"
          aviso={`Abandona o container ${containerId} e devolve a linha ao fluxo automático — o próximo ciclo relê o HeyGen e pede um container novo. Não apaga a linha e não publica nada. Se o container estava a ponto de terminar, o trabalho dele é perdido.`}
          enviando={enviando}
          onConfirmar={destravar}
          onCancelar={() => setAberto(false)}
        />
      )}
      <Erro texto={erro} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Aprovação de pauta
// ---------------------------------------------------------------------------

export function PautaAcoes({
  pautaId,
  roteiroAtual,
  legendaAtual,
}: {
  pautaId: string;
  roteiroAtual: string;
  legendaAtual: string;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [roteiro, setRoteiro] = useState(roteiroAtual);
  const [legenda, setLegenda] = useState(legendaAtual);
  const [motivo, setMotivo] = useState("");
  const [reprovando, setReprovando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function decidir(corpo: Record<string, unknown>) {
    setErro(null);
    setEnviando(true);
    try {
      const resp = await fetch(`/api/admin/farol/pauta/${pautaId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok || !dados?.ok) {
        // O 422 do linter chega aqui com o motivo literal ("roteiro reprovado
        // pelo linter: termo_proibido:investimento"). É a mensagem acionável —
        // não vale substituí-la por "texto inválido".
        throw new Error(typeof dados?.erro === "string" ? dados.erro : "Falha ao decidir.");
      }
      setEditando(false);
      setReprovando(false);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className={styles.acoesWrap}>
      {!editando && !reprovando && (
        <div className={styles.botoes}>
          <Button type="button" size="sm" disabled={enviando} onClick={() => decidir({ acao: "aprovar" })}>
            {enviando ? "Enviando…" : "Aprovar"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditando(true)}>
            Editar texto
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setReprovando(true)}>
            Reprovar
          </Button>
        </div>
      )}

      {editando && (
        <div className={styles.formEdicao}>
          <label className={styles.rotuloCampo} htmlFor={`roteiro-${pautaId}`}>
            Roteiro falado
          </label>
          <textarea
            id={`roteiro-${pautaId}`}
            className={styles.textarea}
            rows={6}
            value={roteiro}
            onChange={(e) => setRoteiro(e.target.value)}
          />
          <label className={styles.rotuloCampo} htmlFor={`legenda-${pautaId}`}>
            Legenda escrita
          </label>
          <textarea
            id={`legenda-${pautaId}`}
            className={styles.textarea}
            rows={5}
            value={legenda}
            onChange={(e) => setLegenda(e.target.value)}
          />
          <p className={styles.aviso}>
            Salvar já aprova a pauta. O linter de compliance roda no servidor antes de
            gravar — texto reprovado não é salvo, e o texto original continua intacto.
          </p>
          <div className={styles.botoes}>
            <Button
              type="button"
              size="sm"
              disabled={enviando || !roteiro.trim() || !legenda.trim()}
              onClick={() => decidir({ acao: "editar", roteiro, legenda })}
            >
              {enviando ? "Medindo…" : "Salvar e aprovar"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={enviando}
              onClick={() => {
                setRoteiro(roteiroAtual);
                setLegenda(legendaAtual);
                setEditando(false);
                setErro(null);
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {reprovando && (
        <div className={styles.formEdicao}>
          <Field
            label="Motivo da reprovação (fica registrado)"
            id={`motivo-${pautaId}`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <p className={styles.aviso}>
            A linha não é apagada: ela fica marcada como recusa humana, separada da
            reprovação do linter. O reel do dia cai no texto de template.
          </p>
          <div className={styles.botoes}>
            <Button
              type="button"
              size="sm"
              disabled={enviando}
              onClick={() => decidir({ acao: "reprovar", motivo })}
            >
              {enviando ? "Enviando…" : "Confirmar reprovação"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={enviando}
              onClick={() => {
                setReprovando(false);
                setErro(null);
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      <Erro texto={erro} />
    </div>
  );
}
