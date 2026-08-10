// ============================================================================
// GET /api/admin/conversas/anexo — porta única dos extratos recebidos.
// PROSPERITO-ANEXO-01, Entrega 2 (item 4).
// ----------------------------------------------------------------------------
// O QUE ESTA ROTA É. A tela NUNCA recebe uma URL assinada. Ela aponta para
// aqui; aqui a sessão é conferida, o acesso é gravado, uma URL de vida curta é
// cunhada e o navegador é redirecionado. Extrato de cota é documento financeiro
// DE TERCEIRO: o link não pode existir solto no HTML, e o acesso não pode
// acontecer sem registro.
//
// POR QUE ASSIM E NÃO ASSINANDO NA PÁGINA. Uma URL assinada, depois de cunhada,
// é abrível N vezes sem passar por nós — quem assina na página registra
// INTENÇÃO, não leitura, e ainda deixa um link válido no fonte da tela, pronto
// pra ser copiado pra fora. Com o redirecionamento, todo acesso atravessa o
// servidor e o log responde à pergunta que a ordem fez: quem abriu e quando.
//
// A ROTA NÃO ACEITA CAMINHO — ACEITA ID DE MENSAGEM. Se o `storage_path` viesse
// da query, qualquer admin (ou qualquer bug de front) poderia pedir um caminho
// arbitrário dentro do bucket. Recebendo o id, o caminho sai do banco: o
// cliente escolhe QUAL MENSAGEM ver, nunca QUAL ARQUIVO ler.
//
// SÓ LÊ. Nada aqui muda o estado do anexo; a única escrita é a linha de
// auditoria, que é o produto desta rota.
// ============================================================================
import { NextResponse } from "next/server";
import { checarAdminConsoleApi } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "wa-extratos";

// 60s, o mesmo padrão de lib/kyc.ts. O navegador segue o redirecionamento na
// hora; a validade curta existe para que a URL que passar num log de proxy ou
// num histórico esteja morta quando alguém a encontrar.
const TTL_S = 60;

// `miniatura` = a thread carregou a prévia sozinha. `abertura` = alguém clicou.
// Separados para que a auditoria de quem LEU um documento não seja afogada
// pelo render de uma tela com seis fotos.
const MOTIVOS = new Set(["abertura", "miniatura"]);

export async function GET(req: Request) {
  const sessao = await checarAdminConsoleApi();
  if (!sessao.ok) {
    return NextResponse.json({ erro: sessao.motivo }, { status: sessao.status });
  }

  const url = new URL(req.url);
  const cru = url.searchParams.get("mensagem") ?? "";
  const mensagemId = Number(cru);
  if (!cru || !Number.isSafeInteger(mensagemId) || mensagemId <= 0) {
    return NextResponse.json({ erro: "parâmetro `mensagem` inválido" }, { status: 400 });
  }

  const motivoCru = url.searchParams.get("motivo") ?? "abertura";
  const motivo = MOTIVOS.has(motivoCru) ? motivoCru : "abertura";

  const db = createXtvClient();

  const { data: msg, error: erroBusca } = await db
    .from("wa_mensagens")
    .select("id, storage_path")
    .eq("id", mensagemId)
    .maybeSingle();

  if (erroBusca) {
    console.error("[anexo] falha ao buscar a mensagem:", erroBusca.message);
    return NextResponse.json({ erro: "falha ao consultar a mensagem" }, { status: 500 });
  }

  const caminho = (msg?.storage_path ?? "").trim();
  if (!caminho) {
    // Mensagem inexistente e mensagem sem anexo dão a MESMA resposta de
    // propósito: distinguir as duas contaria, a quem estiver sondando, quais
    // ids existem.
    return NextResponse.json({ erro: "anexo não encontrado" }, { status: 404 });
  }

  // ------------------------------------------------------------------------
  // A auditoria vem ANTES do arquivo, e falha nela NEGA o acesso.
  //
  // Decisão declarada: se o registro não puder ser gravado, a rota recusa em
  // vez de servir. Servir sem registrar seria exatamente o buraco que o item 4
  // existe para fechar — e seria um buraco invisível, porque a tela mostraria
  // o documento normalmente. Entre o operador esperar e a casa perder a prova
  // de quem abriu um documento de terceiro, a casa espera.
  // ------------------------------------------------------------------------
  const { error: erroLog } = await db.from("wa_anexo_acessos").insert({
    mensagem_id: mensagemId,
    storage_path: caminho,
    admin_email: sessao.email,
    motivo,
  });

  if (erroLog) {
    console.error("[anexo] falha ao registrar o acesso:", erroLog.message);
    return NextResponse.json(
      { erro: "não foi possível registrar o acesso; por segurança, o arquivo não foi aberto" },
      { status: 500 }
    );
  }

  const { data: assinada, error: erroUrl } = await db.storage
    .from(BUCKET)
    .createSignedUrl(caminho, TTL_S);

  if (erroUrl || !assinada?.signedUrl) {
    console.error("[anexo] falha ao assinar a URL:", erroUrl?.message ?? "sem signedUrl");
    return NextResponse.json({ erro: "falha ao preparar o arquivo" }, { status: 502 });
  }

  // 302 + no-store. O `no-store` não é enfeite: um redirecionamento cacheado
  // seria reaproveitado pelo navegador SEM passar por aqui de novo — e o
  // acesso seguinte não entraria no log. Cache aqui apaga auditoria.
  const resposta = NextResponse.redirect(assinada.signedUrl, 302);
  resposta.headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");
  return resposta;
}
