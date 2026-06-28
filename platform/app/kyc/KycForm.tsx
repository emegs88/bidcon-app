"use client";
// Formulário de KYC do cliente (client component).
// Fluxo:
//   1) valida dados + arquivos no client (tamanho/MIME) — feedback imediato.
//   2) faz upload DIRETO ao Storage privado via supabase-browser, no prefixo
//      '{uid}/...' (a policy kyc_storage_owner_insert exige isso).
//   3) POST /api/kyc/enviar com os metadados (cpf, nascimento, endereço, paths,
//      doc_tipo). O servidor revalida tudo, grava kyc_perfis (status em_analise)
//      e registra o evento. Sem dado bancário; nada promete crédito.
// Os limites/MIME são duplicados aqui (client) e revalidados no servidor.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { Field, SelectField } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import styles from "./kyc.module.css";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const MIME_IMAGEM = ["image/jpeg", "image/png", "image/webp"];
const MIME_DOC = [...MIME_IMAGEM, "application/pdf"];

// Buckets privados (iguais aos de lib/kyc.ts; aqui só nomes, sem service_role).
const BUCKET_DOC = "kyc-doc";
const BUCKET_SELFIE = "kyc-selfie";
const BUCKET_RENDA = "kyc-renda";

function validar(arquivo: File | null, permitirPdf: boolean): string | null {
  if (!arquivo) return "Selecione o arquivo.";
  if (arquivo.size <= 0) return "Arquivo vazio.";
  if (arquivo.size > MAX_BYTES) return "Arquivo acima de 8 MB.";
  const permitidos = permitirPdf ? MIME_DOC : MIME_IMAGEM;
  if (!permitidos.includes(arquivo.type)) {
    return permitirPdf ? "Use JPG, PNG, WebP ou PDF." : "Use JPG, PNG ou WebP.";
  }
  return null;
}

// Extensão a partir do MIME (para nomear o arquivo no bucket).
function extDe(tipo: string): string {
  if (tipo === "application/pdf") return "pdf";
  if (tipo === "image/png") return "png";
  if (tipo === "image/webp") return "webp";
  return "jpg";
}

export function KycForm({
  docTipoInicial,
}: {
  docTipoInicial: "cnh" | "rg" | null;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [doc, setDoc] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [renda, setRenda] = useState<File | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);

    const form = e.currentTarget;
    const fd = new FormData(form);

    // ----- valida arquivos (doc e selfie obrigatórios; renda obrigatório) -----
    const eDoc = validar(doc, true);
    if (eDoc) return setErro(`Documento: ${eDoc}`);
    const eSelfie = validar(selfie, false); // selfie é sempre imagem
    if (eSelfie) return setErro(`Selfie: ${eSelfie}`);
    const eRenda = validar(renda, true);
    if (eRenda) return setErro(`Comprovante de renda: ${eRenda}`);

    setEnviando(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sessão expirada. Entre novamente.");
      const uid = user.id;

      // ----- uploads diretos ao Storage privado (upsert: permite reenvio) -----
      const docPath = `${uid}/doc.${extDe(doc!.type)}`;
      const selfiePath = `${uid}/selfie.${extDe(selfie!.type)}`;
      const rendaPath = `${uid}/renda.${extDe(renda!.type)}`;

      const ups = await Promise.all([
        supabase.storage.from(BUCKET_DOC).upload(docPath, doc!, {
          upsert: true,
          contentType: doc!.type,
        }),
        supabase.storage.from(BUCKET_SELFIE).upload(selfiePath, selfie!, {
          upsert: true,
          contentType: selfie!.type,
        }),
        supabase.storage.from(BUCKET_RENDA).upload(rendaPath, renda!, {
          upsert: true,
          contentType: renda!.type,
        }),
      ]);
      const falha = ups.find((u) => u.error);
      if (falha?.error) {
        throw new Error("Falha ao enviar os arquivos. Tente novamente.");
      }

      // ----- metadados para o servidor revalidar e gravar -----
      const payload = {
        cpf: String(fd.get("cpf") ?? ""),
        nascimento: String(fd.get("nascimento") ?? ""),
        doc_tipo: String(fd.get("doc_tipo") ?? ""),
        endereco: {
          cep: String(fd.get("cep") ?? ""),
          logradouro: String(fd.get("logradouro") ?? ""),
          numero: String(fd.get("numero") ?? ""),
          complemento: String(fd.get("complemento") ?? ""),
          bairro: String(fd.get("bairro") ?? ""),
          cidade: String(fd.get("cidade") ?? ""),
          uf: String(fd.get("uf") ?? ""),
        },
        doc_path: docPath,
        selfie_path: selfiePath,
        renda_path: rendaPath,
      };

      const res = await fetch("/api/kyc/enviar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { erro?: string };
        throw new Error(j.erro ?? "Não foi possível enviar a verificação.");
      }

      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro inesperado.");
      setEnviando(false);
    }
  }

  return (
    <Card>
      <h2 className={styles.h2}>Seus dados</h2>
      <form className={styles.form} onSubmit={onSubmit}>
        <Field
          label="CPF"
          id="cpf"
          name="cpf"
          inputMode="numeric"
          placeholder="000.000.000-00"
          autoComplete="off"
          required
        />
        <Field
          label="Data de nascimento"
          id="nascimento"
          name="nascimento"
          type="date"
          required
        />

        <SelectField
          label="Tipo de documento"
          id="doc_tipo"
          name="doc_tipo"
          defaultValue={docTipoInicial ?? "cnh"}
          required
        >
          <option value="cnh">CNH</option>
          <option value="rg">RG</option>
        </SelectField>

        <h3 className={styles.h3}>Endereço</h3>
        <Field label="CEP" id="cep" name="cep" inputMode="numeric" required />
        <Field label="Logradouro" id="logradouro" name="logradouro" required />
        <div className={styles.grid2}>
          <Field label="Número" id="numero" name="numero" required />
          <Field label="Complemento" id="complemento" name="complemento" hint="Opcional." />
        </div>
        <Field label="Bairro" id="bairro" name="bairro" required />
        <div className={styles.grid2}>
          <Field label="Cidade" id="cidade" name="cidade" required />
          <Field label="UF" id="uf" name="uf" maxLength={2} required />
        </div>

        <h3 className={styles.h3}>Arquivos</h3>
        <label className={styles.upload}>
          <span className={styles.uploadLabel}>Documento (CNH/RG) — JPG, PNG, WebP ou PDF</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(ev) => setDoc(ev.target.files?.[0] ?? null)}
            required
          />
        </label>
        <label className={styles.upload}>
          <span className={styles.uploadLabel}>Selfie — JPG, PNG ou WebP</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(ev) => setSelfie(ev.target.files?.[0] ?? null)}
            required
          />
        </label>
        <label className={styles.upload}>
          <span className={styles.uploadLabel}>Comprovante de renda — JPG, PNG, WebP ou PDF</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(ev) => setRenda(ev.target.files?.[0] ?? null)}
            required
          />
        </label>

        <p className={styles.privacidade}>
          Seus documentos ficam em armazenamento privado e só são acessados pela
          equipe de verificação. Não compartilhamos com terceiros sem necessidade
          legal.
        </p>

        {erro && <p className={styles.erro}>{erro}</p>}

        <div className={styles.acoes}>
          <Button type="submit" disabled={enviando}>
            {enviando ? "Enviando…" : "Enviar para verificação"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
