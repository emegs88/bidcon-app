// ============================================================================
// POST /api/assinaturas/enviar — cria o envelope de assinatura do processo.
// ----------------------------------------------------------------------------
// Dois documentos, UM link: contrato de cessão + requerimento de abertura da
// conta notarial (Anexo II do 5º Tabelionato). Todos os signatários assinam os
// dois — quem monta isso é o adapter (lib/assinatura/zapsign.ts).
//
// POR QUE OS PDFs CHEGAM POR UPLOAD, E NÃO SÃO GERADOS AQUI:
// não existe gerador de PDF neste repositório — medido, não suposto:
//   • package.json não tem nenhuma dependência de PDF (sem pdf-lib/pdfkit/etc.);
//   • lib/contratos.ts devolve { titulo, paragrafos } — TEXTO — e o próprio
//     comentário dele diz "o PDF (quando houver)";
//   • `contratos.pdf_path` só aparece em leitura (admin/processos/[id]/page.tsx);
//     nada no repositório escreve essa coluna.
// Além disso o Anexo II é formulário do tabelionato: é documento de fora, não
// algo que o app componha. Então o admin envia os dois PDFs prontos. Inventar
// um gerador aqui seria fabricar capacidade que não existe.
//
// Padrão das rotas privilegiadas (igual a /api/admin/kyc/[id]/decidir):
//   1) createClient() (anon+RLS) identifica o chamador;
//   2) guard de papel inline (profiles.tipo === 'admin');
//   3) createAdminClient() (service_role) faz Storage e escrita.
//
// LGPD: `link_assinatura` é URL-CAPACIDADE (quem tem o link assina). Ele é
// gravado no banco sob is_admin() e NUNCA sai nesta resposta.
// ============================================================================
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  bucketAssinatura,
  obterProvider,
  pathDocumento,
  providerConfigurado,
  TIPO_CONTRATO_POR_ITEM,
  type ItemDocumento,
  type PapelSignatario,
  type SignatarioEntrada,
} from "@/lib/assinatura";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 8 MB por PDF — mesmo teto de lib/kyc.ts (validarArquivo). */
const MAX_BYTES = 8 * 1024 * 1024;

/** Papéis aceitos — espelha o CHECK de assinatura_signatarios.papel. */
const PAPEIS: readonly PapelSignatario[] = [
  "cedente",
  "cessionario",
  "pagadora",
  "comissionada",
  "bidcon",
  "testemunha",
];

/**
 * Os dois itens do envelope, na ordem em que vão ao provedor. O PRIMEIRO vira o
 * documento principal; o resto entra como extra. Ordem fixa = link previsível.
 */
const ITENS: { item: ItemDocumento; campo: string; titulo: string }[] = [
  { item: "cessao", campo: "cessao", titulo: "Contrato de cessão" },
  {
    item: "requerimento-conta",
    campo: "requerimento_conta",
    titulo: "Requerimento de abertura de conta notarial",
  },
];

/**
 * PDF-only, de propósito. `validarArquivo` (lib/kyc) também aceita imagem
 * quando permitirPdf=true; aqui imagem não serve — o provedor assina PDF.
 */
function validarPdf(arquivo: File): string | null {
  if (arquivo.size <= 0) return "Arquivo vazio.";
  if (arquivo.size > MAX_BYTES) return "Arquivo acima de 8 MB.";
  if (arquivo.type !== "application/pdf") return "Envie um PDF.";
  return null;
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Lê a lista de signatários do campo `signatarios` (JSON). Devolve mensagem de
 * erro em vez de jogar: entrada de admin também é entrada não confiável.
 */
function lerSignatarios(cru: string): { erro: string } | { lista: SignatarioEntrada[] } {
  let bruto: unknown;
  try {
    bruto = JSON.parse(cru);
  } catch {
    return { erro: "Lista de signatários inválida." };
  }
  if (!Array.isArray(bruto) || bruto.length === 0) {
    return { erro: "Informe ao menos um signatário." };
  }

  const lista: SignatarioEntrada[] = [];
  for (const item of bruto) {
    const o = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const papel = texto(o.papel) as PapelSignatario;
    const nome = texto(o.nome);
    const email = texto(o.email);
    const whatsapp = texto(o.whatsapp).replace(/\D/g, "");

    if (!PAPEIS.includes(papel)) {
      return { erro: `Papel inválido: ${papel || "(vazio)"}.` };
    }
    if (!nome) {
      return { erro: "Signatário sem nome." };
    }
    // Sem e-mail e sem WhatsApp o provedor não tem como entregar o link — a
    // pessoa entraria no envelope e nunca seria avisada. Falha cedo.
    if (!email && !whatsapp) {
      return { erro: `Signatário ${nome} precisa de e-mail ou WhatsApp.` };
    }

    const ordem = Number(o.ordem);
    lista.push({
      papel,
      nome,
      cpfCnpj: texto(o.cpf_cnpj) || null,
      email: email || null,
      whatsapp: whatsapp || null,
      ordem: Number.isInteger(ordem) && ordem > 0 ? ordem : 1,
    });
  }
  return { lista };
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const { data: perfil } = await supabase
    .from("profiles")
    .select("tipo")
    .eq("id", user.id)
    .maybeSingle();
  if (!perfil || perfil.tipo !== "admin") {
    return NextResponse.json({ erro: "Sem permissão." }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ erro: "Requisição inválida." }, { status: 400 });
  }

  const processoId = texto(form.get("processo_id"));
  if (!UUID_RE.test(processoId)) {
    return NextResponse.json({ erro: "Processo inválido." }, { status: 422 });
  }

  const lidos = lerSignatarios(texto(form.get("signatarios")));
  if ("erro" in lidos) {
    return NextResponse.json({ erro: lidos.erro }, { status: 422 });
  }

  // Os DOIS PDFs são obrigatórios: o envelope existe justamente para que as
  // duas peças sejam assinadas no mesmo ato.
  const arquivos: { item: ItemDocumento; titulo: string; arquivo: File }[] = [];
  for (const { item, campo, titulo } of ITENS) {
    const arquivo = form.get(campo);
    if (!(arquivo instanceof File)) {
      return NextResponse.json({ erro: `Envie o PDF: ${titulo}.` }, { status: 422 });
    }
    const invalido = validarPdf(arquivo);
    if (invalido) {
      return NextResponse.json({ erro: `${titulo}: ${invalido}` }, { status: 422 });
    }
    arquivos.push({ item, titulo, arquivo });
  }

  // Sem provedor selecionado a fatia inteira não escreve nada — mesmo contrato
  // de resposta de /api/processo/esign, para não haver dois formatos no app.
  if (!providerConfigurado()) {
    return NextResponse.json({ status: "nao_configurado" });
  }

  const admin = createAdminClient();

  const { data: processo } = await admin
    .from("processos")
    .select("id")
    .eq("id", processoId)
    .maybeSingle();
  if (!processo) {
    return NextResponse.json({ erro: "Processo não encontrado." }, { status: 404 });
  }

  // --- Storage: guarda o que VAI ser assinado ------------------------------
  const bucket = bucketAssinatura();
  const agora = Date.now();
  const enviados: { item: ItemDocumento; titulo: string; path: string; pdf: Uint8Array }[] = [];

  /** Remove os PDFs já subidos. Best-effort: falha aqui não vira erro do admin. */
  const limpar = async () => {
    const paths = enviados.map((e) => e.path);
    if (paths.length) await admin.storage.from(bucket).remove([...paths]);
  };

  for (const { item, titulo, arquivo } of arquivos) {
    const path = pathDocumento(processoId, item, false, agora);
    const pdf = new Uint8Array(await arquivo.arrayBuffer());
    const up = await admin.storage.from(bucket).upload(path, pdf, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (up.error) {
      await limpar();
      return NextResponse.json({ erro: "Falha ao armazenar o documento." }, { status: 400 });
    }
    enviados.push({ item, titulo, path, pdf });
  }

  // --- Provedor -------------------------------------------------------------
  let envelope;
  try {
    envelope = await obterProvider().criarEnvelope({
      titulo: `Cessão de cota — processo ${processoId.slice(0, 8)}`,
      documentos: enviados.map((e) => ({ item: e.item, titulo: e.titulo, pdf: e.pdf })),
      signatarios: lidos.lista,
    });
  } catch (falha) {
    // Mensagem do provedor NÃO sobe: pode ecoar os dados dos signatários.
    // Mas o motivo tem de existir em ALGUM lugar — sem isso, "não foi
    // possível" cobre igualmente credencial ausente, credencial errada,
    // PDF recusado e provedor fora do ar, e o operador não sabe se o
    // problema é dele ou nosso. O texto vai para o log do servidor.
    const motivo = falha instanceof Error ? falha.message : String(falha);
    console.error("[assinaturas/enviar] provedor recusou:", motivo);
    await limpar();

    // Falta de configuração é nossa, não do provedor: essas mensagens são
    // fixas, lançadas pela nossa própria factory, e não carregam dado de
    // signatário. Devolver o estado certo evita o operador ficar caçando
    // erro no PDF quando o que falta é a env.
    const semCredencial =
      motivo.includes("ZAPSIGN_API_TOKEN") || motivo.includes("ESIGN_PROVIDER");
    if (semCredencial) {
      return NextResponse.json({ status: "nao_configurado" });
    }

    return NextResponse.json(
      { erro: "Não foi possível criar o envelope de assinatura." },
      { status: 400 }
    );
  }

  // --- Banco ----------------------------------------------------------------
  const { data: linha, error: erroEnvelope } = await admin
    .from("assinatura_envelopes")
    .insert({
      processo_id: processoId,
      provedor: "zapsign",
      provedor_envelope_id: envelope.provedorEnvelopeId,
      status: "enviado",
      criado_por: user.id,
      enviado_em: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  const envelopeId = (linha as { id: string } | null)?.id ?? null;
  if (erroEnvelope || !envelopeId) {
    // O envelope JÁ EXISTE no provedor e não dá para desfazer o envio. Os
    // arquivos ficam (são a prova do que foi enviado) e o id do provedor sobe
    // na resposta para que a operação seja recuperável à mão. É admin-only.
    return NextResponse.json(
      {
        erro: "Envelope criado no provedor, mas não registrado. Anote a referência.",
        provedor_envelope_id: envelope.provedorEnvelopeId,
      },
      { status: 500 }
    );
  }

  const { error: erroSignatarios } = await admin.from("assinatura_signatarios").insert(
    envelope.signatarios.map((s) => ({
      envelope_id: envelopeId,
      papel: s.papel,
      nome: s.nome,
      cpf_cnpj: s.cpfCnpj ?? null,
      email: s.email ?? null,
      whatsapp: s.whatsapp ?? null,
      provedor_signer_id: s.provedorSignerId,
      link_assinatura: s.linkAssinatura,
      status: "pendente",
      ordem: s.ordem,
    }))
  );
  if (erroSignatarios) {
    return NextResponse.json(
      { erro: "Envelope criado, mas os signatários não foram registrados.", envelope_id: envelopeId },
      { status: 500 }
    );
  }

  // --- contratos: select → insert/update, NUNCA upsert ---------------------
  // O índice único é PARCIAL (só nos tipos novos); upsert exigiria um conflict
  // target que não cobre os tipos antigos e quebraria a regeneração feita pela
  // RPC gerar_contrato (insert puro). Por isso a leitura vem antes da escrita.
  for (const e of enviados) {
    const tipo = TIPO_CONTRATO_POR_ITEM[e.item];
    const { data: existente } = await admin
      .from("contratos")
      .select("id")
      .eq("processo_id", processoId)
      .eq("tipo", tipo)
      .maybeSingle();

    const campos = {
      status: "enviado",
      pdf_path: e.path,
      envelope_id: envelopeId,
      provedor_ref: envelope.provedorEnvelopeId,
    };

    if (existente) {
      await admin.from("contratos").update(campos).eq("id", (existente as { id: string }).id);
    } else {
      await admin.from("contratos").insert({
        processo_id: processoId,
        tipo,
        // `dados` é NOT NULL: snapshot factual mínimo do que foi enviado.
        // Sem valor, sem administradora, sem comissão — nada de PII aqui.
        dados: { item: e.item, provedor: "zapsign", enviado_em: new Date().toISOString() },
        ...campos,
      });
    }
  }

  // `link_assinatura` NÃO sai daqui: é URL-capacidade.
  return NextResponse.json({ status: "enviado", envelope_id: envelopeId });
}
