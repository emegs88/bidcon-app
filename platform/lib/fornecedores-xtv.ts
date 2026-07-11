// ============================================================================
// Helpers de fornecedores (FATIA F1 — importador) — sempre no xtv, nunca no
// nnv. `fornecedores` foi criada pela migration 0037 no projeto xtv
// (xtvjpnyadcdeadhmzyff), junto de `importacoes` e das novas colunas de
// `cartas`. RLS está ligado sem policies (service-role-only), então todo
// acesso passa por createXtvClient() — nunca pelo client de sessão (nnv).
// Usado pelas rotas /api/admin/fornecedores e pelo form de importação.
// ============================================================================
import { createXtvClient } from "@/lib/supabase-xtv";

export type Fornecedor = {
  id: string;
  nome: string;
  contato_nome: string | null;
  whatsapp: string | null;
  email: string | null;
  observacoes: string | null;
  ativo: boolean;
  criado_em: string;
};

export async function listarFornecedoresAtivos(): Promise<Fornecedor[]> {
  const supabase = createXtvClient();
  const { data, error } = await supabase
    .from("fornecedores")
    .select("id, nome, contato_nome, whatsapp, email, observacoes, ativo, criado_em")
    .eq("ativo", true)
    .order("nome", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Fornecedor[];
}

export type NovoFornecedor = {
  nome: string;
  contato_nome?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  observacoes?: string | null;
};

/**
 * Cria um fornecedor novo. `nome` é o único campo obrigatório — validação
 * de presença/trim fica por conta de quem chama (rota API), pra devolver
 * 400 com mensagem clara em vez de erro de banco.
 */
export async function criarFornecedor(dados: NovoFornecedor): Promise<Fornecedor> {
  const supabase = createXtvClient();
  const { data, error } = await supabase
    .from("fornecedores")
    .insert({
      nome: dados.nome.trim(),
      contato_nome: dados.contato_nome?.trim() || null,
      whatsapp: dados.whatsapp?.trim() || null,
      email: dados.email?.trim() || null,
      observacoes: dados.observacoes?.trim() || null,
    })
    .select("id, nome, contato_nome, whatsapp, email, observacoes, ativo, criado_em")
    .single();
  if (error) throw error;
  return data as Fornecedor;
}
