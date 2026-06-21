# WhatsApp Leads Dashboard

Dashboard simples para importar planilha de leads e abrir conversas no WhatsApp com mensagem personalizada.

## Como usar

1. Instale as dependências:

```bash
npm install
```

2. Inicie o servidor:

```bash
npm run dev
```

3. Abra o endereço exibido no terminal (geralmente `http://localhost:5173`).

4. Clique em **Importar planilha (.xlsx)** e selecione seu arquivo.

5. Edite a mensagem no campo de texto. Use `[nome]` onde quiser inserir o primeiro nome do lead.

6. Clique no botão com o nome da pessoa para abrir o WhatsApp com a mensagem pronta.

## Colunas esperadas

- `Nome Lead` (ou `Nome`)
- `Telefone` (ou `Celular`, `WhatsApp`)
- `Email` (opcional, usado na busca)

## Exemplo de mensagem

```
Olá, [nome] tudo bem? Aqui no meu sistema consta um interesse seu na aquisição do imóvel próprio 100% financiado. Correto?
```

Para "Diogo Cristiano Rocha", o link abrirá com "Olá, Diogo tudo bem?...".
