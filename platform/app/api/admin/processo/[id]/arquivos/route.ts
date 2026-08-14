// ============================================================================
// GET /api/admin/processo/[id]/arquivos — o que já existe na pasta do processo.
// BIDCON-ASSINATURA-02, entrega mínima do painel.
// ----------------------------------------------------------------------------
// POR QUE ESTA ROTA EXISTE. O painel de assinatura precisa responder duas
// perguntas que o /status não responde, porque o /status lê o BANCO e estas
// duas moram no STORAGE:
//   1. "os PDFs desse processo já estão lá?" — antes do envio, o operador
//      confere o que subiu;
//   2. "cadê o PDF assinado?" — depois do webhook, o arquivo assinado é
//      gravado por pathDocumento(..., assinado=true) na MESMA pasta, com
//      `-assinado-` no nome. Uma rota cobre os dois casos; não existe rota de
//      download separada de propósito.
//
// DOIS MODOS, UMA ROTA:
//   • sem `arquivo`  -> LISTA (JSON). Não devolve URL nenhuma.
//   • com `arquivo`  -> ABRE: cunha uma URL de 60s na hora e redireciona.
//
// POR QUE A LISTA NÃO DEVOLVE URL. Uma URL assinada vive 60s. Se ela viesse na
// listagem, o link estaria morto um minuto depois de a tela carregar — e o
// operador clicaria num link quebrado sem entender por quê. Cunhando no
// clique, o link nunca vence no meio da operação e não fica solto no HTML.
//
// TRAVESSIA DE CAMINHO É IMPOSSÍVEL AQUI. O parâmetro `arquivo` é um NOME, e
// só é aceito se casar exatamente com um nome que o próprio list() devolveu na
// pasta deste processo. O caminho final é sempre montado aqui a partir do UUID
// já validado. Quem chama escolhe QUAL ARQUIVO DA PASTA abrir — nunca QUAL
// PASTA ler.
//
// SÓ LÊ. Nenhuma escrita: nem no banco, nem no bucket.
// ============================================================================
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { bucketAssinatura } from "@/lib/assinatura";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 60s, o mesmo padrão de lib/kyc.ts e do signedUrlProcesso da tela de detalhe.
// O navegador segue o redirecionamento na hora; a validade curta existe para
// que a URL que passar por um histórico ou um log de proxy esteja morta quando
// alguém a encontrar.
const TTL_S = 60;

type Arquivo = {
  nome: string;
  tamanho: number | null;
  atualizado_em: string | null;
  /** true quando o nome carrega `-assinado-` (ver lib/assinatura/pathDocumento). */
  assinado: boolean;
};

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  // Guarda inline (profiles.tipo === 'admin'), o mesmo padrão de
  // /api/assinaturas/enviar e /api/assinaturas/status — e só DEPOIS o
  // service_role. Nunca o contrário.
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

  const processoId = String(params.id ?? "").trim();
  if (!UUID_RE.test(processoId)) {
    return NextResponse.json({ erro: "Processo inválido." }, { status: 422 });
  }

  const admin = createAdminClient();
  const bucket = bucketAssinatura();

  const { data: entradas, error } = await admin.storage
    .from(bucket)
    .list(processoId, { limit: 100, sortBy: { column: "name", order: "desc" } });

  if (error) {
    console.error("[arquivos] falha ao listar a pasta:", error.message);
    return NextResponse.json(
      { erro: "Não foi possível listar os arquivos." },
      { status: 500 }
    );
  }

  // Pasta vazia não é erro: é o estado normal antes do primeiro upload.
  const brutos = (entradas ?? []).filter((e) => Boolean(e.name));

  const pedido = (new URL(req.url).searchParams.get("arquivo") ?? "").trim();

  // ---- modo ABRIR ---------------------------------------------------------
  if (pedido) {
    // O nome tem de estar NA LISTA desta pasta. É esta comparação — e não uma
    // sanitização de string — que torna `../` inofensivo.
    const achado = brutos.find((e) => e.name === pedido);
    if (!achado) {
      return NextResponse.json({ erro: "Arquivo não encontrado." }, { status: 404 });
    }

    const { data: assinada, error: erroUrl } = await admin.storage
      .from(bucket)
      .createSignedUrl(`${processoId}/${achado.name}`, TTL_S);

    if (erroUrl || !assinada?.signedUrl) {
      console.error(
        "[arquivos] falha ao assinar a URL:",
        erroUrl?.message ?? "sem signedUrl"
      );
      return NextResponse.json({ erro: "Falha ao preparar o arquivo." }, { status: 502 });
    }

    // no-store: um redirecionamento cacheado seria reaproveitado pelo navegador
    // depois de a URL já ter vencido — e entregaria erro, não arquivo.
    const ida = NextResponse.redirect(assinada.signedUrl, 302);
    ida.headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");
    return ida;
  }

  // ---- modo LISTA ---------------------------------------------------------
  const arquivos: Arquivo[] = brutos.map((e) => {
    const meta = (e.metadata ?? {}) as { size?: number };
    return {
      nome: e.name,
      tamanho: typeof meta.size === "number" ? meta.size : null,
      atualizado_em: e.updated_at ?? e.created_at ?? null,
      assinado: e.name.includes("-assinado-"),
    };
  });

  const resposta = NextResponse.json({ ok: true, arquivos });
  // Sem cache: a pasta muda a cada webhook. Lista cacheada esconde o PDF
  // assinado que acabou de chegar.
  resposta.headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");
  return resposta;
}
