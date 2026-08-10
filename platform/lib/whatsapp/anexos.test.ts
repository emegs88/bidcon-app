// ============================================================================
// Testes dos anexos do WhatsApp (PROSPERITO-ANEXO-01, Entrega 2).
// ----------------------------------------------------------------------------
// O QUE ESTES TESTES PROTEGEM. Nenhuma destas funções lança quando erra — a
// tela só fica sutilmente mentirosa. Os casos abaixo são os que custariam caro:
// o `.bin` que vira um mime inventado, a legenda de foto promovida a nome de
// arquivo, o tamanho ausente exibido como zero, e o mime desconhecido tratado
// como imagem (que renderiza uma miniatura quebrada no lugar de um link que
// funciona). Todos medidos contra as 15 linhas reais de 10/08/2026.
// ============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mimePorExtensao,
  mimeDoAnexo,
  ehImagem,
  rotuloTipo,
  nomeExibicao,
  tamanhoLegivel,
  temAnexo,
  textoVisivel,
  type AnexoBruto,
} from "./anexos";

// Base neutra; cada teste sobrescreve só o que está medindo.
function anexo(over: Partial<AnexoBruto> = {}): AnexoBruto {
  return {
    storage_path: "conv/123.jpg",
    mime_type: null,
    nome_arquivo: null,
    conteudo: null,
    tamanho_bytes: null,
    ...over,
  };
}

// ----- mimePorExtensao -------------------------------------------------------

test("mimePorExtensao inverte as extensões que EXT_POR_MIME produz", () => {
  assert.equal(mimePorExtensao("c/1.pdf"), "application/pdf");
  assert.equal(mimePorExtensao("c/1.jpg"), "image/jpeg");
  assert.equal(mimePorExtensao("c/1.png"), "image/png");
  assert.equal(mimePorExtensao("c/1.webp"), "image/webp");
});

test("mimePorExtensao ignora caixa alta na extensão", () => {
  assert.equal(mimePorExtensao("c/EXTRATO.PDF"), "application/pdf");
});

test("mimePorExtensao devolve null para .bin — o fallback de mime desconhecido", () => {
  // `bin` é o que media.ts grava quando NÃO soube o mime. Derivar um mime dali
  // seria transformar uma ignorância registrada em fato falso.
  assert.equal(mimePorExtensao("c/1.bin"), null);
});

test("mimePorExtensao devolve null sem extensão, com ponto final ou vazio", () => {
  assert.equal(mimePorExtensao("c/semponto"), null);
  assert.equal(mimePorExtensao("c/1."), null);
  assert.equal(mimePorExtensao(""), null);
  assert.equal(mimePorExtensao(null), null);
});

// ----- mimeDoAnexo -----------------------------------------------------------

test("mimeDoAnexo prefere o mime observado no webhook à extensão", () => {
  // Quem viu o arquivo chegar tem razão sobre quem reconstruiu pelo nome.
  const a = anexo({ mime_type: "application/pdf", storage_path: "c/1.jpg" });
  assert.equal(mimeDoAnexo(a), "application/pdf");
});

test("mimeDoAnexo cai na extensão quando o mime não foi guardado", () => {
  // É o caso das 15 linhas anteriores a 10/08/2026.
  assert.equal(mimeDoAnexo(anexo({ storage_path: "c/1.pdf" })), "application/pdf");
});

test("mimeDoAnexo trata mime vazio/espaços como ausente", () => {
  assert.equal(mimeDoAnexo(anexo({ mime_type: "   ", storage_path: "c/1.jpg" })), "image/jpeg");
});

// ----- ehImagem / rotuloTipo -------------------------------------------------

test("ehImagem é verdadeiro só para image/*", () => {
  assert.equal(ehImagem("image/jpeg"), true);
  assert.equal(ehImagem("IMAGE/PNG"), true);
  assert.equal(ehImagem("application/pdf"), false);
});

test("ehImagem é FALSO para mime desconhecido", () => {
  // Este é o teste que evita a miniatura quebrada: sem mime, não arriscamos
  // um <img> — mostramos o link, que funciona sempre.
  assert.equal(ehImagem(null), false);
  assert.equal(ehImagem(""), false);
});

test("rotuloTipo chama o desconhecido de Arquivo, não de Documento", () => {
  assert.equal(rotuloTipo("image/jpeg"), "Imagem");
  assert.equal(rotuloTipo("application/pdf"), "PDF");
  assert.equal(rotuloTipo(null), "Arquivo");
  assert.equal(rotuloTipo("application/zip"), "Arquivo");
});

// ----- nomeExibicao ----------------------------------------------------------

test("nomeExibicao usa o filename da Meta quando existe", () => {
  const a = anexo({ nome_arquivo: "EXTRATO.pdf", conteudo: "segue o extrato" });
  assert.equal(nomeExibicao(a), "EXTRATO.pdf");
});

test("nomeExibicao aceita o conteudo antigo quando ele parece nome de arquivo", () => {
  // Linhas 25 e 82 medidas: o webhook gravava o filename em `conteudo`.
  assert.equal(
    nomeExibicao(anexo({ conteudo: "extrato_cota_356201.pdf", storage_path: "c/1.pdf" })),
    "extrato_cota_356201.pdf"
  );
  assert.equal(nomeExibicao(anexo({ conteudo: "Bruno.pdf", storage_path: "c/1.pdf" })), "Bruno.pdf");
});

test("nomeExibicao NÃO promove o marcador de anexo sem nome a nome de arquivo", () => {
  // É o `conteudo` de 11 das 15 linhas. Exibi-lo cru seria vazar detalhe
  // interno na tela do operador.
  const a = anexo({ conteudo: "[anexo sem nome/legenda]", storage_path: "c/1.jpg" });
  assert.equal(nomeExibicao(a), "Imagem");
});

test("nomeExibicao NÃO promove legenda de foto a nome de arquivo", () => {
  const a = anexo({ conteudo: "segue aí o meu extrato", storage_path: "c/1.jpg" });
  assert.equal(nomeExibicao(a), "Imagem");
});

test("nomeExibicao cai no rótulo genérico do tipo quando não há nome nenhum", () => {
  assert.equal(nomeExibicao(anexo({ storage_path: "c/1.pdf" })), "PDF");
  assert.equal(nomeExibicao(anexo({ storage_path: "c/1.bin" })), "Arquivo");
});

// ----- tamanhoLegivel --------------------------------------------------------

test("tamanhoLegivel devolve null quando não sabemos — nunca zero", () => {
  // As 15 linhas antigas não têm o dado. "0 B" seria um número falso com cara
  // de medição; null deixa a tela omitir.
  assert.equal(tamanhoLegivel(null), null);
  assert.equal(tamanhoLegivel(undefined), null);
});

test("tamanhoLegivel recusa valores impossíveis", () => {
  assert.equal(tamanhoLegivel(-1), null);
  assert.equal(tamanhoLegivel(Number.NaN), null);
});

test("tamanhoLegivel usa vírgula decimal (pt-BR) e escala", () => {
  assert.equal(tamanhoLegivel(0), "0 B");
  assert.equal(tamanhoLegivel(512), "512 B");
  assert.equal(tamanhoLegivel(1536), "1,5 kB");
  assert.equal(tamanhoLegivel(1024 * 1024 * 2.5), "2,5 MB");
});

// ----- temAnexo --------------------------------------------------------------

test("temAnexo olha o arquivo no bucket, não o media_id", () => {
  // media_id sem storage_path = baixou e não subiu. Medido: 0 casos hoje, mas
  // a tela não pode oferecer link para arquivo que não está lá.
  assert.equal(temAnexo({ storage_path: "c/1.jpg" }), true);
  assert.equal(temAnexo({ storage_path: null }), false);
  assert.equal(temAnexo({ storage_path: "   " }), false);
});

// ----- textoVisivel ----------------------------------------------------------

test("textoVisivel devolve a fala inteira quando NÃO há anexo", () => {
  // Sem anexo, `conteudo` é o que a pessoa escreveu. Nada a filtrar.
  const a = anexo({ storage_path: null, conteudo: "bom dia, quero vender minha cota" });
  assert.equal(textoVisivel(a), "bom dia, quero vender minha cota");
});

test("textoVisivel esconde o marcador interno de anexo sem nome", () => {
  // 11 das 15 linhas medidas. Escrever isso na bolha põe detalhe de webhook
  // na tela de quem atende.
  const a = anexo({ conteudo: "[anexo sem nome/legenda]", storage_path: "c/1.jpg" });
  assert.equal(textoVisivel(a), null);
});

test("textoVisivel não repete o texto que já vira nome do anexo", () => {
  // `conteudo` = "EXTRATO.pdf" e nomeExibicao = "EXTRATO.pdf": mostrar os dois
  // escreveria o mesmo nome duas vezes, uma acima da outra.
  const a = anexo({ conteudo: "EXTRATO.pdf", storage_path: "c/1.pdf" });
  assert.equal(nomeExibicao(a), "EXTRATO.pdf");
  assert.equal(textoVisivel(a), null);
});

test("textoVisivel mostra a legenda de verdade que acompanha a foto", () => {
  // Aqui `conteudo` é fala do cliente: não é nome de arquivo (nomeExibicao
  // recusou) e não é o marcador. Some se filtrarmos demais.
  const a = anexo({ conteudo: "segue aí o meu extrato", storage_path: "c/1.jpg" });
  assert.equal(nomeExibicao(a), "Imagem");
  assert.equal(textoVisivel(a), "segue aí o meu extrato");
});

test("textoVisivel trata conteudo vazio/espaços como nada a escrever", () => {
  assert.equal(textoVisivel(anexo({ conteudo: null })), null);
  assert.equal(textoVisivel(anexo({ conteudo: "   " })), null);
  assert.equal(textoVisivel(anexo({ conteudo: "   ", storage_path: null })), null);
});
