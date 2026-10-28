# Dindom — app interno da pizzaria

Protótipo navegável (PWA) das telas principais, feito para validar navegação, visual e usabilidade antes de conectar o banco de dados.

## Como abrir

- **No computador:** dê dois cliques em `index.html` (abre no navegador). Use o modo celular das ferramentas de desenvolvedor (F12 → ícone de celular) para ver no tamanho certo.
- **No celular, como app instalável:** o PWA (instalação na tela inicial, funcionamento offline) só ativa quando servido por `https` ou `localhost`. Qualquer hospedagem estática serve (Netlify, Vercel, GitHub Pages, Firebase Hosting): basta enviar a pasta inteira.

O sistema começa **vazio**. Na primeira abertura em cada aparelho aparece a **primeira configuração**: unidades, dias de reposição e a conta do administrador. Depois o administrador cadastra produtos (Gestão › Produtos), checklists (Gestão › Modelos de checklist) e a equipe (Gestão › Colaboradores).

**Importante:** enquanto o servidor não é ligado, os dados ficam salvos **só no aparelho** onde foram feitos. Use um aparelho compartilhado na loja (tablet ou computador), onde cada pessoa entra com o próprio e-mail e senha e bate o ponto por código. Para cada um usar o próprio celular, é preciso ligar o banco de dados.

## Telas

| Tela | Rota | Arquivo |
|---|---|---|
| Início (colaborador / gerente) | `#inicio` | `js/screens/home.js` |
| Fechamento de estoque | `#estoque/fechamento` | `js/screens/fechamento.js` |
| Estoque e lista de compras | `#estoque`, `#estoque/compras` | `js/screens/estoque.js` |
| Checklists e execução | `#checklists`, `#checklists/<id>` | `js/screens/checklists.js` |
| Registro e acompanhamento de manutenção | `#manutencao`, `#manutencao/nova`, `#manutencao/<nº>` | `js/screens/manutencao.js` |
| Perfil e notificações | `#perfil`, `#notificacoes` | `js/screens/perfil.js` |
| Agenda (dia, semana/3 dias, mês, programação) | `#agenda` | `js/screens/agenda.js` + `js/agenda/` |
| Admin › Colaboradores (cadastrar, editar, desativar) | `#equipe`, `#equipe/novo`, `#equipe/<id>` | `js/screens/equipe.js` |
| Escanear nota fiscal (QR Code da NFC-e) e dar entrada no estoque | `#estoque/nota` | `js/screens/nota-scan.js`, `js/screens/nota.js`, `js/nfce.js`, `js/scanner.js` |
| Onde comprar (comparativo de preços e recomendação) | `#estoque/precos` | `js/screens/precos.js` |
| Ponto (registro, espelho, ajustes, ponto por código) e Ponto da equipe | `#ponto`, `#ponto/equipe` | `js/ponto-core.js`, `js/screens/ponto.js`, `js/screens/ponto-equipe.js` |

**Perfis de acesso:** Colaborador, Gerente e Administrador. Gerente e Administrador veem a área Gestão (menu lateral no computador; Perfil › Administração no celular). Só o Administrador cadastra colaboradores.

## Marca

Arquivos em `icons/`, gerados a partir da logo oficial:

- `logo-dindom-preta.png` — logo preta oficial sem o laço rosa (2000×2000), para usar fora do app.
- `logo-black.png` / `logo-white.png` — logo completa com "DESDE 2009", fundo transparente.
- `wordmark-black.png` / `wordmark-white.png` — só o letreiro "Dindom", fundo transparente.
- `icon-*.png` — ícones do app (fundo preto, letreiro branco).

A identidade fica em `css/tokens.css` (preto e branco da marca, Montserrat espaçada nos rótulos) e `css/brand.css` (logo e animação de abertura).

**Celular x computador:** abaixo de 900 px de largura o app usa a barra inferior (5 destinos; a Agenda abre pelo ícone de calendário no Início). A partir de 900 px vira layout de computador: menu lateral com a Agenda, telas mais largas com grade de cards e painéis em janela centralizada. O limite está em `css/desktop.css` e em `isDesktop()` no `js/app.js`.

## Estrutura

- `css/tokens.css` — cores (tema claro e escuro), tipografia, espaçamentos, raios.
- `css/app.css` — componentes reutilizáveis: cards, botões, chips, campos, barra inferior, painéis, toasts, estados vazios, skeletons.
- `css/screens.css` — estilos específicos de cada tela.
- `css/agenda.css` — agenda (grade de horários, mês, programação, minicalendário).
- `css/desktop.css` — layout de computador e efeitos de mouse.
- `js/agenda/core.js` (datas, repetições, eventos sobrepostos), `views.js` (HTML de cada visão), `form.js` (detalhes e criar/editar).
- `js/data.js` — estrutura dos dados, configurações padrão e armazenamento local (sem dados de exemplo). **É o único arquivo a trocar na fase do banco de dados**: as telas só usam `DB.get()`, `DB.update()` e `DB.product()`.
- `js/ui.js`, `js/media.js` — utilitários (toast, painel inferior, confirmação, câmera).
- `js/app.js` — roteador, barra de navegação, tema, aviso de conexão.
- `sw.js`, `manifest.webmanifest`, `icons/` — instalação como app e uso offline.

## Próxima etapa

1. Validar as telas no celular com a equipe e ajustar.
2. Escolher o backend (ex.: Supabase ou Firebase) e trocar `js/data.js` por chamadas reais, com login e permissões por perfil.
3. Implementar as regras de negócio do prompt principal (estoque ideal por data de reposição, aprovação de compras, notificações).

## Nota fiscal e preços

**O que já funciona no app:** leitura do QR pela câmera (leitor nativo do Android ou jsQR em `js/vendor/`), por foto ou digitando a chave; validação da chave de acesso (dígito verificador, modelo 55/65, estado); bloqueio de nota repetida; reconhecimento dos itens da nota no cadastro, com aprendizado quando alguém corrige; entrada no estoque da unidade escolhida; baixa na lista de compras; registro do preço pago em cada loja.

**O que depende do servidor (próxima etapa):**
- `NFCe.fetchItems` em `js/nfce.js` hoje abre a nota em modo manual: loja, número e data vêm da chave e os itens são lançados à mão. No servidor, ele recebe o texto do QR, consulta a página pública da SEFAZ do estado e devolve loja, data e itens. O navegador não pode fazer isso direto (bloqueio de CORS e formato diferente por estado). Também existem serviços pagos de consulta de NFC-e que entregam os itens já estruturados.
- **Preços das lojas:** os apps de atacados e supermercados não têm acesso aberto, e automatizar a leitura deles costuma violar os termos de uso. A comparação usa a base de preços das notas escaneadas (cada compra alimenta a base) e pode somar fontes públicas de preços de NFC-e onde o estado oferece, encartes publicados e cotações dos fornecedores.
- **IA:** a recomendação hoje é calculada por regra (menor total, divisão entre duas lojas só quando economiza pelo menos R$ 25 e 5%). No servidor, um modelo de IA pode receber essa mesma tabela e explicar a escolha considerando distância, horário e pedido mínimo.
## Ponto

Registros com número sequencial (NSR) e comprovante; nunca são apagados nem editados — correções entram como marcações do tipo "ajuste", pedidas pelo colaborador e aprovadas pelo gerente. A jornada pertence ao dia da entrada (turno da noite que passa da meia-noite conta no dia em que começou). Turnos e horas previstas ficam em `shifts` (`js/data.js`); tolerância de atraso em `js/ponto-core.js`.

**Antes de usar oficialmente:** pela Portaria MTP 671/2021, ponto por programa (REP-P) precisa de registro no INPI, atestado técnico e entrega dos arquivos AFD/AEJ à fiscalização. Este protótipo segue as regras de funcionamento (marcações imutáveis, NSR, comprovante), mas ainda não é certificado; a alternativa é integrar com um sistema de ponto já homologado.
## Supabase (dados compartilhados entre aparelhos)

O app está ligado ao projeto Supabase configurado em `js/config.js` (endereço e chave **publishable**, que é pública; nunca coloque a chave secreta no app). Com ele:

- Login, troca de senha e "Esqueci minha senha" (link por e-mail) pelo Supabase Auth.
- Os dados ficam na tabela `records` (um item por linha) e chegam em tempo real aos outros aparelhos; cada aparelho guarda uma cópia para abrir sem internet e reenvia o que ficou pendente.
- Permissões no banco (`supabase/schema.sql`): só membros da equipe leem e gravam; só o admin mexe no cadastro de colaboradores; colaborador desativado perde o acesso.
- Só existe uma pizzaria por banco: a primeira configuração cria a pizzaria e a conta do administrador.
- O NSR do ponto é gerado pelo servidor.

Configurações necessárias no painel do Supabase: rodar `supabase/schema.sql`, desligar "Confirm email" e definir o Site URL do app. Para usar sem servidor (só no aparelho), deixe `js/config.js` vazio.
## Acesso da Contabilidade

Em Gestão › Colaboradores › **Dar acesso à contabilidade**, o admin cria um login com o nível **Contabilidade**. Esse acesso:

- vê só o **Ponto da equipe** (todas as unidades) e o próprio Perfil; não vê estoque, compras, checklists, manutenção nem agenda;
- não aprova ajustes nem altera dados (bloqueado também no banco, por `supabase/002_contabilidade.sql`);
- exporta, por período (mês atual, mês anterior ou datas livres) e por unidade, três planilhas CSV (separador `;`, UTF-8, datas DD/MM/AAAA, horas HH:MM): **Marcações**, **Espelho de ponto** e **Resumo do período**; e dois arquivos TXT: **AFD** (leiaute de relógio de ponto da Portaria 1510: cabeçalho tipo 1 com CNPJ e razão social, marcações tipo 3 com NSR, data, hora e PIS, fechamento tipo 9) e **Espelho de ponto em texto** (`js/ponto-export.js`). CPF e PIS do cadastro identificam cada funcionário; o CNPJ e a razão social ficam em Perfil › Dados da empresa.

No Supabase já em uso, rode `supabase/002_contabilidade.sql` uma vez (instalações novas já recebem isso pelo `schema.sql`).## Vendas (Cardápio Web)

Gerentes e administradores veem em **Vendas** (menu Gestão no computador; Perfil › Administração no celular) o movimento da loja na Cardápio Web: faturamento, pedidos, ticket médio e cancelados por período (hoje, ontem, 7 dias, mês, sempre no dia de trabalho que vira às 5h), pedidos em andamento com o tempo de espera, itens e sabores mais vendidos, tipo de pedido, canal e formas de pagamento. O Início do gerente mostra o resumo de hoje (`js/screens/vendas.js`).

**Como ligar (uma vez):**
1. No Supabase, rode `supabase/003_cardapioweb.sql` (o app oferece o SQL pronto para copiar). Ele liga as extensões `http` e `pg_cron` e agenda a busca dos pedidos a cada minuto.
2. No Portal da Cardápio Web: **Configurações › Integrações › API** › gerar token.
3. No app, como administrador: Vendas › ícone de engrenagem › cole o token › **Conectar**. Para experimentar antes, use "Experimentar com a loja de teste" (loja pública da documentação da Cardápio Web).

**Como funciona:** o token fica só no banco (tabela `cw_config`, sem leitura pelo app). A cada minuto o próprio banco consulta a API (`cw_sync`): pedidos alterados nas últimas horas, uma página do histórico dos últimos 30 dias até completar e até 30 pedidos completos por minuto, para não estourar o limite da API (300 chamadas a cada 3 minutos por loja, dividido com outros sistemas que usem o mesmo token). Os pedidos ficam em `cw_orders` sem telefone e endereço do cliente (só o primeiro nome e o bairro), e só gerente e administrador conseguem ler. A tela pede o resumo já somado (`cw_report`) e se atualiza sozinha quando chega pedido.

**Limites:** o app só lê. Aceitar, cancelar e mudar status continuam no Portal da Cardápio Web. A integração usa o token do estabelecimento (modelo "legado" da API); resumos e rankings prontos da própria Cardápio Web e a gestão de insumos exigem OAuth, que só existe para apps publicados na CW App Store. Se a Cardápio Web desligar o token legado, será preciso cadastrar o Dindom como app lá. Pedidos de mesa e comanda só aparecem depois de fechados (regra da API).

**Insights** (Vendas › Insights, `js/screens/vendas-insights.js`): cerca de 40 leituras com uma sugestão do que fazer: faturamento, pedidos e ticket contra o período anterior; clientes novos, que voltaram, fiéis, em risco (30 a 60 dias sem pedir), perdidos (mais de 60) e de um pedido só; taxa de recompra; cadastros que viraram pedido e cadastrados que nunca pediram; desistências no pagamento online; bairros que mais vendem, em alta e em queda; horário de pico e mais fraco; dia mais forte e mais fraco; itens em alta, em queda e que saem juntos; iFood x cardápio próprio; taxas de pagamento; cupons; cancelamentos; avaliações. As 5 mais urgentes aparecem no topo como "Decisões prioritárias". Precisa do `supabase/004_insights.sql`, que guarda também a lista de clientes (só primeiro nome e inicial) e as avaliações, e amplia o histórico para 175 dias. A API da Cardápio Web não informa visitas ao cardápio: "quem entrou e não pediu" é medido pelos cadastros sem pedido e pelos pagamentos online abandonados.

## Fechamento por estação

- **Tipo do produto** (Produtos): *Preparo e produção* (farinha, óleo, fermento, colorau, cheiro-verde…), *Montagem das pizzas* (queijos, calabresa, catupiry…) ou *Apoio e outros* (bebidas, sachês, descartáveis, embalagens, limpeza). Fica acima da categoria e organiza a lista de produtos e o fechamento. `DB.KINDS` em `js/data.js`.
- **Estações** (`#estacoes`, `js/screens/estacoes.js`): o gerente cria estações, escolhe os responsáveis (um ou mais colaboradores) e os produtos de cada uma. Cada produto fica em uma estação só. "Criar estações sugeridas" monta Preparo, Montagem, Apoio e atendimento, e Embalagens e limpeza a partir do tipo e da categoria. **Produtos › Organizar** muda tipo e estação de vários produtos numa lista só.
- **No fechamento**, quem tem estação abre em "Minha parte" e conta só os seus produtos; "Loja toda" mostra o andamento de cada estação. Quando tudo foi contado, qualquer pessoa finaliza e sai uma lista de compras única. Produto sem estação pode ser contado por qualquer pessoa.
- A contagem é guardada produto a produto (coleção `counts`), para várias pessoas contarem ao mesmo tempo em aparelhos diferentes sem uma apagar a outra. Contagens em andamento no formato antigo são convertidas sozinhas.

## Trava de localização do ponto

Com a trava ligada (Perfil › Trava de localização do ponto, só o administrador), o colaborador só bate o ponto a até 30 m da loja (raio ajustável por unidade). O app soma uma folga de até 20 m conforme a precisão do GPS e recusa leituras com erro maior que 100 m. A distância fica gravada em cada marcação (`geo: { dist, acc }`) e aparece para o gerente no histórico de ponto da equipe. O local é definido com o administrador na loja ("usar a localização deste aparelho") ou colando as coordenadas. O computador ou tablet fixo do ponto por código é marcado como "aparelho da loja" e não passa pela trava. Código em `js/geo.js`.

Limite: a conferência acontece no aparelho. Quem usa app de GPS falso consegue burlar; a distância registrada em cada marcação ajuda a conferir.

## Reservas pelo link público

Um link aberto (`/reserva`, ex.: `https://seu-site/reserva`) para enviar a empresas e clientes. Eles preenchem o questionário (responsável, empresa, WhatsApp, e-mail, tipo de evento, homenageado, data, horário de início e término, pessoas, decoração, bolo/alimentação/bebidas, orçamento, observações e a confirmação "a reserva só é garantida após confirmação da equipe") sem login, e a reserva entra na hora na agenda de toda a equipe.

**Como ligar (uma vez):** no Supabase, rode `supabase/005_reservas.sql` (a tela Reservas oferece o SQL pronto para copiar). Depois, em **Reservas › Copiar link de reserva**, copie e envie o link.

**Como funciona:**
- A página pública fica em `reserva/` e não carrega o app: só manda o questionário para `criar_reserva()`, que confere tudo de novo no servidor (campos obrigatórios, data a partir de hoje no fuso America/Fortaleza, horários, quantidade de pessoas). Proteção contra spam: campo escondido para robôs, envio rápido demais descartado, até 5 pedidos por hora por aparelho (IP, guardado só como código), 3 por dia por WhatsApp e 40 a cada 10 minutos no total.
- A reserva fica na tabela `reservas` (status `pendente`, `confirmada`, `recusada` ou `cancelada`; origem `link_publico`; `evento_id` liga ao evento da agenda). O próprio banco cria o evento na agenda "Reservas e eventos" (título `🎉 Tipo – Responsável/empresa (X pessoas)`) e um aviso em Notificações. O evento chega em tempo real a todos os aparelhos.
- Na agenda, reservas são douradas, com os selos RESERVA e o status (pendente amarelo, confirmada verde, recusada e cancelada em cinza e riscadas). Pendente que ninguém abriu pisca com o selo NOVA. Duas reservas ativas no mesmo dia e horário mostram CONFLITO e um aviso no topo da agenda. Festa que passa da meia-noite aparece até o fim do dia.
- Tocar no evento abre o painel da reserva: todas as respostas, confirmar, recusar, cancelar, abrir o WhatsApp do cliente com a mensagem pronta (wa.me), editar os detalhes e anotações internas. Tudo grava direto na tabela, e o banco atualiza o evento.
- **Reservas** (`#reservas`, `js/screens/reservas.js`): lista por status e período, com contador de pendentes no menu, no Início e no Perfil, e aviso na tela quando chega reserva nova.
- Só a equipe logada lê e altera as reservas; o público só cria. A contabilidade não vê.

## Senha de colaborador definida pelo administrador

Em **Colaboradores › (pessoa) › Definir senha**, o administrador escolhe a senha e passa para a pessoa, que entra direto com ela. Com o servidor, isso usa `definir_senha()` (`supabase/006_senha_colaborador.sql`, rodar uma vez; o app oferece o SQL quando falta). Além de gravar a senha, a função conserta o acesso que ficou pela metade: e-mail sem confirmação, conta de login sem vínculo com a equipe ou com e-mail diferente do cadastro. Se o e-mail nem tem login, o app cria a conta. "Enviar link para nova senha" continua disponível.
