// POST /api/kyc/face — camada PLUGÁVEL de face-match por IA (env-gated).
// Compara a selfie com o rosto do documento e devolve um score/confiança (0..1).
// Sem KYC_FACE_PROVIDER configurado, o endpoint NÃO chama serviço externo e
// responde { ok:true, modo:'nao_configurado' }, deixando face_score/face_confianca
// nulos para o admin decidir manualmente. Liga sozinho quando a env for setada.
//
// LGPD: enviar selfie/documento a um provedor de IA é tratamento de dado
// sensível — por isso a integração fica fora desta entrega até decisão + chaves
// do Emerson. O acesso ao arquivo será sempre por signed URL server-side.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const provider = process.env.KYC_FACE_PROVIDER?.trim();
  if (!provider) {
    // Provedor não configurado: verificação manual pelo admin.
    return NextResponse.json({ ok: true, modo: "nao_configurado" });
  }

  // ----- ponto de extensão -----
  // Aqui entraria a chamada ao provedor (AWS Rekognition / Azure Face / ...),
  // lendo doc e selfie via signed URL server-side, calculando similaridade, e
  // gravando face_score/face_confianca via createAdminClient(). Mantido fora
  // desta entrega até a escolha do provedor.
  return NextResponse.json({ ok: true, modo: "pendente_integracao", provider });
}
