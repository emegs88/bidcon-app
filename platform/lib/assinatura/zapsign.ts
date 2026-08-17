// ============================================================================
// BIDCON-ASSINATURA-01 — adapter ZapSign.
// ----------------------------------------------------------------------------
// Único arquivo que conhece o formato de fio da ZapSign. Tudo que é regra da
// casa mora em tipos.ts / seguranca.ts; aqui é só tradução.
//
// COMO OS DOIS DOCUMENTOS VIRAM UM LINK SÓ:
// a ZapSign aceita `extra_docs` no mesmo POST de criação. O primeiro documento
// vira o principal (`base64_pdf`) e os demais entram como extras; os signatários
// são do ENVELOPE, então cada pessoa recebe UM link e assina os dois. É por isso
// que a fatia não cria dois documentos separados.
//
// ⚠️ LIMITE DE MEDIÇÃO — LEIA ANTES DE CONFIAR:
// os nomes de campo abaixo (`base64_pdf`, `extra_docs`, `sign_url`, `signed_file`,
// `event_type`) vieram da documentação da ZapSign, NÃO de uma chamada medida
// contra conta real — não temos token de sandbox nesta fatia. O primeiro envio
// real é um teste de integração, não uma formalidade. Se um nome estiver errado,
// o conserto é local: este arquivo, sem tocar rota nem banco. Foi exatamente
// para isso que o adapter existe.
//
// LGPD: nada de PII em log. Erro do provedor sobe como mensagem genérica; o
// corpo cru vai para assinatura_eventos (auditoria interna), nunca ao cliente.
// ============================================================================
import type {
  AssinaturaProvider,
  EntradaEnvelope,
  EnvelopeCriado,
  EventoNormalizado,
  SignatarioCriado,
  StatusEnvelope,
  StatusSignatario,
} from "./tipos";

/** Fallback só para o caso de a env faltar. A base real vem de ZAPSIGN_API_URL. */
const BASE_PADRAO = "https://api.zapsign.com.br/api/v1";

// --- helpers puros -----------------------------------------------------------

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function lista(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * WhatsApp chega em E.164 sem "+" (5519988303000); a ZapSign quer o DDI e o
 * número em campos separados. Só trata o DDI 55 — número estrangeiro sai sem
 * telefone (o provedor cai no e-mail) em vez de ir truncado errado.
 */
export function partirTelefone(
  whatsapp: string | null | undefined
): { pais: string; numero: string } | null {
  const so = texto(whatsapp).replace(/\D/g, "");
  if (!so.startsWith("55") || so.length < 12) return null;
  return { pais: "55", numero: so.slice(2) };
}

/** Status de UM signatário, no vocabulário da casa. */
export function mapearStatusSignatario(bruto: string): StatusSignatario {
  switch (bruto.toLowerCase()) {
    case "signed":
      return "assinado";
    case "refused":
      return "recusado";
    case "link-opened":
    case "link_opened":
    case "viewed":
      return "visualizou";
    default:
      return "pendente";
  }
}

/**
 * Status do ENVELOPE. 'parcial' não existe na ZapSign — é derivado: documento
 * ainda pendente + pelo menos um signatário já assinado. Sem isso o admin veria
 * "enviado" até o último assinar, e não saberia de quem está esperando.
 */
export function mapearStatusEnvelope(
  bruto: string,
  statusSignatarios: StatusSignatario[]
): StatusEnvelope | null {
  switch (bruto.toLowerCase()) {
    case "signed":
      return "assinado";
    case "refused":
      return "recusado";
    case "canceled":
    case "cancelled":
    case "deleted":
      return "cancelado";
    case "expired":
      return "expirado";
    case "pending":
    case "new":
      return statusSignatarios.some((s) => s === "assinado") ? "parcial" : "enviado";
    default:
      // Evento que não fala de status (ex.: e-mail entregue): não mexe no banco.
      return null;
  }
}

/**
 * Traduz o corpo do webhook. PURA — sem rede, sem env, sem Date.now().
 * É a única regra de negócio de verdade do adapter, por isso mora exposta e
 * tem teste próprio.
 */
export function interpretarEventoZapSign(payload: unknown): EventoNormalizado {
  const p = objeto(payload);
  const statusDoc = texto(p.status);

  const signatarios = lista(p.signers)
    .map((s) => {
      const o = objeto(s);
      return {
        provedorSignerId: texto(o.token),
        status: mapearStatusSignatario(texto(o.status)),
      };
    })
    .filter((s) => s.provedorSignerId !== "");

  return {
    // `event_type` nem sempre vem (depende de como o hook foi configurado);
    // o fallback mantém o log de auditoria com alguma coisa útil.
    tipoCru: texto(p.event_type) || (statusDoc ? `status:${statusDoc}` : "desconhecido"),
    provedorEnvelopeId: texto(p.token) || null,
    statusEnvelope: mapearStatusEnvelope(
      statusDoc,
      signatarios.map((s) => s.status)
    ),
    urlArquivoAssinado: texto(p.signed_file) || null,
    signatarios,
  };
}

// --- adapter -----------------------------------------------------------------

export function criarProviderZapSign(): AssinaturaProvider {
  // Env lida DENTRO da factory, nunca no topo do módulo: importar este arquivo
  // num teste não pode exigir credencial.
  const token = (process.env.ZAPSIGN_API_TOKEN ?? "").trim();
  // ZAPSIGN_API_URL é a env que JÁ existe na Vercel (All Environments) e hoje
  // aponta para o sandbox. Nada de base hardcoded: trocar sandbox↔produção é
  // mudar env, não mudar código — e não existe deploy que rode no ambiente
  // errado por esquecimento de merge.
  const base = (process.env.ZAPSIGN_API_URL || BASE_PADRAO).trim().replace(/\/+$/, "");
  if (!token) {
    throw new Error("ZAPSIGN_API_TOKEN ausente.");
  }

  return {
    nome: "zapsign",

    async criarEnvelope(entrada: EntradaEnvelope): Promise<EnvelopeCriado> {
      const [principal, ...extras] = entrada.documentos;
      if (!principal) {
        throw new Error("Envelope sem documentos.");
      }

      const corpo = {
        name: entrada.titulo,
        lang: "pt-br",
        base64_pdf: Buffer.from(principal.pdf).toString("base64"),
        extra_docs: extras.map((d) => ({
          name: d.titulo,
          base64_pdf: Buffer.from(d.pdf).toString("base64"),
        })),
        signers: entrada.signatarios.map((s) => {
          const tel = partirTelefone(s.whatsapp);
          return {
            name: s.nome,
            email: s.email || undefined,
            phone_country: tel?.pais,
            phone_number: tel?.numero,
            send_automatic_email: Boolean(s.email),
            send_automatic_whatsapp: Boolean(tel),
          };
        }),
      };

      const res = await fetch(`${base}/docs/`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(corpo),
      });

      if (!res.ok) {
        // Corpo do erro NÃO entra na exceção: pode ecoar os dados dos
        // signatários que acabamos de enviar. Diagnóstico fica no status.
        throw new Error(`ZapSign recusou a criação do envelope (HTTP ${res.status}).`);
      }

      const json = objeto(await res.json().catch(() => ({})));
      const envelopeId = texto(json.token);
      if (!envelopeId) {
        throw new Error("ZapSign não devolveu o identificador do envelope.");
      }

      // A ZapSign devolve os signers na MESMA ordem em que foram enviados; é
      // por índice que o papel volta a colar em cada link.
      const devolvidos = lista(json.signers).map(objeto);
      const signatarios: SignatarioCriado[] = entrada.signatarios.map((s, i) => {
        const d = objeto(devolvidos[i]);
        return {
          ...s,
          ordem: s.ordem ?? 1,
          provedorSignerId: texto(d.token) || null,
          linkAssinatura: texto(d.sign_url) || null,
        };
      });

      return { provedorEnvelopeId: envelopeId, signatarios };
    },

    interpretarEvento: interpretarEventoZapSign,

    async baixarAssinado(url: string): Promise<Uint8Array> {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Falha ao baixar o PDF assinado (HTTP ${res.status}).`);
      }
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
