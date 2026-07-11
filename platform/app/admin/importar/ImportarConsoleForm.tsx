"use client";
// Form client do console de importação (FATIA F1).
// Fluxo: escolhe fornecedor (ou cria um novo inline) -> escolhe arquivo .csv
// OU cola texto -> "Analisar" (POST /api/admin/importar/preview, não grava
// nada) -> confere a tabela de diff, marca/desmarca linhas -> "Publicar
// selecionadas" (POST /api/admin/importar/publicar, grava de fato).
//
// Só CSV/texto colado nesta fatia (decisão de segurança: ver nota em
// lib/importador-source.ts sobre a dependência xlsx descartada) — a UI deixa
// isso explícito pro operador.
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Field, SelectField } from "@/components/ui/Field";
import type { Fornecedor } from "@/lib/fornecedores-xtv";
import type { LinhaAnalisada, ResumoLote, Categoria } from "@/lib/importador-preview";
import styles from "./importar.module.css";

type RespostaPreview =
  | { ok: true; linhas: LinhaAnalisada[]; resumo: ResumoLote; avisos: string[] }
  | { erro: string; avisos?: string[] };

type PublicadoOk = {
  ok: true;
  importacao_id: string;
  resumo: { total: number; novas: number; alteradas: number; rejeitadas: number; erros: number };
};
type RespostaPublicar = PublicadoOk | { erro: string };

const LABEL_CATEGORIA: Record<Categoria, string> = {
  nova: "Nova",
  alterada: "Alterada",
  ja_existe: "Já existe",
  com_problema: "Com problema",
};

const TONE_CATEGORIA: Record<Categoria, "info" | "ok" | "muted" | "amber"> = {
  nova: "ok",
  alterada: "info",
  ja_existe: "muted",
  com_problema: "amber",
};

function moeda(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export function ImportarConsoleForm({ fornecedoresIniciais }: { fornecedoresIniciais: Fornecedor[] }) {
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>(fornecedoresIniciais);
  const [fornecedorId, setFornecedorId] = useState<string>(fornecedoresIniciais[0]?.id ?? "");

  const [novoAberto, setNovoAberto] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [criandoFornecedor, setCriandoFornecedor] = useState(false);
  const [erroFornecedor, setErroFornecedor] = useState<string | null>(null);

  const [modo, setModo] = useState<"arquivo" | "texto">("arquivo");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [texto, setTexto] = useState("");

  const [analisando, setAnalisando] = useState(false);
  const [erroAnalise, setErroAnalise] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ linhas: LinhaAnalisada[]; resumo: ResumoLote; avisos: string[] } | null>(
    null
  );
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());

  const [publicando, setPublicando] = useState(false);
  const [erroPublicar, setErroPublicar] = useState<string | null>(null);
  const [publicado, setPublicado] = useState<PublicadoOk | null>(null);

  const totalSelecionadas = selecionadas.size;

  async function criarFornecedorInline() {
    const nome = novoNome.trim();
    if (!nome) {
      setErroFornecedor("Informe o nome do fornecedor.");
      return;
    }
    setCriandoFornecedor(true);
    setErroFornecedor(null);
    try {
      const resp = await fetch("/api/admin/fornecedores", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nome }),
      });
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok || !dados?.ok) {
        throw new Error(typeof dados?.erro === "string" ? dados.erro : "Falha ao criar fornecedor.");
      }
      const criado = dados.fornecedor as Fornecedor;
      setFornecedores((prev) => [...prev, criado].sort((a, b) => a.nome.localeCompare(b.nome)));
      setFornecedorId(criado.id);
      setNovoNome("");
      setNovoAberto(false);
    } catch (e) {
      setErroFornecedor(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setCriandoFornecedor(false);
    }
  }

  async function analisar() {
    setErroAnalise(null);
    setResultado(null);
    setPublicado(null);
    setErroPublicar(null);
    if (!fornecedorId) {
      setErroAnalise("Selecione o fornecedor dono deste lote.");
      return;
    }
    if (modo === "arquivo" && !arquivo) {
      setErroAnalise("Selecione um arquivo .csv.");
      return;
    }
    if (modo === "texto" && texto.trim() === "") {
      setErroAnalise("Cole o lote no campo de texto.");
      return;
    }

    setAnalisando(true);
    try {
      let resp: Response;
      if (modo === "arquivo" && arquivo) {
        const fd = new FormData();
        fd.set("fornecedor_id", fornecedorId);
        fd.set("arquivo", arquivo);
        resp = await fetch("/api/admin/importar/preview", { method: "POST", body: fd });
      } else {
        resp = await fetch("/api/admin/importar/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fornecedor_id: fornecedorId, texto }),
        });
      }
      const dados = (await resp.json().catch(() => ({}))) as RespostaPreview;
      if (!resp.ok || !("ok" in dados) || !dados.ok) {
        throw new Error("erro" in dados && dados.erro ? dados.erro : "Falha ao analisar o lote.");
      }
      setResultado({ linhas: dados.linhas, resumo: dados.resumo, avisos: dados.avisos });
      const iniciais = new Set<number>();
      dados.linhas.forEach((l, idx) => {
        if (l.categoria === "nova" || l.categoria === "alterada") iniciais.add(idx);
      });
      setSelecionadas(iniciais);
    } catch (e) {
      setErroAnalise(e instanceof Error ? e.message : "Erro inesperado ao analisar.");
    } finally {
      setAnalisando(false);
    }
  }

  function alternar(idx: number) {
    setSelecionadas((prev) => {
      const novo = new Set(prev);
      if (novo.has(idx)) novo.delete(idx);
      else novo.add(idx);
      return novo;
    });
  }

  async function publicar() {
    if (!resultado || totalSelecionadas === 0) return;
    setPublicando(true);
    setErroPublicar(null);
    try {
      const linhasSelecionadas = resultado.linhas
        .filter((_, idx) => selecionadas.has(idx))
        .map((l) => ({
          tipo: l.tipo,
          credito: l.credito,
          entrada: l.entrada,
          parcela: l.parcela,
          parcelas: l.parcelas,
          adm: l.adm,
          numero_externo: l.numero_externo,
        }));
      const resp = await fetch("/api/admin/importar/publicar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fornecedor_id: fornecedorId,
          origem: "console",
          arquivo_nome: modo === "arquivo" ? arquivo?.name ?? null : null,
          linhas: linhasSelecionadas,
        }),
      });
      const dados = (await resp.json().catch(() => ({}))) as RespostaPublicar;
      if (!resp.ok || !("ok" in dados) || !dados.ok) {
        throw new Error("erro" in dados && dados.erro ? dados.erro : "Falha ao publicar.");
      }
      setPublicado(dados);
      setResultado(null);
      setSelecionadas(new Set());
    } catch (e) {
      setErroPublicar(e instanceof Error ? e.message : "Erro inesperado ao publicar.");
    } finally {
      setPublicando(false);
    }
  }

  const linhas = resultado?.linhas ?? [];
  const podePublicar = totalSelecionadas > 0 && !publicando;

  return (
    <div className={styles.stack}>
      <Card>
        <div className={styles.linhaFornecedor}>
          <SelectField
            label="Fornecedor deste lote"
            id="fornecedor"
            value={fornecedorId}
            onChange={(e) => setFornecedorId(e.target.value)}
          >
            {fornecedores.length === 0 && <option value="">Nenhum fornecedor cadastrado</option>}
            {fornecedores.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </SelectField>
          <Button type="button" variant="ghost" size="sm" onClick={() => setNovoAberto((v) => !v)}>
            {novoAberto ? "Cancelar" : "+ Novo fornecedor"}
          </Button>
        </div>

        {novoAberto && (
          <div className={styles.novoFornecedor}>
            <Field
              label="Nome do fornecedor novo"
              id="novo-fornecedor"
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              placeholder="Ex.: Rodobens Consórcio"
            />
            <Button type="button" size="sm" onClick={criarFornecedorInline} disabled={criandoFornecedor}>
              {criandoFornecedor ? "Criando…" : "Criar"}
            </Button>
          </div>
        )}
        {erroFornecedor && <p className={styles.erro}>{erroFornecedor}</p>}
      </Card>

      <Card>
        <div className={styles.modoTabs}>
          <button
            type="button"
            className={`${styles.modoTab} ${modo === "arquivo" ? styles.modoTabAtivo : ""}`}
            onClick={() => setModo("arquivo")}
          >
            Arquivo .csv
          </button>
          <button
            type="button"
            className={`${styles.modoTab} ${modo === "texto" ? styles.modoTabAtivo : ""}`}
            onClick={() => setModo("texto")}
          >
            Colar texto
          </button>
        </div>

        {modo === "arquivo" ? (
          <label className={styles.upload}>
            <span className={styles.uploadLabel}>
              Arquivo .csv — se tiver .xlsx, salve como CSV antes de enviar.
            </span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />
          </label>
        ) : (
          <label className={styles.campo}>
            <span>Cole o lote (cabeçalho + linhas, separado por vírgula, ponto-e-vírgula ou tab)</span>
            <textarea
              className={styles.textarea}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={"tipo,credito,entrada,parcela,parcelas,adm,numero_externo\nveiculo,50000,3500,850,60,Rodobens,1234"}
              spellCheck={false}
              rows={12}
            />
          </label>
        )}

        <div className={styles.acoes}>
          <span className={styles.hint}>
            {modo === "arquivo" ? arquivo?.name ?? "Nenhum arquivo selecionado" : `${texto.trim().length.toLocaleString("pt-BR")} caracteres`}
          </span>
          <Button type="button" onClick={analisar} disabled={analisando}>
            {analisando ? "Analisando…" : "Analisar"}
          </Button>
        </div>
        {erroAnalise && <p className={styles.erro}>{erroAnalise}</p>}
      </Card>

      {resultado && (
        <Card>
          <div className={styles.resumo}>
            <Badge tone="ok">{resultado.resumo.novas} novas</Badge>
            <Badge tone="info">{resultado.resumo.alteradas} alteradas</Badge>
            <Badge tone="muted">{resultado.resumo.ja_existentes} já existem</Badge>
            <Badge tone="amber">{resultado.resumo.com_problema} com problema</Badge>
          </div>
          {resultado.avisos.length > 0 && (
            <ul className={styles.avisos}>
              {resultado.avisos.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}

          <div className={styles.tabelaWrap}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th></th>
                  <th>Categoria</th>
                  <th>Tipo</th>
                  <th>Administradora</th>
                  <th>Crédito</th>
                  <th>Entrada</th>
                  <th>Parcela</th>
                  <th>Nº parc.</th>
                  <th>Ref.</th>
                  <th>Obs.</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, idx) => {
                  const marcavel = l.categoria === "nova" || l.categoria === "alterada";
                  return (
                    <tr key={idx} className={l.categoria === "com_problema" ? styles.linhaProblema : ""}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selecionadas.has(idx)}
                          disabled={!marcavel}
                          onChange={() => alternar(idx)}
                        />
                      </td>
                      <td>
                        <Badge tone={TONE_CATEGORIA[l.categoria]}>{LABEL_CATEGORIA[l.categoria]}</Badge>
                        {l.aviso_tir && (
                          <span className={styles.avisoTir} title="TIR abaixo do piso de plausibilidade — vai para quarentena/revisão">
                            ⚠ TIR
                          </span>
                        )}
                      </td>
                      <td>{l.tipo ?? "—"}</td>
                      <td>{l.adm ?? "—"}</td>
                      <td className={styles.numero}>{moeda(l.credito)}</td>
                      <td className={styles.numero}>{moeda(l.entrada)}</td>
                      <td className={styles.numero}>{moeda(l.parcela)}</td>
                      <td className={styles.numero}>{l.parcelas ?? "—"}</td>
                      <td className={styles.numero}>{l.numero_externo ?? "—"}</td>
                      <td className={styles.obs}>{l.problemas.join("; ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={styles.acoes}>
            <span className={styles.hint}>{totalSelecionadas} linha(s) selecionada(s)</span>
            <Button type="button" onClick={publicar} disabled={!podePublicar}>
              {publicando ? "Publicando…" : `Publicar selecionadas (${totalSelecionadas})`}
            </Button>
          </div>
          {erroPublicar && <p className={styles.erro}>{erroPublicar}</p>}
        </Card>
      )}

      {publicado && (
        <Card>
          <div className={styles.ok}>
            <strong>Importação publicada.</strong>
            <span>
              {publicado.resumo.novas} nova(s) · {publicado.resumo.alteradas} alterada(s) ·{" "}
              {publicado.resumo.rejeitadas} rejeitada(s)
              {publicado.resumo.erros > 0 ? ` (incl. ${publicado.resumo.erros} erro(s) de gravação)` : ""}.
            </span>
            <a className={styles.voltar} href="/admin/revisao">
              Ver fila de revisão →
            </a>
          </div>
        </Card>
      )}
    </div>
  );
}
