// ============================================================================
// Anexos do WhatsApp — decisões de exibição. PROSPERITO-ANEXO-01, Entrega 2.
// ----------------------------------------------------------------------------
// POR QUE ISTO É UM MÓDULO DE lib/ E NÃO CÓDIGO DENTRO DA PÁGINA. `scripts/
// testes.mjs` varre `lib/` e NÃO varre páginas — regra já escrita no cabeçalho
// de app/admin/conversas/page.tsx. Tudo aqui erra em silêncio: um mime lido
// errado troca um PDF por uma miniatura quebrada, um nome inventado põe na tela
// um rótulo que ninguém escreveu. Erro silencioso mora em lib/, com teste.
//
// NADA AQUI TOCA REDE OU BANCO. São funções puras sobre o que já foi lido; a
// URL assinada e o log de acesso vivem na rota, que é servidor.
// ============================================================================

/** O mínimo que estas funções precisam saber de uma mensagem com anexo. */
export type AnexoBruto = {
  storage_path: string | null;
  mime_type: string | null;
  nome_arquivo: string | null;
  /** Legenda/filename como o webhook gravou. Ver `nomeExibicao`. */
  conteudo: string | null;
  tamanho_bytes: number | null;
};

// O webhook grava esta string literal quando o anexo não traz filename nem
// caption (app/api/whatsapp/route.ts). Medido: é o `conteudo` de 11 das 15
// linhas com anexo — todas imagens. Não é nome de arquivo e não pode virar um.
const SEM_NOME = "[anexo sem nome/legenda]";

// Inverso de EXT_POR_MIME (lib/whatsapp/media.ts). A extensão do path FOI
// escrita a partir do mime, então inverter é determinístico — para as
// extensões que aquele mapa produz. `bin` é o fallback dele e fica de fora de
// propósito: significa "mime desconhecido", e devolver um palpite ali seria
// transformar uma ignorância registrada em fato falso.
const MIME_POR_EXT: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * Deriva o mime da extensão do caminho no bucket.
 * Devolve null quando a extensão não é uma das que EXT_POR_MIME gera — incluindo
 * `.bin`, que é justamente o caso "não sabemos".
 */
export function mimePorExtensao(storagePath: string | null | undefined): string | null {
  const path = (storagePath ?? "").trim();
  if (!path) return null;
  const ponto = path.lastIndexOf(".");
  if (ponto < 0 || ponto === path.length - 1) return null;
  const ext = path.slice(ponto + 1).toLowerCase();
  return MIME_POR_EXT[ext] ?? null;
}

/**
 * Mime efetivo do anexo: o observado no webhook manda; a extensão é reserva.
 *
 * A ordem importa. `mime_type` é o que a Meta declarou no momento do envio;
 * a extensão é uma reconstrução nossa. Quando os dois existem e discordam,
 * quem tem razão é quem viu o arquivo chegar.
 */
export function mimeDoAnexo(a: AnexoBruto): string | null {
  const declarado = (a.mime_type ?? "").trim();
  if (declarado) return declarado;
  return mimePorExtensao(a.storage_path);
}

/** Só imagem ganha miniatura. Mime desconhecido NÃO é imagem. */
export function ehImagem(mime: string | null | undefined): boolean {
  return (mime ?? "").toLowerCase().startsWith("image/");
}

/**
 * Rótulo curto do tipo, para a coluna "tipo" da lista e o ícone da bolha.
 * "Arquivo" é o rótulo honesto do desconhecido — não chutamos "Documento".
 */
export function rotuloTipo(mime: string | null | undefined): string {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("image/")) return "Imagem";
  if (m === "application/pdf") return "PDF";
  if (!m) return "Arquivo";
  return "Arquivo";
}

/**
 * O que escrever como nome do anexo na tela.
 *
 * Três fontes, nesta ordem, e a terceira é deliberadamente genérica:
 *   1. `nome_arquivo` — o filename que a Meta mandou. É o nome de verdade.
 *   2. `conteudo`, SÓ se parecer nome de arquivo. Nas linhas antigas o webhook
 *      gravava `filename ?? caption ?? SEM_NOME` no mesmo campo, então ali
 *      convivem nome de arquivo e legenda de foto, indistinguíveis. Exigir uma
 *      extensão é o filtro mais barato que separa "EXTRATO.pdf" de "segue aí".
 *   3. Um rótulo genérico. Melhor "Imagem" do que exibir SEM_NOME cru ou
 *      inventar um nome a partir do media_id, que não é nome de nada.
 */
export function nomeExibicao(a: AnexoBruto): string {
  const proprio = (a.nome_arquivo ?? "").trim();
  if (proprio) return proprio;

  const legenda = (a.conteudo ?? "").trim();
  if (legenda && legenda !== SEM_NOME && /\.[a-z0-9]{2,5}$/i.test(legenda)) {
    return legenda;
  }

  return rotuloTipo(mimeDoAnexo(a));
}

/**
 * Tamanho legível, em pt-BR (vírgula decimal).
 * Devolve null — e não "0 B" — quando não sabemos: as 15 linhas antigas não
 * têm o dado, e um zero na tela seria um número falso com cara de medição.
 */
export function tamanhoLegivel(bytes: number | null | undefined): string | null {
  if (bytes === null || bytes === undefined) return null;
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;

  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1).replace(".", ",")} kB`;

  const mb = kb / 1024;
  return `${mb.toFixed(1).replace(".", ",")} MB`;
}

/** Uma mensagem tem anexo quando o arquivo está no bucket. */
export function temAnexo(a: { storage_path: string | null }): boolean {
  return Boolean((a.storage_path ?? "").trim());
}

/**
 * O texto que a bolha deve escrever ACIMA do anexo — ou null para não escrever
 * nada.
 *
 * O problema que isto resolve: em mensagem com anexo, `conteudo` NÃO é o texto
 * do cliente. O webhook grava ali `filename ?? caption ?? SEM_NOME`, então ele
 * é ou o nome do arquivo (que o bloco do anexo já mostra logo abaixo), ou uma
 * legenda de verdade (que precisa aparecer), ou o marcador interno SEM_NOME
 * (que nunca pode aparecer numa tela de operador). Renderizar `conteudo` cru
 * acerta um caso em três — e os outros dois erram calados.
 *
 * Mensagem SEM anexo passa reto: ali `conteudo` é a fala, e fala se mostra.
 */
export function textoVisivel(a: AnexoBruto): string | null {
  const texto = (a.conteudo ?? "").trim();
  if (!texto) return null;
  if (!temAnexo(a)) return texto;

  // Marcador interno: a tela do operador não é lugar de detalhe de webhook.
  if (texto === SEM_NOME) return null;

  // Já vai aparecer como nome do anexo logo abaixo — não repetimos.
  if (texto === nomeExibicao(a)) return null;

  return texto;
}
