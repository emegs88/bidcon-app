// ============================================================================
// /admin/conversas/extratos — "Extratos recebidos".
// PROSPERITO-ANEXO-01, Entrega 2 (item 3).
// ----------------------------------------------------------------------------
// POR QUE ESTA TELA EXISTE. O anexo na bolha (item 2) só serve a quem já sabe
// QUAL conversa abrir. Esta aqui responde a outra pergunta — "chegou documento
// novo?" — sem exigir que alguém varra seis threads. Medido em 10/08/2026: 15
// anexos, em 6 conversas, desde 20/07, nenhum jamais visto.
//
// SÓ LEITURA. Nada aqui grava; a única escrita do fluxo é a linha de auditoria,
// e ela mora na rota /api/admin/conversas/anexo, quando alguém clica.
//
// A LEITURA POR IA NÃO APARECE AQUI — decisão do Emerson em 10/08/2026,
// bifurcação "Leitura IA": "Não mostrar nesta fatia". A tabela `extratos_cotas`
// já existe e já roda, mas nada dela é lido nesta página. Consequência que eu
// declaro em vez de suavizar: os 3 anexos SEM leitura nenhuma (mensagens 20, 25
// e 82) aparecem aqui idênticos aos outros 12. Marcá-los exigiria justamente o
// join que esta fatia não faz.
//
// DUAS CONSULTAS, NÃO UM JOIN EMBUTIDO. `wa_conversas` é buscada à parte, por
// lista de ids, em vez de embutida no select. Um embed depende do PostgREST
// enxergar a chave estrangeira; se ele não enxergar, o campo volta null e a
// tela escreve "—" no lugar do telefone — erro silencioso. Duas consultas
// falham em voz alta.
// ============================================================================
import { exigirAdminConsolePagina } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConversasSubNav } from "../ConversasSubNav";
import { dataHoraAnoBR } from "@/lib/data-br";
import {
  mimeDoAnexo,
  ehImagem,
  rotuloTipo,
  nomeExibicao,
  tamanhoLegivel,
  type AnexoBruto,
} from "@/lib/whatsapp/anexos";
import areaStyles from "@/components/area.module.css";
import styles from "../conversas.module.css";

export const dynamic = "force-dynamic";

// Teto declarado. Com 15 linhas hoje ele não corta nada; existe para que o dia
// em que cortar seja um dia em que a tela AVISA (ver o aviso de `noTeto` lá
// embaixo) — lista truncada em silêncio é a doutrina que a casa já pagou caro.
const TETO = 200;

export default async function AdminExtratosRecebidos() {
  const { nome } = await exigirAdminConsolePagina();
  const supabase = createXtvClient();

  const { data: linhas, error } = await supabase
    .from("wa_mensagens")
    .select(
      "id, conversa_id, conteudo, criado_em, storage_path, mime_type, nome_arquivo, tamanho_bytes"
    )
    .not("storage_path", "is", null)
    .order("criado_em", { ascending: false })
    .limit(TETO);

  if (error) {
    // Erro de consulta NÃO pode virar lista vazia: "nenhum extrato recebido" e
    // "não consegui perguntar" são fatos opostos com a mesma aparência.
    console.error("[extratos] falha ao listar anexos:", error.message);
  }

  const anexos = linhas ?? [];
  const noTeto = anexos.length === TETO;

  const conversaIds = Array.from(new Set(anexos.map((a) => a.conversa_id as string)));
  const { data: conversas } = conversaIds.length
    ? await supabase
        .from("wa_conversas")
        .select("id, telefone, nome")
        .in("id", conversaIds)
    : { data: [] as { id: string; telefone: string | null; nome: string | null }[] };

  const porId = new Map(
    (conversas ?? []).map((c) => [c.id as string, c as { telefone: string | null; nome: string | null }])
  );

  return (
    <AppShell nome={nome} equipeAdminConsole>
      <PageHeader
        title="Extratos recebidos"
        subtitle="Todos os anexos que chegaram pelo WhatsApp, do mais recente para o mais antigo."
        backHref="/admin/conversas"
        backLabel="Conversas"
      />

      <div className={areaStyles.section}>
        <ConversasSubNav />
      </div>

      <Card>
        <p className={styles.nota}>
          Estes arquivos são documentos financeiros de terceiros. O link abaixo não
          é público: ele passa pelo servidor, registra quem abriu e vale 60 segundos.
        </p>

        {error ? (
          <p className={styles.erro} role="alert">
            Não foi possível consultar os anexos agora. Isto NÃO significa que não
            há extratos — significa que a pergunta falhou. Recarregue a página.
          </p>
        ) : null}

        {noTeto ? (
          <p className={styles.nota}>
            Mostrando os {TETO} mais recentes — há mais anexos além deste ponto.
          </p>
        ) : null}
      </Card>

      {!error && anexos.length === 0 ? (
        <EmptyState
          icon="📎"
          title="Nenhum anexo recebido"
          description="Quando um cliente enviar um extrato pelo WhatsApp, ele aparece aqui."
        />
      ) : (
        <ul className={styles.extratos}>
          {anexos.map((a) => {
            const bruto: AnexoBruto = {
              storage_path: (a.storage_path as string | null) ?? null,
              mime_type: (a.mime_type as string | null) ?? null,
              nome_arquivo: (a.nome_arquivo as string | null) ?? null,
              conteudo: (a.conteudo as string | null) ?? null,
              tamanho_bytes: (a.tamanho_bytes as number | null) ?? null,
            };
            const mime = mimeDoAnexo(bruto);
            const tamanho = tamanhoLegivel(bruto.tamanho_bytes);
            const conversa = porId.get(a.conversa_id as string);
            const quem = conversa?.nome || conversa?.telefone || "conversa desconhecida";

            return (
              <li key={a.id as number} className={styles.extratoLinha}>
                <span className={styles.extratoIcone} aria-hidden="true">
                  {ehImagem(mime) ? "🖼️" : "📄"}
                </span>

                <span className={styles.extratoCorpo}>
                  <span className={styles.extratoNome}>{nomeExibicao(bruto)}</span>
                  <span className={styles.extratoMeta}>
                    {rotuloTipo(mime)}
                    {tamanho ? ` · ${tamanho}` : ""} ·{" "}
                    {dataHoraAnoBR(a.criado_em as string)}
                  </span>
                  <span className={styles.extratoMeta}>
                    {/* O telefone vai cru, como no resto de /admin/conversas. */}
                    {quem}
                  </span>
                </span>

                <span className={styles.extratoAcoes}>
                  <a
                    className={styles.linkExterno}
                    href={`/api/admin/conversas/anexo?mensagem=${a.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Abrir
                  </a>
                  <a
                    className={styles.linkExterno}
                    href={`/admin/conversas/whatsapp/${a.conversa_id}`}
                  >
                    Ver conversa
                  </a>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
