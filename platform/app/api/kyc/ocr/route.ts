// POST /api/kyc/ocr — camada PLUGÁVEL de OCR do documento (env-gated).
// Sem KYC_OCR_PROVIDER configurado, o endpoint não chama nenhum serviço externo
// e responde { ok:true, modo:'nao_configurado' }, deixando ocr_status='pendente'
// para o admin verificar manualmente. Quando o provedor for escolhido (decisão
// + chaves do Emerson), a integração liga aqui sem mudar o resto do fluxo.
//
// IMPORTANTE (LGPD/compliance): o texto bruto de OCR NUNCA é exibido cru ao
// cliente nem vetorizado para busca. Quando guardado, passa por sanitizarOcr()
// (lib/kyc.ts), que zera o texto se contiver termo proibido de compliance.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Só processa para usuário autenticado (o disparo vem do /enviar logado).
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const provider = process.env.KYC_OCR_PROVIDER?.trim();
  if (!provider) {
    // Provedor não configurado: verificação manual pelo admin.
    return NextResponse.json({ ok: true, modo: "nao_configurado" });
  }

  // ----- ponto de extensão -----
  // Aqui entraria a chamada ao provedor (Google Vision / AWS Textract / ...),
  // a leitura do arquivo via signed URL server-side, a extração do texto, a
  // sanitização com sanitizarOcr() e o UPDATE de ocr_status/ocr_texto via
  // createAdminClient(). Mantido fora desta entrega até a escolha do provedor.
  return NextResponse.json({ ok: true, modo: "pendente_integracao", provider });
}
