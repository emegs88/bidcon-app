// /admin/perfis/[id] — detalhe do KYC de um cliente (Server Component, admin).
// Mostra dados pessoais (CPF mascarado), endereço, e links para documento/selfie/
// renda via SIGNED URL de curta duração gerada server-side (lib/kyc.signedUrl) —
// nunca há URL pública. Os botões Verificar/Rejeitar/Bloquear ficam no client
// (KycAcoes), que chama a RPC kyc_decidir através de /api/admin/kyc/[id]/decidir.
import { createClient } from "@/lib/supabase-server";
import { exigirPapel } from "@/lib/auth";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  LABEL_STATUS_KYC,
  TONE_STATUS_KYC,
  type StatusKYC,
} from "@/lib/status";
import { mascararCpf, dataBR } from "@/lib/format";
import {
  signedUrl,
  BUCKET_DOC,
  BUCKET_SELFIE,
  BUCKET_RENDA,
} from "@/lib/kyc";
import { KycAcoes } from "./KycAcoes";
import styles from "./detalhe.module.css";

export const dynamic = "force-dynamic";

type Endereco = {
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
};

// Botão de arquivo: link (nova aba) quando há signed URL; senão botão desabilitado.
// O Button só aceita `disabled` como <button> (sem href) — daí o ramo condicional.
function ArquivoLink({ url, rotulo }: { url: string | null; rotulo: string }) {
  if (url) {
    return (
      <Button href={url} variant="ghost" size="sm" target="_blank" rel="noopener noreferrer">
        Ver {rotulo}
      </Button>
    );
  }
  return (
    <Button variant="ghost" size="sm" disabled>
      Sem {rotulo}
    </Button>
  );
}

export default async function AdminPerfilDetalhe({
  params,
}: {
  params: { id: string };
}) {
  const sessao = await exigirPapel("admin");
  const supabase = createClient();

  const { data: perfil } = await supabase
    .from("profiles")
    .select("id, nome, email, tipo, criado_em")
    .eq("id", params.id)
    .maybeSingle();
  if (!perfil) notFound();

  const { data: kyc } = await supabase
    .from("kyc_perfis")
    .select(
      "cpf, nascimento, endereco, doc_tipo, doc_path, selfie_path, renda_path, status_kyc, face_score, face_confianca, motivo_rejeicao, criado_em, verificado_em"
    )
    .eq("user_id", params.id)
    .maybeSingle();

  const status = (kyc?.status_kyc as StatusKYC | undefined) ?? "pendente";
  const end = (kyc?.endereco as Endereco | null) ?? null;

  // Signed URLs (TTL curto) — só geradas porque já confirmamos papel admin.
  const [docUrl, selfieUrl, rendaUrl] = await Promise.all([
    signedUrl(BUCKET_DOC, kyc?.doc_path, 120),
    signedUrl(BUCKET_SELFIE, kyc?.selfie_path, 120),
    signedUrl(BUCKET_RENDA, kyc?.renda_path, 120),
  ]);

  return (
    <AppShell nome={sessao.nome} tipo={sessao.perfil?.tipo}>
      <PageHeader
        title={perfil.nome ?? perfil.email ?? "Cliente"}
        backHref="/admin/perfis"
        backLabel="Perfis"
        subtitle="Verificação de identidade. CPF mascarado; arquivos via link temporário."
      />

      <div className={styles.stack}>
        <Card>
          <div className={styles.statusRow}>
            <span className={styles.statusLabel}>Status do KYC</span>
            <Badge tone={TONE_STATUS_KYC[status]}>{LABEL_STATUS_KYC[status]}</Badge>
          </div>
          {kyc?.motivo_rejeicao && (
            <p className={styles.motivo}>Motivo registrado: {kyc.motivo_rejeicao}</p>
          )}
        </Card>

        <Card>
          <h2 className={styles.h2}>Dados pessoais</h2>
          <dl className={styles.dl}>
            <div className={styles.r}>
              <dt>E-mail</dt>
              <dd>{perfil.email ?? "—"}</dd>
            </div>
            <div className={styles.r}>
              <dt>CPF</dt>
              <dd>{mascararCpf(kyc?.cpf as string | undefined)}</dd>
            </div>
            <div className={styles.r}>
              <dt>Nascimento</dt>
              <dd>{kyc?.nascimento ? dataBR(kyc.nascimento as string) : "—"}</dd>
            </div>
            <div className={styles.r}>
              <dt>Documento</dt>
              <dd>{(kyc?.doc_tipo as string | undefined)?.toUpperCase() ?? "—"}</dd>
            </div>
            <div className={styles.r}>
              <dt>Cadastro</dt>
              <dd>{dataBR(perfil.criado_em)}</dd>
            </div>
          </dl>
        </Card>

        {end && (
          <Card>
            <h2 className={styles.h2}>Endereço</h2>
            <dl className={styles.dl}>
              <div className={styles.r}>
                <dt>Logradouro</dt>
                <dd>
                  {end.logradouro ?? "—"}
                  {end.numero ? `, ${end.numero}` : ""}
                  {end.complemento ? ` — ${end.complemento}` : ""}
                </dd>
              </div>
              <div className={styles.r}>
                <dt>Bairro</dt>
                <dd>{end.bairro ?? "—"}</dd>
              </div>
              <div className={styles.r}>
                <dt>Cidade/UF</dt>
                <dd>
                  {end.cidade ?? "—"}
                  {end.uf ? `/${end.uf}` : ""}
                </dd>
              </div>
              <div className={styles.r}>
                <dt>CEP</dt>
                <dd>{end.cep ?? "—"}</dd>
              </div>
            </dl>
          </Card>
        )}

        <Card>
          <h2 className={styles.h2}>Arquivos</h2>
          <p className={styles.aviso}>
            Links temporários (expiram em ~2 min). Abra em nova aba para conferir.
          </p>
          <div className={styles.arquivos}>
            <ArquivoLink url={docUrl} rotulo="documento" />
            <ArquivoLink url={selfieUrl} rotulo="selfie" />
            <ArquivoLink url={rendaUrl} rotulo="comprovante de renda" />
          </div>
        </Card>

        {(kyc?.face_score != null || kyc?.face_confianca != null) && (
          <Card>
            <h2 className={styles.h2}>Análise por IA</h2>
            <dl className={styles.dl}>
              <div className={styles.r}>
                <dt>Similaridade (face)</dt>
                <dd>{kyc?.face_score != null ? `${(Number(kyc.face_score) * 100).toFixed(1)}%` : "—"}</dd>
              </div>
              <div className={styles.r}>
                <dt>Confiança</dt>
                <dd>{kyc?.face_confianca != null ? `${(Number(kyc.face_confianca) * 100).toFixed(1)}%` : "—"}</dd>
              </div>
            </dl>
          </Card>
        )}

        <Card>
          <h2 className={styles.h2}>Decisão</h2>
          <KycAcoes userId={params.id} status={status} />
        </Card>
      </div>
    </AppShell>
  );
}
