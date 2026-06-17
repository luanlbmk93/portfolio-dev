const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result.split(",")[1]);
      } else {
        reject(new Error("Erro ao ler arquivo"));
      }
    };
    reader.onerror = (e) => reject(e);
  });
};

const parseBrazilianNumber = (value: any): number => {
  if (typeof value === "number") return value;
  if (!value) return 0;
  return Number(
    String(value)
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "")
  );
};

export async function analyzeStatement(file: File) {
  try {

    const base64 = await fileToBase64(file);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `Você é um analista financeiro especialista em bancos brasileiros.`
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `
Analise este extrato bancário em PDF.

Extraia TODAS as transações financeiras.

REGRAS:

- Identifique se é crédito ou débito
- Ignore cabeçalhos, saldos e totais
- Retorne JSON com:

{
 "transacoes":[
  {
   "data":"YYYY-MM-DD",
   "descricao":"string",
   "valor":152.79,
   "tipo":"credito ou debito"
  }
 ]
}

Nunca inclua valores negativos.
Retorne apenas JSON válido.
`
              },
              {
                type: "input_image",
                image_url: `data:application/pdf;base64,${base64}`
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error);
    }

    const data = await response.json();

    const content = data.choices?.[0]?.message?.content;

    const json = JSON.parse(content);

    const transactions = (json.transacoes || []).map((t: any) => ({
      id: crypto.randomUUID(),
      date: t.data || "",
      description: t.descricao || "",
      amount: parseBrazilianNumber(t.valor),
      type: t.tipo || "debito",
      isManuallyExcluded: false
    }));

    return transactions;

  } catch (error: any) {
    console.error("Erro no analyzeStatement:", error.message);
    throw error;
  }
}