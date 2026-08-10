// /admin/conversas/whatsapp/[id] — thread de wa_mensagens + ações
// Assumir/Devolver + envio pelo painel (PAINEL-WA-01 item 3). Mesmo
// gate/dados do resto de /admin/conversas.
//
// A janela de 24h é calculada AQUI, no servidor, a partir da última mensagem
// DO CLIENTE — resposta nossa não reabre janela nenhuma. O componente recebe
// o resultado pronto: relógio de navegador não decide regra da Meta.
import { notFound } from "next/navigation";
import { exigirAdminConsolePagina } from "@/lib/admin-console";
import { createXtvClient } from "@/lib/supabase-xtv";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ConversaAcoes } from "../../ConversaAcoes";
import { ResponderWhatsApp } from "../../ResponderWhatsApp";
import { dataHoraAnoBR } from "@/lib/data-br";
import {
  temAnexo,
  textoVisivel,
  mimeDoAnexo,
  ehImagem,
  rotuloTipo,
  nomeExibicao,
  tamanhoLegivel,
  type AnexoBruto,
} from "@/lib/whatsapp/anexos";
import styles from "../../conversas.module.css";

export const dynamic = "force-dynamic";

// A `dataHora` local foi APAGADA — omitia `timeZone` e carimbava UTC na Vercel.
// Ver lib/data-br.ts. Nesta tela o defeito tinha consequência operacional: a
// frase "Janela de 24h aberta até HH:MM" é o que decide se dá pra responder
// livre ou se precisa de template. O CÁLCULO da janela sempre esteve certo (é
// aritmética de instantes, imune a fuso); era só a EXIBIÇÃO que adiantava três
// horas — o operador lia um prazo maior do que tinha.

// wa_papel: 'cliente' | 'prosperito' | 'humano' | 'sistema'. Visualmente
// tratamos 'prosperito' e 'humano' como bolha "agente" (lado direito).
function bolhaClasse(papel: string): string {
  if (papel === "cliente") return styles.cliente;
  if (papel === "sistema") return styles.sistema;
  return styles.agente;
}

export default async function AdminConversaWhatsApp({
  params,
}: {
  params: { id: string };
}) {
  const { nome } = await exigirAdminConsolePagina();
  const supabase = createXtvClient();

  const { data: conversa } = await supabase
    .from("wa_conversas")
    .select("id, telefone, nome, status, agente_ativo, opt_out")
    .eq("id", params.id)
    .maybeSingle();

  if (!conversa) notFound();

  const { data: mensagens } = await supabase
    .from("wa_mensagens")
    // PROSPERITO-ANEXO-01, Entrega 2 (item 2): as quatro últimas colunas nunca
    // foram pedidas aqui. O anexo não estava escondido por CSS nem por
    // permissão — o dado simplesmente não saía do banco. Desde 20/07 o arquivo
    // estava no bucket e a tela não tinha como saber que ele existia.
    .select(
      "id, papel, conteudo, agente, criado_em, status_envio, erro, storage_path, mime_type, nome_arquivo, tamanho_bytes"
    )
    .eq("conversa_id", conversa.id)
    .order("criado_em", { ascending: true });

  // Janela de 24h: medida da última mensagem DO CLIENTE. `mensagens` já está em
  // ordem crescente, então o último 'cliente' do array é o marco — evita uma
  // segunda ida ao banco pra buscar o que já está na memória.
  const JANELA_MS = 24 * 60 * 60 * 1000;
  const ultimaCliente = [...(mensagens ?? [])]
    .reverse()
    .find((m) => m.papel === "cliente");
  const marco = ultimaCliente?.criado_em
    ? new Date(ultimaCliente.criado_em as string).getTime()
    : null;
  const janelaAberta = marco !== null && Date.now() - marco < JANELA_MS;
  const janelaTexto =
    marco === null
      ? "Esta conversa não tem mensagem do cliente — a janela de 24h nunca abriu."
      : janelaAberta
        ? `Janela de 24h aberta até ${dataHoraAnoBR(new Date(marco + JANELA_MS).toISOString())}.`
        : `Janela de 24h fechada desde ${dataHoraAnoBR(new Date(marco + JANELA_MS).toISOString())}.`;

  return (
    <AppShell nome={nome} equipeAdminConsole>
      <PageHeader
        title={conversa.nome || conversa.telefone}
        subtitle="Canal WhatsApp — thread completa. Assuma a conversa para responder por aqui."
        backHref="/admin/conversas"
        backLabel="Conversas"
      />

      <Card>
        <div className={styles.header}>
          <div className={styles.info}>
            <span className={styles.nomeLead}>{conversa.telefone}</span>
            <span className={styles.meta}>
              Agente ativo: {conversa.agente_ativo ?? "—"}
              {conversa.opt_out ? " · lead optou por sair (opt-out)" : ""}
            </span>
          </div>
          <Badge tone={conversa.status === "humano" ? "amber" : "ok"}>
            {conversa.status === "humano" ? "Precisa de atenção" : conversa.status}
          </Badge>
        </div>
        {/* `nome`/`contato` alimentam a confirmação nominal de CONVERSAS-02.
            O contato vai CRU porque é cru que esta tela o mostra (linha acima):
            a confirmação tem de repetir o que está na tela, não uma segunda
            versão do mesmo dado. */}
        <ConversaAcoes
          canal="whatsapp"
          conversaId={conversa.id}
          status={conversa.status}
          telefone={conversa.telefone as string | null}
          nome={conversa.nome as string | null}
          contato={conversa.telefone as string | null}
        />
        <ResponderWhatsApp
          conversaId={conversa.id as string}
          assumida={conversa.status === "humano"}
          optOut={conversa.opt_out === true}
          janelaAberta={janelaAberta}
          janelaTexto={janelaTexto}
        />
      </Card>

      <ul className={styles.thread}>
        {(mensagens ?? []).map((m) => {
          const bruto: AnexoBruto = {
            storage_path: (m.storage_path as string | null) ?? null,
            mime_type: (m.mime_type as string | null) ?? null,
            nome_arquivo: (m.nome_arquivo as string | null) ?? null,
            conteudo: (m.conteudo as string | null) ?? null,
            tamanho_bytes: (m.tamanho_bytes as number | null) ?? null,
          };
          const comAnexo = temAnexo(bruto);
          const mime = mimeDoAnexo(bruto);
          const tamanho = tamanhoLegivel(bruto.tamanho_bytes);

          // NUNCA a URL assinada; sempre a nossa porta. É ela que confere a
          // sessão, grava quem abriu e só então cunha um link de 60s. Uma URL
          // assinada aqui no HTML seria copiável pra fora e abrível N vezes
          // sem passar por nós — o log registraria intenção, não leitura.
          const porta = `/api/admin/conversas/anexo?mensagem=${m.id}`;

          return (
            <li key={m.id} className={`${styles.bolha} ${bolhaClasse(m.papel as string)}`}>
              {/* `textoVisivel` e não `m.conteudo`: em mensagem com anexo esse
                  campo guarda filename OU legenda OU um marcador interno do
                  webhook. Ver lib/whatsapp/anexos.ts. */}
              {textoVisivel(bruto)}

              {comAnexo ? (
                <a className={styles.anexo} href={porta} target="_blank" rel="noopener noreferrer">
                  {ehImagem(mime) ? (
                    // `loading="lazy"` de propósito: sem ele, abrir uma thread
                    // com seis fotos dispararia seis buscas de uma vez. Com ele,
                    // a miniatura (e a linha 'miniatura' no log) só acontece
                    // quando a bolha entra na tela.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className={styles.anexoMiniatura}
                      src={`${porta}&motivo=miniatura`}
                      alt={nomeExibicao(bruto)}
                      loading="lazy"
                    />
                  ) : (
                    <span className={styles.anexoIcone} aria-hidden="true">
                      📄
                    </span>
                  )}
                  <span className={styles.anexoTexto}>
                    <span className={styles.anexoNome}>{nomeExibicao(bruto)}</span>
                    <span className={styles.anexoMeta}>
                      {rotuloTipo(mime)}
                      {tamanho ? ` · ${tamanho}` : ""} · abrir
                    </span>
                  </span>
                </a>
              ) : null}

              <span className={styles.bolhaMeta}>
                {m.papel}
                {m.agente ? ` · ${m.agente}` : ""} · {dataHoraAnoBR(m.criado_em as string)}
                {m.status_envio === "falha" ? (
                  <span className={styles.falha}>
                    {" "}
                    · não entregue{m.erro ? `: ${String(m.erro)}` : ""}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </AppShell>
  );
}
