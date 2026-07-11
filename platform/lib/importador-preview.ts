// ============================================================================
// Núcleo de análise do lote de importação (FATIA F1) — compartilhado entre
// /api/admin/importar/preview (só analisa, não grava) e
// /api/admin/importar/publicar (revalida os MESMOS passos antes de gravar —
// nunca confia na categoria que vier do client). Sempre no xtv: fingerprint/
// TIR/resolver_administradora são RPCs do xtv; dedup lê `cartas`/
// `administradoras` do xtv — NUNCA o nnv (que tem tabelas homônimas
// desconectadas, ver CLAUDE.md).
//
// Dedup (decidido com o usuário):
//   - "já existe": por fingerprint, GLOBAL (qualquer fornecedor/status) —
//     mesma carta pode ser ofertada por fornecedores diferentes.
//   - "alterada": mesmo fornecedor_id (o selecionado no import) + mesmo
//     numero_externo, fingerprint diferente do que já está gravado.
//   - nunca ancorado em administradora_origem/uniq_cartas_origem_numero
//     (campos legados do sync, saindo de uso).
//
// Fingerprint SEMPRE via RPC (carta_fingerprint_lote — 0038), nunca
// recalculado em JS — mesma regra usada em /api/atende (RESERVA-01).
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LinhaImportada } from "@/lib/importador-source";

export type Categoria = "nova" | "alterada" | "ja_existe" | "com_problema";

export type LinhaAnalisada = {
  tipo: LinhaImportada["tipo"];
  credito: number | null;
  entrada: number | null;
  parcela: number | null;
  parcelas: number | null;
  adm: string | null;
  numero_externo: number | null;
  categoria: Categoria;
  problemas: string[];
  aviso_tir: boolean;
  fingerprint: string | null;
  administradora_id: string | null;
  carta_id_existente: string | null; // só preenchido quando categoria = 'alterada'
};

export type ResumoLote = {
  total: number;
  novas: number;
  alteradas: number;
  ja_existentes: number;
  com_problema: number;
};

type CartaExistente = {
  id: string;
  fornecedor_id: string | null;
  numero_externo: number | null;
  tipo: string | null;
  valor_credito: number | null;
  valor_entrada: number | null;
  valor_parcela: number | null;
  qtd_parcelas: number | null;
  administradora_id: string | null;
  administradora_raw: string | null;
};

const POR_PAGINA = 1000;
const MAX_PAGINAS = 5; // teto de segurança, mesmo padrão de /api/vitrine (até 5000 linhas)
const CONCORRENCIA_TIR = 20;
const PISO_TIR = 0.003; // 0,30% a.m. — mesma constante da trigger bidcon_price_calcular (migration 0033/0034)

/** Todo o estoque atual (qualquer status/fornecedor) — base do dedup GLOBAL. */
async function buscarCartasExistentes(supabase: SupabaseClient): Promise<CartaExistente[]> {
  const todas: CartaExistente[] = [];
  let pagina = 0;
  while (pagina < MAX_PAGINAS) {
    const { data, error } = await supabase
      .from("cartas")
      .select(
        "id, fornecedor_id, numero_externo, tipo, valor_credito, valor_entrada, valor_parcela, qtd_parcelas, administradora_id, administradora_raw"
      )
      .order("id", { ascending: true })
      .range(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA - 1);
    if (error) throw error;
    todas.push(...((data ?? []) as unknown as CartaExistente[]));
    if (!data || data.length < POR_PAGINA) break;
    pagina++;
  }
  return todas;
}

async function mapaAdministradoras(supabase: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("administradoras").select("id, nome");
  if (error) throw error;
  const mapa = new Map<string, string>();
  for (const a of (data ?? []) as { id: string; nome: string }[]) mapa.set(a.id, a.nome);
  return mapa;
}

/** Uma chamada RPC por nome distinto (poucos nomes por lote) — nunca em lote (não há RPC de lote pra isso). */
async function resolverAdministradoras(
  supabase: SupabaseClient,
  nomesDistintos: string[]
): Promise<Map<string, string | null>> {
  const resolvidos = new Map<string, string | null>();
  for (const nome of nomesDistintos) {
    const { data, error } = await supabase.rpc("resolver_administradora", { p_raw: nome });
    resolvidos.set(nome, error ? null : ((data as string | null) ?? null));
  }
  return resolvidos;
}

async function mapComConcorrencia<T, R>(
  itens: T[],
  limite: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const resultado: R[] = new Array(itens.length);
  let cursor = 0;
  async function worker() {
    while (cursor < itens.length) {
      const i = cursor++;
      resultado[i] = await fn(itens[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) || 1 }, worker));
  return resultado;
}

/**
 * Analisa um lote já parseado contra o estoque atual do fornecedor
 * selecionado. NUNCA escreve — só lê e calcula. Usada tanto pelo preview
 * (decide o que mostrar) quanto pelo publish (revalida antes de gravar,
 * repetindo exatamente esta análise sobre os dados brutos recebidos).
 */
export async function analisarLote(
  supabase: SupabaseClient,
  fornecedorId: string,
  linhasBrutas: LinhaImportada[]
): Promise<{ linhas: LinhaAnalisada[]; resumo: ResumoLote }> {
  const comProblema = linhasBrutas.filter((l) => l.problemas.length > 0);
  const validas = linhasBrutas.filter((l) => l.problemas.length === 0);

  const nomesDistintos = Array.from(
    new Set(validas.map((l) => l.adm).filter((v): v is string => !!v))
  );
  const [resolvidos, nomesCanonicos, cartasExistentes] = await Promise.all([
    resolverAdministradoras(supabase, nomesDistintos),
    mapaAdministradoras(supabase),
    buscarCartasExistentes(supabase),
  ]);

  // mesma lógica de vw_vitrine_viva: coalesce(nome canônico, raw, '').
  function admCanonico(raw: string | null): { administradora_id: string | null; nome: string } {
    if (!raw) return { administradora_id: null, nome: "" };
    const id = resolvidos.get(raw) ?? null;
    const nome = id ? nomesCanonicos.get(id) ?? raw : raw;
    return { administradora_id: id, nome };
  }

  function admCanonicoExistente(c: CartaExistente): string {
    if (c.administradora_id) return nomesCanonicos.get(c.administradora_id) ?? c.administradora_raw ?? "";
    return c.administradora_raw ?? "";
  }

  // fingerprint de TODO o estoque atual (uma chamada em lote) — base do dedup GLOBAL.
  const fingerprintsExistentesSet = new Set<string>();
  const porFornecedorNumero = new Map<string, { fingerprint: string; cartaId: string }>();
  if (cartasExistentes.length > 0) {
    const payload = cartasExistentes.map((c) => ({
      tipo: c.tipo,
      credito: c.valor_credito,
      entrada: c.valor_entrada,
      parcela: c.valor_parcela,
      parcelas: c.qtd_parcelas,
      adm: admCanonicoExistente(c),
    }));
    const { data, error } = await supabase.rpc("carta_fingerprint_lote", { p_linhas: payload });
    if (error) throw error;
    const porIdx = new Map<number, string>();
    for (const row of (data ?? []) as { idx: number; fingerprint: string }[]) porIdx.set(row.idx, row.fingerprint);
    cartasExistentes.forEach((c, idx) => {
      const fp = porIdx.get(idx);
      if (!fp) return;
      fingerprintsExistentesSet.add(fp);
      if (c.fornecedor_id && c.numero_externo != null) {
        porFornecedorNumero.set(`${c.fornecedor_id}|${c.numero_externo}`, { fingerprint: fp, cartaId: c.id });
      }
    });
  }

  // fingerprint das linhas do lote (uma chamada em lote — RPC 0038).
  let fingerprintsLote: (string | null)[] = [];
  if (validas.length > 0) {
    const payload = validas.map((l) => {
      const { nome } = admCanonico(l.adm);
      return { tipo: l.tipo, credito: l.credito, entrada: l.entrada, parcela: l.parcela, parcelas: l.parcelas, adm: nome };
    });
    const { data, error } = await supabase.rpc("carta_fingerprint_lote", { p_linhas: payload });
    if (error) throw error;
    const porIdx = new Map<number, string>();
    for (const row of (data ?? []) as { idx: number; fingerprint: string }[]) porIdx.set(row.idx, row.fingerprint);
    fingerprintsLote = validas.map((_, idx) => porIdx.get(idx) ?? null);
  }

  const analisadasValidas: LinhaAnalisada[] = validas.map((l, idx) => {
    const fp = fingerprintsLote[idx];
    const { administradora_id } = admCanonico(l.adm);
    let categoria: Categoria = "nova";
    let cartaIdExistente: string | null = null;
    if (fp && fingerprintsExistentesSet.has(fp)) {
      categoria = "ja_existe";
    } else if (l.numero_externo != null) {
      const existente = porFornecedorNumero.get(`${fornecedorId}|${l.numero_externo}`);
      if (existente && existente.fingerprint !== fp) {
        categoria = "alterada";
        cartaIdExistente = existente.cartaId;
      }
    }
    return {
      tipo: l.tipo,
      credito: l.credito,
      entrada: l.entrada,
      parcela: l.parcela,
      parcelas: l.parcelas,
      adm: l.adm,
      numero_externo: l.numero_externo,
      categoria,
      problemas: [] as string[],
      aviso_tir: false,
      fingerprint: fp,
      administradora_id,
      carta_id_existente: cartaIdExistente,
    };
  });

  // TIR informativa (não bloqueia, não altera categoria) só pra quem seria
  // publicável (nova/alterada) — dedup já filtrou o resto, poupa chamadas.
  const candidatasTir = analisadasValidas.filter((l) => l.categoria === "nova" || l.categoria === "alterada");
  const avisos = await mapComConcorrencia(candidatasTir, CONCORRENCIA_TIR, async (l) => {
    const { data, error } = await supabase.rpc("bidcon_tir_mensal", {
      p_credito: l.credito,
      p_entrada: l.entrada,
      p_parcela: l.parcela,
      p_prazo: l.parcelas,
    });
    if (error || data == null) return true; // TIR não calculável => mesmo caso que a trigger trata como degenerado
    return Number(data) < PISO_TIR;
  });
  candidatasTir.forEach((l, i) => {
    l.aviso_tir = avisos[i];
  });

  const analisadasComProblema: LinhaAnalisada[] = comProblema.map((l) => ({
    tipo: l.tipo,
    credito: l.credito,
    entrada: l.entrada,
    parcela: l.parcela,
    parcelas: l.parcelas,
    adm: l.adm,
    numero_externo: l.numero_externo,
    categoria: "com_problema",
    problemas: l.problemas,
    aviso_tir: false,
    fingerprint: null,
    administradora_id: null,
    carta_id_existente: null,
  }));

  const linhas = [...analisadasValidas, ...analisadasComProblema];
  const resumo: ResumoLote = {
    total: linhas.length,
    novas: analisadasValidas.filter((l) => l.categoria === "nova").length,
    alteradas: analisadasValidas.filter((l) => l.categoria === "alterada").length,
    ja_existentes: analisadasValidas.filter((l) => l.categoria === "ja_existe").length,
    com_problema: analisadasComProblema.length,
  };

  return { linhas, resumo };
}
