# Política de Privacidade — adições propostas (RASCUNHO para aprovação)

> NÃO aplicado em `public/privacidade.html` ainda. Texto para o Emerson revisar.
> Cobre DUAS frentes: (A) push notifications via OneSignal; (B) plataforma logada
> (cliente/parceiro). Passou pelo filtro de compliance do consórcio: nenhum termo
> proibido (investimento/investidor/rendimento/garantido) exceto negação; nenhuma
> promessa de contemplação. Após OK, aplico em commit separado e atualizo a data de
> "Última atualização".

---

## A) PUSH NOTIFICATIONS (aplicativo) — fase do app Capacitor

### A1. Nova seção (inserir como "7‑bis. Notificações push (aplicativo)")
> Se você instalar nosso aplicativo e autorizar, poderemos enviar **notificações push**
> para avisar sobre **cartas de consórcio contempladas** que correspondam ao seu
> interesse, além de novidades e comunicados do serviço. O envio depende do seu
> **consentimento**, manifestado quando o aplicativo solicita a permissão, e pode ser
> **revogado a qualquer momento** nas configurações do dispositivo ou do aplicativo.
> As notificações são operadas pela **OneSignal, Inc.**, que atua como nossa operadora
> para esse fim e pode tratar identificadores do dispositivo fora do Brasil, com
> salvaguardas compatíveis com a LGPD. As notificações são informativas e **não
> representam garantia de disponibilidade, de preço ou de contemplação** — os valores
> são estimativas sujeitas à análise e à transferência pela administradora do consórcio.

### A2. Acréscimo na Seção 2 (Quais dados coletamos → "Dados coletados automaticamente")
> • Identificadores de notificação: *push token* / identificador do dispositivo,
>   quando você autoriza o recebimento de notificações no aplicativo.

### A3. Acréscimo na Seção 3 (Finalidades)
> • Enviar notificações push sobre cartas de seu interesse e comunicados do serviço,
>   mediante consentimento.

### A4. Acréscimo na Seção 4 (Bases legais — nova linha na tabela)
> | Notificações push (aplicativo) | Consentimento (art. 7º, I) |

### A5. Acréscimo na Seção 5 (Com quem compartilhamos — item na lista de prestadores)
> • **OneSignal, Inc.** — envio e gestão de notificações push, quando você autoriza.

---

## B) PLATAFORMA LOGADA (área do cliente / parceiro)

### B1. Nova seção (inserir como "2‑bis. Dados na plataforma com login")
> Ao acessar nossa **área logada** (`app.bidcon.com.br`), tratamos dados adicionais
> para gerir o processo de compra ou venda de cartas de consórcio contempladas:
> - **Cliente:** dados de cadastro e o **andamento do seu processo** (etapas como
>   documentação, análise pela administradora e transferência) e dados da carta em negociação.
> - **Parceiro:** dados de cadastro e dados necessários ao acompanhamento de suas
>   cartas, indicações e **comissões previstas, liberadas ou pagas**. **Não armazenamos
>   na plataforma dados bancários do parceiro**; eventuais pagamentos são feitos por
>   fora e a plataforma apenas registra o status.

### B2. Acréscimo na Seção 3 (Finalidades)
> • Gerir o cadastro e a autenticação de usuários da plataforma (cliente, parceiro, administração);
> • Acompanhar e registrar o andamento do processo de compra/venda de carta contemplada;
> • Para parceiros, registrar indicações, cartas e o status de comissões (a plataforma
>   rastreia valores e status; não movimenta pagamentos).

### B3. Acréscimo na Seção 4 (Bases legais — novas linhas na tabela)
> | Cadastro, autenticação e gestão do processo na plataforma | Execução de contrato e de procedimentos a pedido do titular (art. 7º, V) |
> | Registro de indicações e comissões do parceiro | Execução de contrato (art. 7º, V) e legítimo interesse na gestão da parceria (art. 7º, IX) |

### B4. Acréscimo na Seção 5 (Com quem compartilhamos — prestador de tecnologia)
> • **Supabase** (banco de dados e autenticação da plataforma logada) e **Vercel**
>   (hospedagem), como operadores de tecnologia, com salvaguardas compatíveis com a LGPD.

### B5. Acréscimo na Seção 6 (Retenção)
> Dados da plataforma logada (processos, cartas, indicações e registros de comissão)
> são mantidos enquanto durar a relação e pelos prazos legais aplicáveis; após isso,
> são eliminados ou anonimizados, salvo dever legal de guarda.

### B6. Segurança (reforço na Seção 9)
> Na plataforma logada aplicamos **segurança por linha (RLS)**: cada usuário acessa
> apenas os próprios dados (o parceiro não vê dados de outro parceiro nem de clientes
> que não lhe pertencem), e a administração acessa o necessário para operar o serviço.

---

## C) Itens que NÃO mudam
- Identidade visual, estrutura da página, demais seções permanecem.
- Atualizar somente a data de "Última atualização" no topo ao aplicar.
- Aplicar em **commit separado** do código de cada feature, como você pediu.

## D) Checagem de compliance deste rascunho
- Termos proibidos (investimento/investidor/rendimento/garantido): só aparecem como
  **negação** ("não representam garantia ... de contemplação"). OK.
- Nenhuma promessa de data/garantia de contemplação. OK.
- "aprovação/limite de crédito": não usados. OK.
