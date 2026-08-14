"use client";

// ============================================================================
// Painel de assinatura eletrônica do processo (BIDCON-ASSINATURA-02).
// ----------------------------------------------------------------------------
// O QUE ESTA TELA É. A operação inteira do envelope em um lugar: escolher os
// dois PDFs, conferir quem assina, mandar, e depois acompanhar quem já assinou
// e baixar o assinado. Antes disso o envio só existia por chamada de API —
// que é exatamente o tipo de operação que não se faz com pressa e sem tela.
//
// ELA NÃO INVENTA ENDPOINT NENHUM. Fala com o que a fatia 01 já entregou:
//   POST /api/assinaturas/enviar          (FormData: 2 PDFs + signatários)
//   GET  /api/assinaturas/status          (envelope + signatários)
//   GET  /api/admin/processo/[id]/arquivos (pasta do processo no Storage)
// A validação de verdade é toda do servidor; o que existe aqui é conferência
// adiantada, para o operador descobrir que faltou um e-mail ANTES de o
// envelope nascer no provedor — porque envelope criado não se desfaz.
//
// O LINK DE ASSINATURA NÃO APARECE AQUI, E NÃO É ESQUECIMENTO. `link_assinatura`
// é URL-CAPACIDADE: quem tem o link assina no lugar da pessoa. O /status não o
// devolve de propósito (ver o cabeçalho daquela rota), e esta tela não tem como
// — nem por que — obtê-lo. Reenvio de link é fatia seguinte, e será
// server-side, pelo provedor.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { dataHoraAnoBR } from "@/lib/data-br";
import s from "./assinatura.module.css";

// Espelham os CHECKs do banco (ver lib/assinatura/tipos.ts). Se um CHECK mudar
// lá, muda aqui junto — nada no meio do caminho avisaria.
type Tone = "info" | "ok" | "muted" | "amber";

const LABEL_ENVELOPE: Record<string, string> = {
  sem_envelope: "Nenhum envelope enviado",
  rascunho: "Rascunho",
  enviado: "Enviado — aguardando assinaturas",
  parcial: "Parcialmente assinado",
  assinado: "Assinado por todos",
  recusado: "Recusado",
  expirado: "Expirado",
  cancelado: "Cancelado",
};
const TONE_ENVELOPE: Record<string, Tone> = {
  sem_envelope: "muted",
  rascunho: "muted",
  enviado: "info",
  parcial: "amber",
  assinado: "ok",
  recusado: "amber",
  expirado: "muted",
  cancelado: "muted",
};

const LABEL_SIG: Record<string, string> = {
  pendente: "Pendente",
  visualizou: "Visualizou",
  assinado: "Assinado",
  recusado: "Recusou",
};
const TONE_SIG: Record<string, Tone> = {
  pendente: "muted",
  visualizou: "info",
  assinado: "ok",
  recusado: "amber",
};

const LABEL_PAPEL: Record<string, string> = {
  cedente: "Cedente",
  cessionario: "Cessionário",
  pagadora: "Pagadora",
  comissionada: "Comissionada",
  bidcon: "Bidcon",
  testemunha: "Testemunha",
};

/** Estados em que ainda há o que esperar — só nesses a tela repergunta sozinha. */
const EM_ANDAMENTO = new Set(["enviado", "parcial", "rascunho"]);

const MAX_BYTES = 8 * 1024 * 1024; // igual ao limite do /enviar

type Papel = "cedente" | "cessionario" | "bidcon" | "testemunha";

type LinhaSignatario = {
  /** chave estável de render; não vai para o servidor. */
  chave: string;
  papel: Papel;
  nome: string;
  cpf_cnpj: string;
  email: string;
  whatsapp: string;
  /** false = linha fixa do fluxo (cedente/cessionário/Bidcon), não se remove. */
  removivel: boolean;
};

type Situacao = {
  status: string;
  envelope_id?: string;
  provedor?: string;
  enviado_em?: string | null;
  concluido_em?: string | null;
  signatarios: Array<{
    papel: string;
    nome: string;
    status: string;
    ordem: number;
    assinado_em: string | null;
  }>;
};

type Arquivo = {
  nome: string;
  tamanho: number | null;
  atualizado_em: string | null;
  assinado: boolean;
};

/**
 * WhatsApp em E.164 SEM o "+", que é o que a coluna documenta (5519988303000).
 * Um número digitado como "(19) 98830-3000" chega ao provedor sem o DDI e o
 * convite simplesmente não sai — falha silenciosa, do pior tipo. Aqui o DDI 55
 * é acrescentado quando o operador digitou só DDD + número (10 ou 11 dígitos),
 * e nada é tocado fora desse caso: número que já veio com DDI, ou com formato
 * estrangeiro, passa como está.
 */
function normalizarWhatsApp(bruto: string): string {
  const d = bruto.replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

function tamanhoLegivel(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AssinaturaPainel({
  processoId,
  clienteNome,
  clienteEmail,
  clienteTelefone,
}: {
  processoId: string;
  clienteNome: string | null;
  clienteEmail: string | null;
  clienteTelefone: string | null;
}) {
  const router = useRouter();

  // As três linhas fixas nascem preenchidas com o que a casa já sabe. O
  // cessionário é o cliente do processo; o cedente é de fora e por isso vem em
  // branco; a Bidcon entra com o nome do representante — e-mail e WhatsApp
  // ficam editáveis porque não há constante desse contato no código, e inventar
  // um endereço de assinatura seria pior do que pedir para digitar.
  const [signatarios, setSignatarios] = useState<LinhaSignatario[]>(() => [
    {
      chave: "cedente",
      papel: "cedente",
      nome: "",
      cpf_cnpj: "",
      email: "",
      whatsapp: "",
      removivel: false,
    },
    {
      chave: "cessionario",
      papel: "cessionario",
      nome: clienteNome ?? "",
      cpf_cnpj: "",
      email: clienteEmail ?? "",
      whatsapp: normalizarWhatsApp(clienteTelefone ?? ""),
      removivel: false,
    },
    {
      chave: "bidcon",
      papel: "bidcon",
      nome: "Emerson Gomes dos Santos",
      cpf_cnpj: "",
      email: "",
      whatsapp: "",
      removivel: false,
    },
  ]);

  const cessaoRef = useRef<HTMLInputElement>(null);
  const requerimentoRef = useRef<HTMLInputElement>(null);

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [situacao, setSituacao] = useState<Situacao | null>(null);
  const [arquivos, setArquivos] = useState<Arquivo[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    try {
      const [rs, ra] = await Promise.all([
        fetch(`/api/assinaturas/status?processo_id=${processoId}`, {
          cache: "no-store",
        }),
        fetch(`/api/admin/processo/${processoId}/arquivos`, { cache: "no-store" }),
      ]);
      if (rs.ok) setSituacao((await rs.json()) as Situacao);
      if (ra.ok) {
        const j = (await ra.json()) as { arquivos?: Arquivo[] };
        setArquivos(j.arquivos ?? []);
      }
    } catch {
      // Falha de rede aqui não vira erro na tela: é consulta, o botão
      // "Atualizar" existe, e um alarme vermelho por causa de um poll perdido
      // treinaria o operador a ignorar alarme vermelho.
    } finally {
      setCarregando(false);
    }
  }, [processoId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // "Ao vivo" com limite: repergunta a cada 20s SÓ enquanto há assinatura
  // pendente. Envelope concluído, recusado ou expirado não muda mais — seguir
  // consultando seria gastar banco para sempre ouvir a mesma resposta.
  const statusAtual = situacao?.status ?? null;
  useEffect(() => {
    if (!statusAtual || !EM_ANDAMENTO.has(statusAtual)) return;
    const t = setInterval(() => void carregar(), 20_000);
    return () => clearInterval(t);
  }, [statusAtual, carregar]);

  function atualizar(chave: string, campo: keyof LinhaSignatario, valor: string) {
    setSignatarios((atual) =>
      atual.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)),
    );
  }

  function adicionarTestemunha() {
    setSignatarios((atual) => [
      ...atual,
      {
        chave: `testemunha-${Date.now()}`,
        papel: "testemunha",
        nome: "",
        cpf_cnpj: "",
        email: "",
        whatsapp: "",
        removivel: true,
      },
    ]);
  }

  function remover(chave: string) {
    setSignatarios((atual) => atual.filter((l) => l.chave !== chave));
  }

  /** Mesmas regras do /enviar, conferidas antes para não criar envelope torto. */
  function conferir(cessao: File | null, requerimento: File | null): string | null {
    for (const [rotulo, f] of [
      ["Contrato de cessão", cessao],
      ["Requerimento de conta notarial", requerimento],
    ] as const) {
      if (!f) return `Selecione o PDF: ${rotulo}.`;
      if (f.size === 0) return `${rotulo}: arquivo vazio.`;
      if (f.size > MAX_BYTES) return `${rotulo}: arquivo acima de 8 MB.`;
      if (f.type !== "application/pdf") return `${rotulo}: envie um PDF.`;
    }
    for (const l of signatarios) {
      const papel = LABEL_PAPEL[l.papel] ?? l.papel;
      if (!l.nome.trim()) return `${papel}: informe o nome.`;
      if (!l.email.trim() && !l.whatsapp.trim()) {
        return `${papel}: informe e-mail ou WhatsApp.`;
      }
    }
    return null;
  }

  async function enviar() {
    if (enviando) return;
    const cessao = cessaoRef.current?.files?.[0] ?? null;
    const requerimento = requerimentoRef.current?.files?.[0] ?? null;

    const problema = conferir(cessao, requerimento);
    if (problema) {
      setErro(problema);
      setAviso(null);
      return;
    }

    setEnviando(true);
    setErro(null);
    setAviso(null);
    try {
      const form = new FormData();
      form.set("processo_id", processoId);
      form.set(
        "signatarios",
        JSON.stringify(
          signatarios.map((l) => ({
            papel: l.papel,
            nome: l.nome.trim(),
            cpf_cnpj: l.cpf_cnpj.trim() || null,
            email: l.email.trim() || null,
            whatsapp: normalizarWhatsApp(l.whatsapp) || null,
            // Todos em paralelo: a operação não tem ordem de assinatura, e
            // impor uma só atrasaria o envelope sem ganho nenhum.
            ordem: 1,
          })),
        ),
      );
      form.set("cessao", cessao as File);
      form.set("requerimento_conta", requerimento as File);

      const res = await fetch("/api/assinaturas/enviar", {
        method: "POST",
        body: form,
      });
      const j = (await res.json().catch(() => ({}))) as {
        status?: string;
        erro?: string;
        provedor_envelope_id?: string;
      };

      if (!res.ok) {
        // Quando o envelope nasceu no provedor mas o registro falhou, a rota
        // devolve a referência — ela precisa aparecer, é o que torna o caso
        // recuperável à mão.
        throw new Error(
          j.provedor_envelope_id
            ? `${j.erro ?? "Falha ao enviar."} Referência: ${j.provedor_envelope_id}`
            : (j.erro ?? "Falha ao enviar para assinatura."),
        );
      }
      if (j.status === "nao_configurado") {
        setAviso(
          "Provedor de assinatura não configurado neste ambiente. Nada foi enviado.",
        );
        return;
      }

      setAviso("Envelope enviado. Os signatários receberão o convite.");
      if (cessaoRef.current) cessaoRef.current.value = "";
      if (requerimentoRef.current) requerimentoRef.current.value = "";
      await carregar();
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao enviar para assinatura.");
    } finally {
      setEnviando(false);
    }
  }

  const status = situacao?.status ?? "sem_envelope";
  const jaEnviado = status !== "sem_envelope";
  const assinados = arquivos.filter((a) => a.assinado);

  return (
    <div className={s.wrap}>
      {/* ---------------- situação ao vivo ---------------- */}
      <div className={s.bloco}>
        <div className={s.blocoTitulo}>
          <span>Situação</span>
          <Button
            variant="link"
            size="sm"
            type="button"
            onClick={() => void carregar()}
          >
            Atualizar
          </Button>
        </div>

        {carregando ? (
          <p className={s.ajuda}>Consultando…</p>
        ) : (
          <>
            <div className={s.blocoTitulo}>
              <Badge tone={TONE_ENVELOPE[status] ?? "muted"}>
                {LABEL_ENVELOPE[status] ?? status}
              </Badge>
              {situacao?.enviado_em && (
                <span className={s.cardData}>
                  Enviado em {dataHoraAnoBR(situacao.enviado_em)}
                </span>
              )}
            </div>

            {jaEnviado && situacao?.signatarios?.length ? (
              <div className={s.cards}>
                {situacao.signatarios.map((sig, i) => (
                  <div key={`${sig.papel}-${i}`} className={s.cardSig}>
                    <span className={s.cardNome}>
                      <span className={s.cardPapel}>
                        {LABEL_PAPEL[sig.papel] ?? sig.papel}
                      </span>
                      <span>{sig.nome}</span>
                      {sig.assinado_em && (
                        <span className={s.cardData}>
                          Assinou em {dataHoraAnoBR(sig.assinado_em)}
                        </span>
                      )}
                    </span>
                    <Badge tone={TONE_SIG[sig.status] ?? "muted"}>
                      {LABEL_SIG[sig.status] ?? sig.status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : null}

            {assinados.length > 0 && (
              <div className={s.botoes}>
                {assinados.map((a) => (
                  <Button
                    key={a.nome}
                    variant="ghost"
                    size="sm"
                    href={`/api/admin/processo/${processoId}/arquivos?arquivo=${encodeURIComponent(a.nome)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Baixar assinado: {a.nome.startsWith("cessao") ? "cessão" : "requerimento"}
                  </Button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ---------------- arquivos já na pasta ---------------- */}
      <div className={s.bloco}>
        <div className={s.blocoTitulo}>
          <span>Arquivos do processo</span>
        </div>
        {arquivos.length === 0 ? (
          <p className={s.ajuda}>Nenhum arquivo na pasta deste processo ainda.</p>
        ) : (
          <ul className={s.arquivos}>
            {arquivos.map((a) => (
              <li key={a.nome} className={s.arquivo}>
                <span className={s.arquivoNome}>
                  {a.nome}
                  {a.assinado ? " " : ""}
                  {a.assinado && <Badge tone="ok">assinado</Badge>}
                </span>
                <span className={s.arquivoMeta}>
                  {tamanhoLegivel(a.tamanho)}
                  {a.atualizado_em ? ` · ${dataHoraAnoBR(a.atualizado_em)}` : ""}
                  {" · "}
                  <a
                    href={`/api/admin/processo/${processoId}/arquivos?arquivo=${encodeURIComponent(a.nome)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---------------- documentos a enviar ---------------- */}
      <div className={s.bloco}>
        <div className={s.blocoTitulo}>
          <span>Documentos a assinar</span>
        </div>
        <p className={s.ajuda}>
          Os dois PDFs vão no mesmo envelope: todos os signatários assinam as duas
          peças no mesmo link.
        </p>
        <div className={s.campo}>
          <label className={s.rotulo} htmlFor="pdf-cessao">
            Contrato de cessão (PDF)
          </label>
          <input
            id="pdf-cessao"
            ref={cessaoRef}
            className={s.file}
            type="file"
            accept="application/pdf"
            disabled={enviando}
          />
        </div>
        <div className={s.campo}>
          <label className={s.rotulo} htmlFor="pdf-requerimento">
            Requerimento de abertura de conta notarial (PDF)
          </label>
          <input
            id="pdf-requerimento"
            ref={requerimentoRef}
            className={s.file}
            type="file"
            accept="application/pdf"
            disabled={enviando}
          />
        </div>
      </div>

      {/* ---------------- signatários ---------------- */}
      <div className={s.bloco}>
        <div className={s.blocoTitulo}>
          <span>Signatários</span>
          <Button
            variant="link"
            size="sm"
            type="button"
            onClick={adicionarTestemunha}
            disabled={enviando}
          >
            + testemunha
          </Button>
        </div>
        <p className={s.ajuda}>
          Cada signatário precisa de e-mail ou WhatsApp — é por onde o convite sai.
          WhatsApp com DDI: 5519988303000.
        </p>

        <div className={s.signatarios}>
          {signatarios.map((l) => (
            <div key={l.chave} className={s.signatario}>
              <div className={s.signatarioTopo}>
                <span className={s.papel}>{LABEL_PAPEL[l.papel]}</span>
                {l.removivel && (
                  <Button
                    variant="link"
                    size="sm"
                    type="button"
                    onClick={() => remover(l.chave)}
                    disabled={enviando}
                  >
                    remover
                  </Button>
                )}
              </div>
              <div className={s.grade}>
                <div className={s.campo}>
                  <label className={s.rotulo} htmlFor={`nome-${l.chave}`}>
                    Nome completo
                  </label>
                  <input
                    id={`nome-${l.chave}`}
                    className={s.input}
                    value={l.nome}
                    onChange={(e) => atualizar(l.chave, "nome", e.target.value)}
                    disabled={enviando}
                    autoComplete="off"
                  />
                </div>
                <div className={s.campo}>
                  <label className={s.rotulo} htmlFor={`doc-${l.chave}`}>
                    CPF/CNPJ (opcional)
                  </label>
                  <input
                    id={`doc-${l.chave}`}
                    className={s.input}
                    value={l.cpf_cnpj}
                    onChange={(e) => atualizar(l.chave, "cpf_cnpj", e.target.value)}
                    disabled={enviando}
                    inputMode="numeric"
                    autoComplete="off"
                  />
                </div>
                <div className={s.campo}>
                  <label className={s.rotulo} htmlFor={`email-${l.chave}`}>
                    E-mail
                  </label>
                  <input
                    id={`email-${l.chave}`}
                    className={s.input}
                    type="email"
                    value={l.email}
                    onChange={(e) => atualizar(l.chave, "email", e.target.value)}
                    disabled={enviando}
                    autoComplete="off"
                  />
                </div>
                <div className={s.campo}>
                  <label className={s.rotulo} htmlFor={`zap-${l.chave}`}>
                    WhatsApp
                  </label>
                  <input
                    id={`zap-${l.chave}`}
                    className={s.input}
                    value={l.whatsapp}
                    onChange={(e) => atualizar(l.chave, "whatsapp", e.target.value)}
                    // Normaliza na saída do campo, não no envio: o operador vê
                    // o número que vai realmente ser usado, e corrige se ficou
                    // errado. Normalizar escondido é o mesmo que não avisar.
                    onBlur={(e) =>
                      atualizar(l.chave, "whatsapp", normalizarWhatsApp(e.target.value))
                    }
                    disabled={enviando}
                    inputMode="numeric"
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ---------------- envio ---------------- */}
      <div className={s.bloco}>
        {erro && (
          <p className={s.erro} role="alert">
            {erro}
          </p>
        )}
        {aviso && <p className={s.ok}>{aviso}</p>}
        {jaEnviado && (
          <p className={s.ajuda}>
            Este processo já tem envelope. Enviar de novo cria um envelope novo no
            provedor — o anterior continua existindo.
          </p>
        )}
        <div className={s.botoes}>
          <Button type="button" onClick={() => void enviar()} disabled={enviando}>
            {enviando ? "Enviando…" : "Enviar para assinatura"}
          </Button>
        </div>
      </div>
    </div>
  );
}
