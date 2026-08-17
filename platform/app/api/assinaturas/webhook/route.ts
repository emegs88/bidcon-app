// ============================================================================
// POST /api/assinaturas/webhook — o provedor avisa que algo mudou.
// ----------------------------------------------------------------------------
// Endpoint PÚBLICO: qualquer um na internet pode fazer POST aqui. A única coisa
// que separa o provedor de um atacante é o segredo no header
// `x-webhook-signature`, comparado em tempo constante (lib/assinatura/seguranca).
//
// POR QUE HEADER E NÃO QUERY STRING:
// query string vaza em log de servidor, em Referer e no histórico de proxy. Um
// segredo em `?secret=` é um segredo publicado devagar. Igual ao padrão já usado
// em /api/whatsapp e /api/instagram/webhook.
//
// POR QUE QUASE TUDO DEVOLVE 200:
// provedor que recebe 4xx/5xx REENVIA — e reenvia com backoff crescente por
// horas. Só o que é falha de autenticação merece 401 (aí o reenvio é o certo:
// pode ser deploy sem env). Evento que não casa com nenhum envelope é gravado
// no log e reconhecido com 200, senão a fila do provedor entope para sempre.
//
// LGPD: o corpo cru vai para assinatura_eventos (auditoria interna, sem policy
// de select para authenticated). Nada de PII em log de aplicação.
// ============================================================================
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  bucketAssinatura,
  obterProvider,
  pathDocumento,
  providerConfigurado,
  segredoConfere,
} from "@/lib/assinatura";

export const dynamic = "force-dynamic";

/** Estados em que o envelope não muda mais — fecham `concluido_em`. */
const TERMINAIS = new Set(["assinado", "recusado", "expirado", "cancelado"]);

export async function POST(req: Request) {
  // 1) Portão. Antes de ler o corpo, antes de tocar em qualquer coisa.
  // SEM MODO TOLERANTE — nem em teste, nem em preview. Um endpoint que aceita
  // request sem header válido aceita `doc_signed` FORJADO: qualquer um marcaria
  // um contrato como assinado. Não há ambiente em que isso seja aceitável, então
  // não existe flag para desligar. Sem a env, segredoConfere devolve false e
  // tudo cai aqui: falha FECHADA.
  if (
    !segredoConfere(
      req.headers.get("x-webhook-signature"),
      process.env.ZAPSIGN_WEBHOOK_SECRET
    )
  ) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }

  // Deploy com segredo mas sem provedor: não há como interpretar o corpo.
  // 200 para não deixar o provedor reenviando um evento que nunca vai casar.
  if (!providerConfigurado()) {
    return NextResponse.json({ ok: true, ignorado: "sem_provedor" });
  }

  const bruto = await req.text();
  let payload: unknown = null;
  try {
    payload = JSON.parse(bruto);
  } catch {
    // Corpo que não é JSON: reconhece e descarta. Reenviar não conserta.
    return NextResponse.json({ ok: true, ignorado: "corpo_invalido" });
  }

  const provider = obterProvider();
  const evento = provider.interpretarEvento(payload);
  const admin = createAdminClient();

  // 2) Localiza o envelope. Pode não existir (evento de outra conta, ou de um
  // envio que não chegou a gravar) — o log guarda o evento mesmo assim, com
  // envelope_id nulo, e é assim que essa lacuna fica visível depois.
  const { data: envelope } = evento.provedorEnvelopeId
    ? await admin
        .from("assinatura_envelopes")
        .select("id, processo_id, status")
        .eq("provedor_envelope_id", evento.provedorEnvelopeId)
        .maybeSingle()
    : { data: null };

  const env = envelope as
    | { id: string; processo_id: string; status: string }
    | null;

  // 3) Auditoria PRIMEIRO: o que o provedor disse fica gravado mesmo que os
  // passos seguintes falhem. `id` é GENERATED ALWAYS AS IDENTITY — não entra
  // no insert, o banco recusaria.
  await admin.from("assinatura_eventos").insert({
    envelope_id: env?.id ?? null,
    tipo: evento.tipoCru,
    payload,
  });

  if (!env) {
    return NextResponse.json({ ok: true, ignorado: "envelope_desconhecido" });
  }

  // 4) Signatários — casados pelo id do provedor, um a um.
  for (const s of evento.signatarios) {
    const campos: Record<string, unknown> = { status: s.status };
    if (s.status === "assinado") campos.assinado_em = new Date().toISOString();
    await admin
      .from("assinatura_signatarios")
      .update(campos)
      .eq("envelope_id", env.id)
      .eq("provedor_signer_id", s.provedorSignerId);
  }

  // 5) Envelope. `statusEnvelope` nulo = evento que não fala de status (e-mail
  // entregue, por exemplo): não mexe no banco.
  if (evento.statusEnvelope) {
    const campos: Record<string, unknown> = {
      status: evento.statusEnvelope,
      atualizado_em: new Date().toISOString(),
    };
    if (TERMINAIS.has(evento.statusEnvelope)) {
      campos.concluido_em = new Date().toISOString();
    }
    await admin.from("assinatura_envelopes").update(campos).eq("id", env.id);
  }

  // 6) PDF assinado. A URL do provedor é TEMPORÁRIA — baixar e reguardar no
  // bucket da casa é o que faz a prova sobreviver ao link expirar. É por isso
  // que `pdf_assinado_path` guarda o path interno, nunca a URL do provedor.
  if (evento.statusEnvelope === "assinado" && evento.urlArquivoAssinado) {
    try {
      const pdf = await provider.baixarAssinado(evento.urlArquivoAssinado);
      const bucket = bucketAssinatura();

      // ⚠️ NÃO MEDIDO: a ZapSign devolve UM `signed_file` por documento-envelope,
      // e este envelope carrega duas peças (cessão + requerimento). Se esse
      // arquivo traz as duas ou só a principal é coisa que só o primeiro envio
      // real responde. Por isso o path é do ENVELOPE, não de um item: o nome
      // não afirma o que ainda não foi verificado. As duas linhas de contratos
      // apontam para ele porque as duas foram assinadas NESSE envelope — isso
      // é verdade em nível de envelope, independente do empacotamento.
      const path = pathDocumento(env.processo_id, "envelope", true);
      const up = await admin.storage.from(bucket).upload(path, pdf, {
        contentType: "application/pdf",
        upsert: false,
      });

      if (!up.error) {
        await admin
          .from("contratos")
          .update({
            status: "assinado",
            pdf_assinado_path: path,
            assinado_em: new Date().toISOString(),
          })
          .eq("envelope_id", env.id);
      }
    } catch {
      // Falha ao baixar não pode virar 5xx: o status do envelope JÁ foi gravado
      // acima, e um reenvio do provedor repetiria tudo. O evento está no log.
    }
  }

  return NextResponse.json({ ok: true });
}
