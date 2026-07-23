// ============================================================================
// Bidcon — Simulador Conta Notarial para Parceiros (fatia SIM-PARCEIRO-01).
// ----------------------------------------------------------------------------
// Camada de acesso a dados — 100% leitura, ZERO escrita, ZERO migration nova
// nesta fatia (só a fatia gated SIM-PARCEIRO-02 mexe em schema, e mesmo assim
// só como arquivo de migration não aplicado sem AUTORIZO).
//
// Fonte: projeto xtv (xtvjpnyadcdeadhmzyff) — catálogo REAL de estoque
// (`cartas`/`administradoras`), o mesmo lido por /api/vitrine. Usa
// `createXtvClient()` (service_role), pois a policy de select da vitrine só
// libera `authenticated` do lado do Postgres — igual ao padrão já usado em
// app/api/vitrine/route.ts e app/api/atende/route.ts.
//
// DECISÃO — por que ler `cartas`/`administradoras` DIRETO em vez da VIEW
// `vw_vitrine_viva` (ao contrário de /api/vitrine):
//   1) A view só expõe o NOME da administradora (texto resolvido via
//      COALESCE), não o `administradora_id`. A regra de negócio da junção
//      ("só dentro da MESMA administradora") precisa do FK real — nome-texto
//      é frágil (aliases, variação de grafia).
//   2) A view não expõe as flags de elegibilidade da administradora
//      (`ativo`, `aceita_assuncao`) — o seletor do simulador precisa delas.
//   3) A view filtra implicitamente `categoria = 'contemplada'`, excluindo
//      cotas de repasse do estoque. Essa restrição foi pensada pra vitrine
//      pública (VITRINE-FENOMENO-01) e não é uma regra do simulador de
//      parceiro — não replicamos essa exclusão aqui sem confirmação
//      explícita de negócio (assumimos as duas categorias como candidatas;
//      ponto para revisão do Emerson antes do merge).
//   4) `parcela`/`parcelas` a view TEM (checado via information_schema —
//      claim anterior de que faltavam estava incorreta e foi corrigida).
//      Isso não muda os pontos 1–3 acima, que são os motivos reais da
//      escolha por baixo da view.
//
// Exclusão de reserva ativa: a view usa fingerprint (carta_fingerprint(...))
// porque uma reserva pode ter sido criada por um fluxo (chat/atende) que só
// tem o fingerprint estável, sem o `id` sincronizado mais recente. Aqui
// usamos o `reservas.carta_id` direto (também existe na tabela) — mais
// simples e suficiente pra este caso de uso (parceiro olhando estoque
// ao vivo); se a paridade exata com a view importar no futuro, migrar pra
// fingerprint via RPC dedicado (mudança de schema, fora do escopo read-only
// desta fatia).
// ============================================================================

import { createXtvClient } from "@/lib/supabase-xtv";
import type { CotaSim } from "./engine";

export interface AdministradoraElegivel {
  id: string;
  nome: string;
  marcaLogo: string | null;
  segmentos: string[] | null;
  exigenciaGarantiaPct: number | null;
}

type LinhaAdministradora = {
  id: string;
  nome: string;
  marca_logo: string | null;
  segmentos: string[] | null;
  exigencia_garantia_pct: number | null;
  ativo: boolean;
  aceita_assuncao: boolean;
};

type LinhaCarta = {
  id: string;
  numero_externo: number | null;
  administradora_id: string | null;
  valor_credito: number;
  valor_entrada: number | null;
  qtd_parcelas: number | null;
  valor_parcela: number | null;
  bidcon_custo_am: number | null;
  fonte: string | null;
};

type LinhaReserva = { carta_id: string | null };

/** Administradoras elegíveis pro seletor: ativas e que aceitam assunção
 * (pré-requisito de negócio pra junção via Conta Notarial). */
export async function listarAdministradorasElegiveis(): Promise<AdministradoraElegivel[]> {
  const supabase = createXtvClient();
  const { data, error } = await supabase
    .from("administradoras")
    .select("id, nome, marca_logo, segmentos, exigencia_garantia_pct, ativo, aceita_assuncao")
    .eq("ativo", true)
    .eq("aceita_assuncao", true)
    .order("nome", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as LinhaAdministradora[]).map((a) => ({
    id: a.id,
    nome: a.nome,
    marcaLogo: a.marca_logo,
    segmentos: a.segmentos,
    exigenciaGarantiaPct: a.exigencia_garantia_pct,
  }));
}

/** Cotas em estoque (status='disponivel', crédito>0) de uma administradora,
 * excluindo cotas com reserva ativa não-expirada — mapeadas pro shape do
 * engine (`CotaSim`). `entrada`/`parcela`/`custoAmEstoque` são FINAIS, vindos
 * do banco — nunca recalculados aqui. */
export async function listarCotasDisponiveis(
  administradoraId: string,
  administradoraNome: string,
): Promise<CotaSim[]> {
  const supabase = createXtvClient();

  const { data: cartasData, error: erroCartas } = await supabase
    .from("cartas")
    .select(
      "id, numero_externo, administradora_id, valor_credito, valor_entrada, qtd_parcelas, valor_parcela, bidcon_custo_am, fonte",
    )
    .eq("administradora_id", administradoraId)
    .eq("status", "disponivel")
    .gt("valor_credito", 0);
  if (erroCartas) throw erroCartas;

  const cartas = (cartasData ?? []) as LinhaCarta[];
  if (cartas.length === 0) return [];

  const ids = cartas.map((c) => c.id);
  const { data: reservasData, error: erroReservas } = await supabase
    .from("reservas")
    .select("carta_id")
    .eq("status", "ativa")
    .gt("expira_em", new Date().toISOString())
    .in("carta_id", ids);
  if (erroReservas) throw erroReservas;

  const reservadas = new Set(
    ((reservasData ?? []) as LinhaReserva[]).map((r) => r.carta_id).filter((v): v is string => !!v),
  );

  return cartas
    .filter((c) => !reservadas.has(c.id))
    .map((c) => ({
      id: c.id,
      ref: c.numero_externo != null ? `#${c.numero_externo}` : c.id.slice(0, 6),
      administradoraId,
      administradoraNome,
      credito: c.valor_credito,
      entrada: c.valor_entrada ?? 0,
      prazo: c.qtd_parcelas ?? 0,
      parcela: c.valor_parcela ?? 0,
      custoAmEstoque: c.bidcon_custo_am,
      exclusiva: c.fonte === "cliente_direto",
    }));
}
