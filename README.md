# Barbearia Estilo — versão 2 (backend + banco de dados)

## Requisitos
- Node.js 20 ou superior (requisito definido em `package.json`)
- VS Code (opcional)

## Como instalar e executar
1. Extraia a pasta do projeto.
2. Abra a pasta no VS Code.
3. Copie `.env.example` para um arquivo chamado `.env`.
4. Edite `ADMIN_PASSWORD` no `.env` e coloque uma senha forte.
5. No terminal, dentro da pasta do projeto, execute:
   ```bash
   npm install
   npm start
   ```
6. Abra `http://localhost:3000`.
7. Painel do barbeiro: `http://localhost:3000/admin.html`.

O banco SQLite `data/barbearia.sqlite` e a pasta `data/` serão criados automaticamente na primeira execução. O banco local não é incluído no ZIP para evitar transportar dados de teste ou dados pessoais.

## Funcionalidades incluídas
- Layout responsivo, cores preto/marrom e fonte DM Sans + Playfair Display.
- Cadastro de nome e celular com validação.
- Lista de serviços e total calculado no servidor.
- Consulta de horários disponíveis por data.
- Não oferece horários já reservados nem horários sobrepostos à duração dos serviços; o servidor valida de novo ao salvar.
- Persistência dos agendamentos em SQLite.
- Painel administrativo protegido por senha via variável de ambiente.
- Filtro de agenda por data, cancelamento/conclusão e status de pagamento.
- Configuração de dias de funcionamento, abertura/fechamento, intervalo e datas fechadas.
- Botão que monta um resumo para enviar pelo WhatsApp, se `BARBERSHOP_PHONE` estiver configurado.
- Dados pessoais não são exibidos publicamente; a API administrativa exige senha.

## Limitações importantes / antes de publicar
- **Pix ainda é demonstrativo.** O QR Code mostrado não é um payload Pix válido e não recebe dinheiro. Para cobrança real, integre um provedor de pagamentos no backend, crie uma cobrança por agendamento e confirme o pagamento por webhook autenticado. Nunca confie em confirmação enviada pelo navegador.
- O link do WhatsApp abre o aplicativo com uma mensagem pronta; não envia automaticamente. Para envio automático, é necessária integração oficial com WhatsApp Business Platform e credenciais.
- A senha administrativa simples por variável de ambiente é uma base para estudo. Antes de publicar na internet, use autenticação robusta, HTTPS, limitação de tentativas, sessões seguras e proteção contra CSRF conforme a arquitetura escolhida.
- O SQLite é adequado para uma barbearia pequena/ protótipo. Para escala ou múltiplas instâncias de servidor, considere PostgreSQL.
- O horário é tratado em horário local do servidor. Configure o servidor para o fuso correto.
- Cada serviço tem duração estimada de 30 minutos nesta base. A seleção de vários serviços soma suas durações e bloqueia intervalos sobrepostos.
- Adicione política de privacidade, retenção segura e controles de acesso em conformidade com a LGPD antes de usar dados reais.
- Faça backup periódico do arquivo `data/barbearia.sqlite`.

## Próximas etapas sugeridas
1. Escolher um provedor de Pix real e configurar credenciais secretas no servidor.
2. Configurar o WhatsApp Business, se quiser confirmações automáticas.
3. Publicar em hospedagem com HTTPS e banco de dados gerenciado.
4. Testar conflitos de horário, cancelamentos, datas fechadas e experiência em celular.
